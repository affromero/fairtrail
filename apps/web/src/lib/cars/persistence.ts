import { prisma } from '@/lib/prisma';
import type { Prisma, CarSearchRun, CarTracker, TravelJob } from '@/generated/prisma/client';
import { completeTravelJob, failTravelJob, guardTravelJob, lockTravelLease, TravelJobError, type TravelLeaseToken } from '../travel/jobs';
import { carJson, carMinorNumber, carTrackerDto, lockCarTracker } from './store';
import { validateCarSearch } from './validation';
import { validateCarReport } from './report';
import { assessCarPrice } from './pricing';
import { carContractHash, carTrackerSearch, selectCarObservation } from './selection';
import { carAlertMessage, evaluateCarAlerts } from './alerts';
import { CarError, type CarContractSelection, type CarSearchReport, type CarSource } from './types';

interface CarRunContext { run: CarSearchRun; tracker: CarTracker | null; selection: CarContractSelection | null; sources: CarSource[] }

async function context(tx: Prisma.TransactionClient, job: TravelJob): Promise<CarRunContext> {
  if (job.kind !== 'car_search' || !job.carRunId) throw new TravelJobError('Shared job is not a car search');
  const source = await tx.carSearchRun.findUnique({ where: { id: job.carRunId } });
  if (!source || source.userId !== job.userId) throw new TravelJobError('Car search owner changed');
  const tracker = source.trackerId ? await lockCarTracker(tx, source.trackerId, { userId: source.userId, isAdmin: false }) : null;
  await tx.$queryRaw`SELECT id FROM "CarSearchRun" WHERE id = ${source.id} FOR UPDATE`;
  const run = await tx.carSearchRun.findUniqueOrThrow({ where: { id: source.id } });
  if (run.userId !== job.userId || run.trackerId !== source.trackerId || !['queued', 'running'].includes(run.status)) throw new TravelJobError('Car search was cancelled, completed or reassigned');
  if (tracker && (!tracker.active || tracker.revision !== run.trackerRevision)) throw new TravelJobError('Car tracker revision changed or tracking was paused');
  if (!tracker && run.trackerRevision !== null) throw new TravelJobError('Standalone car search has an invalid tracker revision');
  const search = validateCarSearch(run.request, run.createdAt);
  const selection = tracker ? carTrackerDto(tracker).selection : null;
  return { run, tracker, selection, sources: selection ? [selection.source] : search.sources };
}

export async function startCarRun(jobId: string, lease: TravelLeaseToken): Promise<CarRunContext> {
  return prisma.$transaction(async tx => {
    const job = await guardTravelJob(tx, jobId, lease);
    const current = await context(tx, job);
    validateCarSearch(current.run.request);
    if (current.run.status === 'queued') current.run = await tx.carSearchRun.update({ where: { id: current.run.id }, data: { status: 'running' } });
    return current;
  });
}

/** Await the bounded transaction even after cancellation; no detached writes. */
export async function saveCarProgress(jobId: string, lease: TravelLeaseToken, raw: unknown, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET LOCAL statement_timeout = '1000ms'`;
    await tx.$executeRaw`SET LOCAL lock_timeout = '500ms'`;
    signal.throwIfAborted();
    const job = await guardTravelJob(tx, jobId, lease);
    const current = await context(tx, job);
    if (current.run.status !== 'running') throw new TravelJobError('Car search has not started');
    const report = validateCarReport(raw, current.sources);
    signal.throwIfAborted();
    await tx.carSearchRun.update({ where: { id: current.run.id }, data: { result: carJson(report) } });
    signal.throwIfAborted();
    await lockTravelLease(tx, lease);
    signal.throwIfAborted();
  }, { maxWait: 1000, timeout: 3000 });
}

async function persistTracker(tx: Prisma.TransactionClient, current: CarRunContext, report: CarSearchReport, jobId: string, now: Date): Promise<void> {
  const tracker = current.tracker;
  if (!tracker) return;
  const search = carTrackerSearch(validateCarSearch(current.run.request, current.run.createdAt));
  const snapshots = report.offers.map(offer => {
    const assessment = assessCarPrice(offer, search, now), contractHash = carContractHash(offer.contract);
    const matches = !current.selection || (offer.contract.source === current.selection.source && contractHash === current.selection.contractHash);
    return { trackerId: tracker.id, runId: current.run.id, source: offer.contract.source, offer: carJson(offer), currency: offer.contract.currency, totalMinor: assessment.total?.minor ?? null, eligible: assessment.eligible && matches, reasons: [...assessment.reasons, ...(!matches ? ['Different rental contract from the selected tracker'] : [])], contractHash, observedAt: new Date(offer.observedAt) };
  });
  await tx.carSnapshot.createMany({ data: snapshots });
  const selected = selectCarObservation(report, search, current.selection ?? undefined, now);
  const complete = report.errors.length === 0 && report.candidates.length === 0 && report.providers.length === current.sources.length && report.providers.every(provider => provider.status === 'complete')
    && (current.selection !== null || snapshots.every(snapshot => snapshot.eligible));
  const issues = report.errors.map(error => error.message);
  if (report.candidates.length) issues.push('Some checked quotes have incomplete pricing or rental terms and were excluded from verified prices');
  if (report.providers.some(provider => provider.status !== 'complete') && !report.errors.length) issues.push('Some providers could not complete this check');
  if (selected.status !== 'matched') issues.push(...selected.reasons);
  const price = selected.status === 'matched' ? selected.assessment.total : null;
  const target = tracker.targetMinor === null ? null : { currency: tracker.currency, minor: carMinorNumber(tracker.targetMinor)! };
  const outcome = evaluateCarAlerts({ targetArmed: tracker.targetArmed, historicalLowMinor: carMinorNumber(tracker.historicalLowMinor) }, target, tracker.notifyLows, price, complete);
  await tx.carTracker.update({ where: { id: tracker.id }, data: {
    ...(price ? { latestPriceMinor: price.minor } : {}), historicalLowMinor: outcome.state.historicalLowMinor, targetArmed: outcome.state.targetArmed,
    lastCheckedAt: now, lastError: issues.join('; ') || null, nextCheckAt: new Date(now.getTime() + tracker.scrapeInterval * 3_600_000),
  } });
  if (price && selected.status === 'matched' && (outcome.target || outcome.low)) {
    await tx.travelAlertDelivery.create({ data: { carTrackerId: tracker.id, eventKey: `car:${jobId}:${tracker.revision}`, message: carJson(carAlertMessage(tracker, selected.offer, price, outcome)) } });
  }
}

export async function finishCarRun(jobId: string, lease: TravelLeaseToken, raw: unknown): Promise<void> {
  await completeTravelJob(jobId, lease, async (tx, job) => {
    const current = await context(tx, job);
    if (current.run.status !== 'running') throw new TravelJobError('Car search has not started');
    const evaluatedAt = new Date();
    const report = validateCarReport(raw, current.sources, evaluatedAt);
    if (report.completed !== report.total || report.providers.some(provider => provider.status === 'running')) throw new CarError('Car search has unfinished providers');
    await persistTracker(tx, current, report, jobId, evaluatedAt);
    const incomplete = report.errors.length > 0 || report.candidates.length > 0 || report.providers.some(provider => provider.status !== 'complete');
    const status = incomplete ? report.offers.length || report.candidates.length ? 'partial' : 'failed' : report.offers.length ? 'success' : 'partial';
    await tx.carSearchRun.update({ where: { id: current.run.id }, data: { status, result: carJson(report), error: report.errors.map(error => error.message).join('; ') || (report.offers.length ? null : 'No complete rental contracts were verified among the checked offers'), completedAt: evaluatedAt } });
  });
}

export async function failCarRun(jobId: string, lease: TravelLeaseToken): Promise<void> {
  const message = 'Car check could not finish; previous verified prices were retained. Refresh to retry.';
  await failTravelJob(jobId, lease, new CarError(message), async (tx, job) => {
    const current = await context(tx, job);
    await tx.carSearchRun.update({ where: { id: current.run.id }, data: { status: 'failed', error: message, completedAt: new Date() } });
    if (current.tracker) await tx.carTracker.update({ where: { id: current.tracker.id }, data: { lastError: message, lastCheckedAt: new Date(), nextCheckAt: new Date(Date.now() + current.tracker.scrapeInterval * 3_600_000) } });
  });
}

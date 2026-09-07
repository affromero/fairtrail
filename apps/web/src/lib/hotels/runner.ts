import { prisma } from '@/lib/prisma';
import { validateHotelSearch, expandHotelStays, matchesHotelFilters, matchHotelSelection } from './domain';
import { searchHotelSource, PartialHotelSourceError } from './providers';
import { json, lockHotelTracker, refreshHotelTracker } from './store';
import { deliverHotelAlerts, recordHotelAlerts } from './alerts';
import type { HotelSearchRun, HotelTracker, Prisma } from '@/generated/prisma/client';
import type { HotelSearchResult, HotelSelection, HotelTrackingOptions } from './types';
import { completeTravelJob, enqueueTravelJob, failTravelJob, guardTravelJob, lockTravelAdmission, lockTravelResource, TravelJobError, type TravelLeaseToken } from '../travel/jobs';
import { checkTravelAuthority, currentTravelContext } from '../travel/context';
import { currentTravelExecution, TravelCleanupError } from '../travel/execution';

const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** Preserve the original 24-hour retention for completed standalone searches. */
export async function cleanupHotelSearches(now = new Date()) {
  const cutoff = new Date(now.getTime() - 86_400_000);
  return prisma.$transaction(async tx => {
    await lockTravelResource(tx, 'hotel_search');
    return tx.hotelSearchRun.deleteMany({ where: {
      trackerId: null, status: { in: ['success', 'partial', 'unavailable', 'failed', 'cancelled'] }, createdAt: { lt: cutoff },
      OR: [{ travelJob: null }, { travelJob: { is: { status: { in: ['succeeded', 'failed', 'cancelled'] }, leaseResource: null } } }],
    } });
  });
}

export async function scheduleDueHotels() {
  const due = await prisma.hotelTracker.findMany({ where: { active: true, nextCheckAt: { lte: new Date() } }, orderBy: { nextCheckAt: 'asc' }, take: 20 });
  for (const tracker of due) {
    try { await refreshHotelTracker(tracker.id, { userId: tracker.userId, isAdmin: true }, true); }
    catch (error) {
      console.error('[hotels] Scheduled check could not be queued:', error);
      await prisma.hotelTracker.updateMany({ where: { id: tracker.id, updatedAt: tracker.updatedAt }, data: { lastError: errorText(error), nextCheckAt: new Date(Date.now() + 3_600_000) } });
    }
  }
}
async function persistTrackerResult(tx: Prisma.TransactionClient, tracker: HotelTracker, run: HotelSearchRun, result: HotelSearchResult) {
  const selection = tracker.selection as unknown as HotelSelection;
  const options = tracker.options as unknown as HotelTrackingOptions;
  const offers = result.offers.flatMap(offer => {
    const match = matchHotelSelection(offer, selection, options.mode);
    return match ? [{ ...offer, match }] : [];
  });
  const eligible = offers.filter(o => o.match === 'exact' || options.allowApproximateAlerts);
  await tx.hotelSnapshot.createMany({ data: offers.map(offer => ({ trackerId: tracker.id, runId: run.id, offer: json(offer), eligible: offer.match === 'exact' || options.allowApproximateAlerts })) });
  const best = [...eligible].sort((a, b) => a.totalPrice - b.totalPrice)[0];
  const latest = [...offers].sort((a, b) => a.totalPrice - b.totalPrice)[0];
  // Approximate or missing offers cannot rearm an exact-match alert.
  await recordHotelAlerts(tx, tracker, best, result.errors.length === 0 && eligible.length === offers.length);
  const latestPrice = latest?.totalPrice ?? (result.completed === 0 && result.errors.length > 0 ? tracker.latestPrice : null);
  await tx.hotelTracker.update({ where: { id: tracker.id }, data: { latestPrice, lastCheckedAt: new Date(), lastError: result.errors.map(e => e.message).join('; ') || (offers.length ? null : 'No verified matching offers available'), nextCheckAt: new Date(Date.now() + options.scrapeInterval * 3_600_000) } });
}

async function ownedRun(tx: Prisma.TransactionClient, jobId: string, lease: TravelLeaseToken) {
  const job = await guardTravelJob(tx, jobId, lease);
  if (!job.hotelRunId || job.kind !== 'hotel_search') throw new TravelJobError('Expected a hotel search job');
  const source = await tx.hotelSearchRun.findUnique({ where: { id: job.hotelRunId } });
  if (!source || source.userId !== job.userId) throw new TravelJobError('Hotel search ownership changed');
  const tracker = source.trackerId ? await lockHotelTracker(tx, source.trackerId) : null;
  if (source.trackerId && (!tracker || !tracker.active || tracker.userId !== source.userId)) throw new TravelJobError('Hotel tracker was paused, deleted or reassigned');
  await tx.$queryRaw`SELECT id FROM "HotelSearchRun" WHERE id = ${source.id} FOR UPDATE`;
  const run = await tx.hotelSearchRun.findUniqueOrThrow({ where: { id: source.id } });
  if (!['queued', 'running'].includes(run.status)) throw new TravelJobError('Hotel search was cancelled or completed');
  return { run, tracker };
}

/** Shared admission owns the heartbeat and every browser opened by providers. */
export async function executeHotelJob(jobId: string, lease: TravelLeaseToken): Promise<void> {
  const context = currentTravelContext(), execution = currentTravelExecution();
  if (!execution || context?.job.id !== jobId || context.lease.owner !== lease.owner) throw new TravelJobError('Hotel job requires its matching shared execution');
  const { run, tracker } = await prisma.$transaction(async tx => {
    const current = await ownedRun(tx, jobId, lease);
    await tx.hotelSearchRun.update({ where: { id: current.run.id }, data: { status: 'running', claimedAt: new Date(), heartbeatAt: new Date() } });
    return current;
  });
  try {
    const selection = tracker?.selection as unknown as HotelSelection | undefined;
    const search = validateHotelSearch(run.request), stays = expandHotelStays(search);
    const result: HotelSearchResult = { offers: [], errors: [], completed: 0, total: stays.length * search.sources.length };
    for (const stay of stays) {
      for (const source of search.sources) {
        await checkTravelAuthority();
        try {
          const offers = await searchHotelSource(search, stay, source, selection);
          execution.check();
          result.offers.push(...offers.filter(o => o.source === source && o.checkIn === stay.checkIn && o.checkOut === stay.checkOut && matchesHotelFilters(o, search, Boolean(tracker))));
          result.completed++;
        } catch (error) {
          execution.check();
          if (error instanceof TravelJobError || error instanceof TravelCleanupError) throw error;
          if (error instanceof PartialHotelSourceError) {
            const offers = error.offers.filter(o => o.source === source && o.checkIn === stay.checkIn && o.checkOut === stay.checkOut && matchesHotelFilters(o, search, Boolean(tracker)));
            result.offers.push(...offers);
            if (offers.length) result.completed++;
          }
          result.errors.push({ source, ...stay, message: errorText(error) });
        }
        await prisma.$transaction(async tx => {
          await ownedRun(tx, jobId, lease);
          await tx.hotelSearchRun.update({ where: { id: run.id }, data: { result: json(result), heartbeatAt: new Date() } });
          await guardTravelJob(tx, jobId, lease);
        });
      }
    }
    result.offers.sort((a, b) => a.totalPrice - b.totalPrice);
    await completeTravelJob(jobId, lease, async tx => {
      const current = await ownedRun(tx, jobId, lease);
      if (current.tracker) await persistTrackerResult(tx, current.tracker, current.run, result);
      const status = result.errors.length ? result.completed ? 'partial' : 'failed' : result.offers.length ? 'success' : 'unavailable';
      await tx.hotelSearchRun.update({ where: { id: run.id }, data: { status, result: json(result), error: result.errors.map(e => e.source + ': ' + e.message).join('; ') || null, completedAt: new Date() } });
    });
  } catch (error) {
    if (execution.signal.aborted || error instanceof TravelJobError || error instanceof TravelCleanupError) throw error;
    await failTravelJob(jobId, lease, error, async tx => {
      const current = await ownedRun(tx, jobId, lease);
      await tx.hotelSearchRun.update({ where: { id: run.id }, data: { status: 'failed', error: errorText(error), completedAt: new Date() } });
      if (current.tracker) await tx.hotelTracker.update({ where: { id: current.tracker.id }, data: { lastError: errorText(error), lastCheckedAt: new Date(), nextCheckAt: new Date(Date.now() + 3_600_000) } });
    });
    throw error;
  }
}

/** Attach pre-cutover queued work without starting a second legacy worker. */
export async function reconcileHotelJobs(): Promise<void> {
  await prisma.$transaction(async tx => {
    await lockTravelAdmission(tx);
    const legacy = await tx.hotelLease.findUnique({ where: { id: 'worker' } });
    if (legacy && legacy.expiresAt.getTime() > 0) throw new TravelJobError('Stop the previous hotel worker and recover travel execution before continuing', 503);
    await tx.hotelSearchRun.updateMany({ where: { status: 'running', travelJob: null }, data: { status: 'failed', error: 'Hotel worker interrupted during upgrade; refresh to retry', completedAt: new Date() } });
    const queued = await tx.hotelSearchRun.findMany({ where: { status: 'queued', travelJob: null }, take: 100 });
    for (const run of queued) await enqueueTravelJob({ kind: 'hotel_search', hotelRunId: run.id, userId: run.userId }, tx);
  });
}

export async function pumpHotelJobs(): Promise<void> {
  if (process.env.SELF_HOSTED !== 'true') return;
  const config = await prisma.extractionConfig.findUnique({ where: { id: 'singleton' } });
  if (config?.enabled === false) return;
  await reconcileHotelJobs();
  await cleanupHotelSearches();
  await scheduleDueHotels();
  const { pumpTravelJobs } = await import('../travel/coordinator');
  await pumpTravelJobs();
  await deliverHotelAlerts();
}
export async function runHotelJobsSafely(): Promise<void> {
  const { runTravelBackgroundWork } = await import('../travel/schedule');
  await runTravelBackgroundWork();
}

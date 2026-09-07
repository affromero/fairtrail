import { prisma } from '@/lib/prisma';
import { Prisma, type CarTracker } from '@/generated/prisma/client';
import { cancelTravelJob, enqueueTravelJob, lockTravelResource } from '../travel/jobs';
import { assertCarOwner, type CarActor } from './access';
import { carInteger, carRecord, carText, validateCarOptions, validateCarSearch } from './validation';
import { validateCarOffer } from './offer-validation';
import { assessCarPrice } from './pricing';
import { carContractHash, carTrackerSearch, validateCarSelection } from './selection';
import { CarError, type CarContractSelection, type CarSearch } from './types';

export const carJson = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

export function carMinorNumber(value: bigint | null): number | null {
  if (value === null) return null;
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) throw new CarError('Stored rental amount is outside the supported range', 500);
  return Number(value);
}

export function carTrackerDto(row: CarTracker) {
  const search = validateCarSearch(row.search, row.createdAt);
  if (search.currency !== row.currency) throw new CarError('Stored rental currency does not match its search', 500);
  const options = validateCarOptions({ mode: row.mode, target: row.targetMinor === null ? null : { currency: row.currency, minor: carMinorNumber(row.targetMinor) }, notifyLows: row.notifyLows, scrapeInterval: row.scrapeInterval }, row.currency);
  const selection = row.selection === null ? null : validateCarSelection(carRecord(row.selection) as unknown as CarContractSelection);
  if ((row.mode === 'contract') !== Boolean(selection) || (selection && !search.sources.includes(selection.source))) throw new CarError('Stored rental selection does not match its tracking mode', 500);
  return {
    id: row.id, userId: row.userId, label: row.label, search, selection, options, active: row.active, revision: row.revision,
    latestPriceMinor: carMinorNumber(row.latestPriceMinor), historicalLowMinor: carMinorNumber(row.historicalLowMinor), currency: row.currency,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    nextCheckAt: row.nextCheckAt.toISOString(), lastError: row.lastError,
  };
}

async function lockTracker(tx: Prisma.TransactionClient, id: string, actor: CarActor): Promise<CarTracker> {
  await lockTravelResource(tx, 'car_search');
  const rows = await tx.$queryRaw<CarTracker[]>`SELECT * FROM "CarTracker" WHERE id = ${id} FOR UPDATE`;
  const row = rows[0] ?? null;
  assertCarOwner(actor, row);
  return row;
}

async function checkQuota(tx: Prisma.TransactionClient, userId: string | null): Promise<void> {
  const count = await tx.carSearchRun.count({ where: { userId, status: { in: ['queued', 'running'] } } });
  if (count >= 3) throw new CarError('Three car searches are already active; wait or cancel one', 429);
}

async function queueSearch(tx: Prisma.TransactionClient, search: CarSearch, userId: string | null, tracker?: CarTracker) {
  await checkQuota(tx, userId);
  const run = await tx.carSearchRun.create({ data: { userId, request: carJson(search), ...(tracker ? { trackerId: tracker.id, trackerRevision: tracker.revision } : {}) } });
  await enqueueTravelJob({ kind: 'car_search', carRunId: run.id, userId }, tx);
  return run;
}

/** Internal input must come from server-vetted geography before HTTP exposure. */
export async function createCarSearch(raw: unknown, actor: CarActor) {
  const search = validateCarSearch(raw);
  return prisma.$transaction(async tx => {
    await lockTravelResource(tx, 'car_search');
    return queueSearch(tx, search, actor.userId);
  });
}

export async function getCarTracker(id: string, actor: CarActor) {
  const row = await prisma.carTracker.findUnique({ where: { id } });
  assertCarOwner(actor, row);
  return row;
}

export async function getCarSearch(id: string, actor: CarActor) {
  const row = await prisma.carSearchRun.findUnique({ where: { id } });
  assertCarOwner(actor, row);
  return row;
}

export async function createCarTracker(raw: unknown, actor: CarActor) {
  const input = carRecord(raw);
  const searchId = carText(input.searchId, 200, 'completed search'), offerId = carText(input.offerId, 200, 'selected offer');
  return prisma.$transaction(async tx => {
    await lockTravelResource(tx, 'car_search');
    await tx.$queryRaw`SELECT id FROM "CarSearchRun" WHERE id = ${searchId} FOR UPDATE`;
    const run = await tx.carSearchRun.findUnique({ where: { id: searchId } });
    assertCarOwner(actor, run);
    if (!['success', 'partial'].includes(run.status) || !run.completedAt) throw new CarError('Choose a quote from a completed car search', 409);
    const search = validateCarSearch(run.request);
    const result = carRecord(run.result);
    if (!Array.isArray(result.offers) || result.offers.length > 16) throw new CarError('Stored rental results are invalid', 500);
    const offers = result.offers.map(value => validateCarOffer(value)).filter(offer => offer.id === offerId);
    if (offers.length !== 1) throw new CarError('Choose a quote returned by this search');
    const offer = offers[0]!;
    const assessment = assessCarPrice(offer, search);
    if (!assessment.eligible) throw new CarError(`This quote cannot be tracked: ${assessment.reasons.join('; ')}`, 409);
    const options = validateCarOptions(input, search.currency);
    const selection = options.mode === 'contract' ? { source: offer.contract.source, contractHash: carContractHash(offer.contract) } : null;
    const trackingSearch = carTrackerSearch(search);
    const tracker = await tx.carTracker.create({ data: {
      userId: run.userId, label: input.label === undefined ? `${search.pickup.name} → ${search.dropoff.name}` : carText(input.label, 250, 'tracker label'),
      search: carJson(trackingSearch), selection: selection ? carJson(selection) : Prisma.DbNull, mode: options.mode, currency: search.currency,
      targetMinor: options.target?.minor ?? null, notifyLows: options.notifyLows, scrapeInterval: options.scrapeInterval,
    } });
    await queueSearch(tx, trackingSearch, tracker.userId, tracker);
    return tracker;
  });
}

export async function refreshCarTracker(id: string, actor: CarActor, dueOnly = false) {
  return prisma.$transaction(async tx => {
    const tracker = await lockTracker(tx, id, actor);
    if (dueOnly && (!tracker.active || tracker.nextCheckAt > new Date())) return null;
    if (!tracker.active) throw new CarError('Resume this car tracker before refreshing', 409);
    const existing = await tx.carSearchRun.findFirst({ where: { trackerId: id, status: { in: ['queued', 'running'] } } });
    if (existing) return existing;
    const search = carTrackerSearch(validateCarSearch(tracker.search));
    return queueSearch(tx, search, tracker.userId, tracker);
  });
}

async function cancelTrackerWork(tx: Prisma.TransactionClient, id: string, reason: string): Promise<void> {
  const runs = await tx.carSearchRun.findMany({ where: { trackerId: id, status: { in: ['queued', 'running'] } }, include: { travelJob: true } });
  for (const run of runs) {
    if (run.travelJob) await cancelTravelJob(run.travelJob.id, null, true, tx);
    await tx.carSearchRun.update({ where: { id: run.id }, data: { status: 'cancelled', error: reason, completedAt: new Date() } });
  }
  await tx.travelAlertDelivery.updateMany({ where: { carTrackerId: id, pending: true }, data: { pending: false, lastError: reason } });
}

export async function editCarTracker(id: string, raw: unknown, actor: CarActor) {
  const input = carRecord(raw);
  const allowed = ['active', 'target', 'notifyLows', 'scrapeInterval', 'userId', 'label'];
  if (!Object.keys(input).length || Object.keys(input).some(key => !allowed.includes(key))) throw new CarError('Unsupported update; create a new tracker to change rental criteria');
  if (input.active !== undefined && typeof input.active !== 'boolean') throw new CarError('active must be a boolean');
  if (input.userId !== undefined && !actor.isAdmin) throw new CarError('Only administrators can reassign car trackers', 403);
  return prisma.$transaction(async tx => {
    const tracker = await lockTracker(tx, id, actor);
    const previous = carTrackerDto(tracker);
    const options = validateCarOptions({ ...previous.options, ...input }, tracker.currency);
    const userId = input.userId === undefined ? tracker.userId : carText(input.userId, 200, 'tracker owner');
    if (input.userId !== undefined && !(await tx.user.findUnique({ where: { id: userId! } }))) throw new CarError('Choose an existing user');
    const label = input.label === undefined ? tracker.label : carText(input.label, 250, 'tracker label');
    const targetChanged = options.target?.minor !== previous.options.target?.minor;
    await cancelTrackerWork(tx, id, 'Car tracker settings changed; the previous check was cancelled');
    return tx.carTracker.update({ where: { id }, data: {
      userId, label, revision: { increment: 1 }, active: input.active === undefined ? tracker.active : input.active as boolean,
      targetMinor: options.target?.minor ?? null, notifyLows: options.notifyLows, scrapeInterval: options.scrapeInterval,
      targetArmed: targetChanged ? true : tracker.targetArmed, nextCheckAt: new Date(),
    } });
  });
}

export async function cancelCarSearch(id: string, actor: CarActor) {
  return prisma.$transaction(async tx => {
    await lockTravelResource(tx, 'car_search');
    await tx.$queryRaw`SELECT id FROM "CarSearchRun" WHERE id = ${id} FOR UPDATE`;
    const run = await tx.carSearchRun.findUnique({ where: { id }, include: { travelJob: true } });
    assertCarOwner(actor, run);
    if (!['queued', 'running'].includes(run.status)) return run;
    if (run.travelJob) await cancelTravelJob(run.travelJob.id, null, true, tx);
    return tx.carSearchRun.update({ where: { id }, data: { status: 'cancelled', error: 'Car search cancelled', completedAt: new Date() } });
  });
}

export async function deleteCarTracker(id: string, actor: CarActor): Promise<void> {
  await prisma.$transaction(async tx => {
    await lockTracker(tx, id, actor);
    await cancelTrackerWork(tx, id, 'Car tracker deleted');
    await tx.carTracker.delete({ where: { id } });
  });
}

export async function listCarTrackers(actor: CarActor, limit = 100, admin = false) {
  if (admin && !actor.isAdmin) throw new CarError('Administrator access required', 403);
  carInteger(limit, 1, 100, 'Tracker page size');
  const rows = await prisma.carTracker.findMany({ where: admin || actor.userId === null ? {} : { userId: actor.userId }, orderBy: { createdAt: 'desc' }, take: limit });
  return rows.map(carTrackerDto);
}

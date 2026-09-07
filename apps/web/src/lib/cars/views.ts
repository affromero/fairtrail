import { prisma } from '@/lib/prisma';
import type { CarSearchRun, CarSnapshot } from '@/generated/prisma/client';
import { assertCarOwner, type CarActor } from './access';
import { carMinorNumber, carTrackerDto } from './store';
import { validateCarOffer } from './offer-validation';
import { carContractHash } from './selection';
import { validateCarRunView } from './run-view';
import { validateCarSearch } from './validation';
import { CarError } from './types';
import { validateCarSnapshotView } from './detail-view';

function summary(row: CarSearchRun) {
  return { id: row.id, trackerId: row.trackerId, status: row.status, error: row.error, createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null };
}
function snapshot(row: CarSnapshot & { run: { completedAt: Date | null } }, tracker: ReturnType<typeof carTrackerDto>) {
  const offer = validateCarOffer(row.offer, row.observedAt);
  if (offer.contract.currency !== row.currency || offer.contract.source !== row.source || carContractHash(offer.contract) !== row.contractHash || offer.observedAt !== row.observedAt.toISOString()) throw new CarError('Stored rental observation is inconsistent', 500);
  return validateCarSnapshotView({ id: row.id, runId: row.runId, source: row.source, offer, currency: row.currency, totalMinor: carMinorNumber(row.totalMinor), eligible: row.eligible, reasons: row.reasons, contractHash: row.contractHash, observedAt: row.observedAt.toISOString(), evaluatedAt: (row.run.completedAt ?? row.observedAt).toISOString() }, tracker);
}

/** Ownership and history share one consistent snapshot without locking the worker. */
export async function getCarDetail(id: string, actor: CarActor) {
  return prisma.$transaction(async tx => {
    const row = await tx.carTracker.findUnique({ where: { id } });
    assertCarOwner(actor, row);
    try {
      const tracker = carTrackerDto(row);
      const [snapshots, runs, channels, latestObservation] = await Promise.all([
        tx.carSnapshot.findMany({ where: { trackerId: id }, orderBy: [{ observedAt: 'desc' }, { id: 'desc' }], take: 100, include: { run: { select: { completedAt: true } } } }),
        tx.carSearchRun.findMany({ where: { trackerId: id }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 20 }),
        tx.notificationChannel.count({ where: { enabled: true, OR: [{ userId: row.userId }, { userId: null }] } }),
        row.latestPriceMinor === null ? null : tx.carSnapshot.findFirst({
          where: { trackerId: id, eligible: true, totalMinor: row.latestPriceMinor, run: { status: { in: ['success', 'partial'] } }, ...(tracker.selection ? { source: tracker.selection.source, contractHash: tracker.selection.contractHash } : {}) },
          orderBy: [{ run: { completedAt: 'desc' } }, { observedAt: 'desc' }, { id: 'desc' }], include: { run: { select: { completedAt: true } } },
        }),
      ]);
      return { tracker, latestObservation: latestObservation ? snapshot(latestObservation, tracker) : null, snapshots: snapshots.map(row => snapshot(row, tracker)), runs: runs.map(summary), notificationsConfigured: channels > 0, canReassign: actor.isAdmin && actor.userId !== null };
    } catch (error) { throw new CarError('Stored rental history is invalid; check the server logs', 500, { cause: error }); }
  }, { isolationLevel: 'RepeatableRead', maxWait: 1000, timeout: 3000 });
}

export async function getCarRunView(id: string, actor: CarActor) {
  return prisma.$transaction(async tx => {
    const row = await tx.carSearchRun.findUnique({ where: { id } });
    assertCarOwner(actor, row);
    try {
      const search = validateCarSearch(row.request, row.createdAt, { allowUnresolvedProviders: true });
      const tracker = row.trackerId ? await tx.carTracker.findUnique({ where: { id: row.trackerId } }) : null;
      const selection = tracker ? carTrackerDto(tracker).selection : null;
      const sources = selection ? [selection.source] : search.sources;
      const executionSearch = { ...search, sources, extras: { ...search.extras, protection: search.extras.protection.filter(product => sources.includes(product.source)) } };
      return validateCarRunView({ ...summary(row), search: executionSearch, result: row.result, trackingClosed: row.trackingClosed }, id);
    } catch (error) { throw new CarError('Stored rental result is invalid; check the server logs', 500, { cause: error }); }
  }, { isolationLevel: 'RepeatableRead', maxWait: 1000, timeout: 3000 });
}

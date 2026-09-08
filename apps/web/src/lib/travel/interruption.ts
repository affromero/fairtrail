import type { Prisma, TravelJob } from '@/generated/prisma/client';

/** Preserve observed prices while finalizing unfinished domain records. Admission is already locked. */
export async function interruptTravelRun(tx: Prisma.TransactionClient, job: TravelJob, message: string): Promise<void> {
  const now = new Date();
  if (job.carRunId) {
    const run = await tx.carSearchRun.findUnique({ where: { id: job.carRunId } });
    await tx.carSearchRun.updateMany({ where: { id: job.carRunId, status: { in: ['queued', 'running'] } }, data: { status: 'failed', error: message, completedAt: now } });
    if (run?.trackerId) {
      const tracker = await tx.carTracker.findUnique({ where: { id: run.trackerId } });
      if (tracker) await tx.carTracker.updateMany({ where: { id: tracker.id, userId: job.userId, revision: run.trackerRevision ?? -1 }, data: { lastError: message, lastCheckedAt: now, nextCheckAt: new Date(now.getTime() + tracker.scrapeInterval * 3_600_000) } });
    }
  }
  if (job.hotelRunId) {
    const run = await tx.hotelSearchRun.findUnique({ where: { id: job.hotelRunId } });
    await tx.hotelSearchRun.updateMany({ where: { id: job.hotelRunId, status: { in: ['queued', 'running'] } }, data: { status: 'failed', error: message, completedAt: now } });
    if (run?.trackerId) await tx.hotelTracker.updateMany({ where: { id: run.trackerId, userId: job.userId }, data: { lastError: message, lastCheckedAt: now, nextCheckAt: new Date(now.getTime() + 3_600_000) } });
  }
  await tx.fetchRun.updateMany({ where: { travelJobId: job.id, status: 'in_progress' }, data: { status: 'failed', error: message, completedAt: now } });
}

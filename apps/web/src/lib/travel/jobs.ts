import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { Prisma, type TravelJob, type TravelLease } from '@/generated/prisma/client';

export class TravelJobError extends Error {
  constructor(message: string, public readonly status = 409) { super(message); this.name = 'TravelJobError'; }
}
export type TravelJobRequest =
  | { kind: 'flight_batch'; userId: null }
  | { kind: 'flight_query'; queryId: string; userId: string | null }
  | { kind: 'hotel_search'; hotelRunId: string; userId: string | null }
  | { kind: 'car_search'; carRunId: string; userId: string | null };
export interface TravelLeaseToken { id: string; owner: string; generation: number }
const DEFAULT_LEASE_MS = 120_000;
const clearClaim = { leaseResource: null, leaseOwner: null, leaseGeneration: null, activeKey: null };

export function travelResource(kind: TravelJob['kind']): string {
  return kind === 'flight_batch' || kind === 'flight_query' ? 'vpn' : 'browser';
}
export async function lockTravelResource(tx: Prisma.TransactionClient, kind: TravelJob['kind']): Promise<void> {
  const resource = travelResource(kind);
  await tx.$executeRaw`INSERT INTO "TravelLease" (id, owner, "expiresAt") VALUES (${resource}, ${randomUUID()}, ${new Date(0)}) ON CONFLICT (id) DO NOTHING`;
  await tx.$queryRaw`SELECT id FROM "TravelLease" WHERE id = ${resource} FOR UPDATE`;
}
export async function enqueueTravelJob(request: TravelJobRequest, tx?: Prisma.TransactionClient): Promise<TravelJob> {
  if (!tx) return prisma.$transaction(transaction => enqueueTravelJob(request, transaction));
  // Follow the same resource-first lock order as result commits. This also
  // serializes enqueue with a generation change without taking over the lease.
  await lockTravelResource(tx, request.kind);
  let activeKey: string = request.kind;
  let owner: { userId: string | null } | null = null;
  if (request.kind === 'flight_query') {
    activeKey += `:${request.queryId}`;
    owner = (await tx.$queryRaw<{ userId: string | null }[]>`SELECT "userId" FROM "Query" WHERE id = ${request.queryId} FOR UPDATE`)[0] ?? null;
  }
  if (request.kind === 'hotel_search') {
    activeKey += `:${request.hotelRunId}`;
    const source = await tx.hotelSearchRun.findUnique({ where: { id: request.hotelRunId }, select: { trackerId: true } });
    if (source?.trackerId) {
      const trackers = await tx.$queryRaw<{ userId: string | null }[]>`SELECT "userId" FROM "HotelTracker" WHERE id = ${source.trackerId} FOR UPDATE`;
      if (!trackers[0] || trackers[0].userId !== request.userId) throw new TravelJobError('Travel job owner does not match its tracker', 404);
    }
    owner = (await tx.$queryRaw<{ userId: string | null }[]>`SELECT "userId" FROM "HotelSearchRun" WHERE id = ${request.hotelRunId} FOR UPDATE`)[0] ?? null;
  }
  if (request.kind === 'car_search') {
    activeKey += `:${request.carRunId}`;
    const source = await tx.carSearchRun.findUnique({ where: { id: request.carRunId }, select: { trackerId: true } });
    if (source?.trackerId) {
      const trackers = await tx.$queryRaw<{ userId: string | null }[]>`SELECT "userId" FROM "CarTracker" WHERE id = ${source.trackerId} FOR UPDATE`;
      if (!trackers[0] || trackers[0].userId !== request.userId) throw new TravelJobError('Travel job owner does not match its tracker', 404);
    }
    owner = (await tx.$queryRaw<{ userId: string | null }[]>`SELECT "userId" FROM "CarSearchRun" WHERE id = ${request.carRunId} FOR UPDATE`)[0] ?? null;
  }
  if (request.kind !== 'flight_batch' && (!owner || owner.userId !== request.userId)) throw new TravelJobError('Travel job owner does not match its source', 404);
  const conflict = request.kind === 'hotel_search'
    ? Prisma.sql`("hotelRunId") DO UPDATE SET "hotelRunId" = EXCLUDED."hotelRunId"`
    : request.kind === 'car_search'
      ? Prisma.sql`("carRunId") DO UPDATE SET "carRunId" = EXCLUDED."carRunId"`
      : Prisma.sql`("activeKey") DO UPDATE SET "activeKey" = EXCLUDED."activeKey"`;
  const jobs = await tx.$queryRaw<TravelJob[]>`
    INSERT INTO "TravelJob" (id, kind, "userId", "queryId", "hotelRunId", "carRunId", "activeKey")
    VALUES (${randomUUID()}, ${request.kind}::"TravelJobKind", ${request.userId},
      ${request.kind === 'flight_query' ? request.queryId : null},
      ${request.kind === 'hotel_search' ? request.hotelRunId : null},
      ${request.kind === 'car_search' ? request.carRunId : null}, ${activeKey})
    ON CONFLICT ${conflict} RETURNING *`;
  const job = jobs[0];
  if (!job) throw new TravelJobError('Travel job could not be queued');
  if (job.userId !== request.userId) throw new TravelJobError('Previous owner still has an active job; cancel it before reassignment');
  return job;
}
function duration(ms: number): number {
  if (!Number.isSafeInteger(ms) || ms < 1000 || ms > 600_000) throw new TravelJobError('Invalid lease duration', 400);
  return ms;
}
export async function acquireTravelLease(id: string, milliseconds = DEFAULT_LEASE_MS): Promise<TravelLeaseToken | null> {
  if (id !== 'vpn' && id !== 'browser') throw new TravelJobError('Unknown travel resource', 400);
  const owner = randomUUID();
  duration(milliseconds);
  await prisma.$executeRaw`
    INSERT INTO "TravelLease" (id, owner, "expiresAt") VALUES (${id}, ${owner}, ${new Date(0)})
    ON CONFLICT (id) DO NOTHING`;
  const leases = await prisma.$queryRaw<TravelLease[]>`
    UPDATE "TravelLease" SET "owner" = ${owner}, "generation" = "generation" + 1,
      "expiresAt" = clock_timestamp() + ${duration(milliseconds)} * interval '1 millisecond'
    WHERE "id" = ${id} AND "expiresAt" <= clock_timestamp() RETURNING *`;
  return leases[0] ? { id, owner, generation: leases[0].generation } : null;
}
export async function renewTravelLease(lease: TravelLeaseToken, milliseconds = DEFAULT_LEASE_MS): Promise<boolean> {
  const count = await prisma.$executeRaw`
    UPDATE "TravelLease" SET "expiresAt" = clock_timestamp() + ${duration(milliseconds)} * interval '1 millisecond'
    WHERE "id" = ${lease.id} AND "owner" = ${lease.owner} AND "generation" = ${lease.generation}
      AND "expiresAt" > clock_timestamp()`;
  return count === 1;
}
export async function releaseTravelLease(lease: TravelLeaseToken): Promise<void> {
  await prisma.travelLease.updateMany({ where: { id: lease.id, owner: lease.owner, generation: lease.generation }, data: { expiresAt: new Date(0) } });
}
export async function lockTravelLease(tx: Prisma.TransactionClient, lease: TravelLeaseToken): Promise<void> {
  const current = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "TravelLease" WHERE "id" = ${lease.id} AND "owner" = ${lease.owner}
      AND "generation" = ${lease.generation} AND "expiresAt" > clock_timestamp() FOR UPDATE`;
  if (!current.length) throw new TravelJobError('Travel worker lease was lost');
}
export async function claimTravelJob(id: string, lease: TravelLeaseToken): Promise<TravelJob | null> {
  return prisma.$transaction(async tx => {
    await lockTravelLease(tx, lease);
    const rows = await tx.$queryRaw<TravelJob[]>`SELECT * FROM "TravelJob" WHERE id = ${id} AND status = 'queued' FOR UPDATE`;
    const job = rows[0];
    if (!job) return null;
    if (travelResource(job.kind) !== lease.id) throw new TravelJobError('Worker does not hold the required resource');
    return tx.travelJob.update({ where: { id }, data: { status: 'running', attempts: { increment: 1 }, claimedAt: new Date(), leaseResource: lease.id, leaseOwner: lease.owner, leaseGeneration: lease.generation } });
  });
}
/** Acquire before domain row locks and keep this transaction open through writes. */
export async function guardTravelJob(tx: Prisma.TransactionClient, id: string, lease: TravelLeaseToken): Promise<TravelJob> {
  await lockTravelLease(tx, lease);
  const rows = await tx.$queryRaw<TravelJob[]>`
    SELECT * FROM "TravelJob" WHERE id = ${id} AND status = 'running'
      AND "leaseResource" = ${lease.id} AND "leaseOwner" = ${lease.owner} AND "leaseGeneration" = ${lease.generation} FOR UPDATE`;
  if (!rows[0]) throw new TravelJobError('Travel job was cancelled, completed or reclaimed');
  return rows[0];
}
export async function completeTravelJob<T>(id: string, lease: TravelLeaseToken, persist: (tx: Prisma.TransactionClient, job: TravelJob) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    const job = await guardTravelJob(tx, id, lease);
    const result = await persist(tx, job);
    await lockTravelLease(tx, lease);
    await tx.travelJob.update({ where: { id }, data: { ...clearClaim, status: 'succeeded', completedAt: new Date() } });
    return result;
  });
}
export async function failTravelJob(id: string, lease: TravelLeaseToken, error: unknown, persist?: (tx: Prisma.TransactionClient, job: TravelJob) => Promise<void>): Promise<void> {
  await prisma.$transaction(async tx => {
    const job = await guardTravelJob(tx, id, lease);
    await persist?.(tx, job);
    await lockTravelLease(tx, lease);
    await tx.travelJob.update({ where: { id }, data: { ...clearClaim, status: 'failed', error: (error instanceof Error ? error.message : String(error)).slice(0,4000), completedAt: new Date() } });
  });
}
export async function cancelTravelJob(id: string, userId: string | null, isAdmin: boolean, tx: Prisma.TransactionClient = prisma): Promise<boolean> {
  const changed = await tx.travelJob.updateMany({
    where: { id, status: { in: ['queued', 'running'] }, ...(isAdmin ? {} : { userId }) },
    data: { ...clearClaim, status: 'cancelled', cancelledAt: new Date(), completedAt: new Date() },
  });
  return changed.count === 1;
}
/** Recovery marks interrupted work visibly failed; it never manufactures prices. */
export async function recoverTravelJobs(lease: TravelLeaseToken, recover: (tx: Prisma.TransactionClient, job: TravelJob) => Promise<void>): Promise<number> {
  return prisma.$transaction(async tx => {
    await lockTravelLease(tx, lease);
    const jobs = await tx.travelJob.findMany({ where: { status: 'running', leaseResource: lease.id, OR: [{ leaseOwner: { not: lease.owner } }, { leaseGeneration: { not: lease.generation } }] } });
    let recovered = 0;
    for (const job of jobs) {
      const changed = await tx.travelJob.updateMany({ where: { id: job.id, status: 'running', leaseGeneration: job.leaseGeneration }, data: { ...clearClaim, status: 'failed', error: 'Travel worker interrupted; refresh to retry', completedAt: new Date() } });
      if (changed.count) { await recover(tx, job); recovered++; }
    }
    return recovered;
  });
}

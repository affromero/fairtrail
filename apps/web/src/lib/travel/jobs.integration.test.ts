import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { acquireTravelLease, cancelTravelJob, claimTravelJob, completeTravelJob, enqueueTravelJob, failTravelJob, lockTravelAdmission, lockTravelResource, releaseTravelLease, renewTravelLease } from './jobs';
import { getTravelAdmission, recoverTravelAdmission } from './admission';
import type { TravelLeaseToken } from './jobs';

const enabled = process.env.TRAVEL_INTEGRATION_TESTS === '1';
let queryId: string;
let ownerId: string;
let otherId: string;
const json = {};
async function lease(resource = 'vpn'): Promise<TravelLeaseToken> {
  const token = await acquireTravelLease(resource);
  if (!token) throw new Error('Expected the isolated resource to be available');
  return token;
}

describe.skipIf(!enabled)('shared travel jobs against isolated PostgreSQL', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
    if (url.hostname !== '127.0.0.1' || url.port !== '55440' || url.pathname !== '/car_test') throw new Error('Travel integration tests require the disposable localhost:55440/car_test database');
    const suffix = crypto.randomUUID();
    ownerId = (await prisma.user.create({ data: { username: `travel-owner-${suffix}` } })).id;
    otherId = (await prisma.user.create({ data: { username: `travel-other-${suffix}` } })).id;
    queryId = (await prisma.query.create({ data: {
      rawInput: 'Travel compatibility sentinel', origin: 'LHR', originName: 'London', destination: 'JFK', destinationName: 'New York',
      dateFrom: new Date('2027-05-01'), dateTo: new Date('2027-05-10'), expiresAt: new Date('2027-05-01'),
      currency: 'GBP', cabinClass: 'business', vpnCountries: ['DE'], scrapeInterval: 6, userId: ownerId, label: 'Unchanged',
    } })).id;
  });
  beforeEach(async () => {
    await prisma.travelJob.deleteMany();
    await prisma.travelLease.deleteMany();
    await prisma.travelAdmission.deleteMany();
    await prisma.carTracker.deleteMany();
    await prisma.carSearchRun.deleteMany();
    await prisma.hotelSearchRun.deleteMany();
    await prisma.query.update({ where: { id: queryId }, data: { label: 'Unchanged', userId: ownerId } });
  });
  afterAll(async () => {
    if (!queryId) return;
    await prisma.travelJob.deleteMany();
    await prisma.travelLease.deleteMany();
    await prisma.travelAdmission.deleteMany();
    await prisma.query.delete({ where: { id: queryId } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
    await prisma.$disconnect();
  });
  it('deduplicates simultaneous scheduled batches and manual refreshes without merging their scopes', async () => {
    const queries = await Promise.all(Array.from({ length: 4 }, () => enqueueTravelJob({ kind: 'flight_query', queryId, userId: ownerId })));
    const batches = await Promise.all(Array.from({ length: 4 }, () => enqueueTravelJob({ kind: 'flight_batch', userId: null })));
    expect(new Set(queries.map(q => q.id)).size).toBe(1);
    expect(new Set(batches.map(q => q.id)).size).toBe(1);
    expect(queries[0]!.id).not.toBe(batches[0]!.id);
    expect(await prisma.query.findUnique({ where: { id: queryId } })).toMatchObject({ label: 'Unchanged', currency: 'GBP', cabinClass: 'business', vpnCountries: ['DE'], scrapeInterval: 6 });
  });
  it('keeps one shared job for an existing hotel or car search', async () => {
    const hotel = await prisma.hotelSearchRun.create({ data: { userId: ownerId, request: json } });
    const car = await prisma.carSearchRun.create({ data: { userId: ownerId, request: json } });
    const first = await enqueueTravelJob({ kind: 'hotel_search', hotelRunId: hotel.id, userId: ownerId });
    const second = await enqueueTravelJob({ kind: 'car_search', carRunId: car.id, userId: ownerId });
    expect((await enqueueTravelJob({ kind: 'hotel_search', hotelRunId: hotel.id, userId: ownerId })).id).toBe(first.id);
    expect((await enqueueTravelJob({ kind: 'car_search', carRunId: car.id, userId: ownerId })).id).toBe(second.id);
    await expect(enqueueTravelJob({ kind: 'car_search', carRunId: car.id, userId: otherId })).rejects.toThrow(/owner/);
  });
  it('rejects a different owner and refuses their cancellation request', async () => {
    await expect(enqueueTravelJob({ kind: 'flight_query', queryId, userId: otherId })).rejects.toThrow(/owner/);
    const job = await enqueueTravelJob({ kind: 'flight_query', queryId, userId: ownerId });
    expect(await cancelTravelJob(job.id, otherId, false)).toBe(false);
    expect((await prisma.travelJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('queued');
  });
  it('does not return an old-owner job when its source is reassigned', async () => {
    const run = await prisma.carSearchRun.create({ data: { userId: ownerId, request: json } });
    await enqueueTravelJob({ kind: 'car_search', carRunId: run.id, userId: ownerId });
    await prisma.carSearchRun.update({ where: { id: run.id }, data: { userId: otherId } });
    await expect(enqueueTravelJob({ kind: 'car_search', carRunId: run.id, userId: otherId })).rejects.toThrow(/owner/);
    await expect(enqueueTravelJob({ kind: 'car_search', carRunId: run.id, userId: ownerId })).rejects.toThrow(/owner/);
  });
  it('rechecks source ownership after a concurrent reassignment releases its row lock', async () => {
    let markLocked!: () => void, releaseLock!: () => void;
    const locked = new Promise<void>(resolve => { markLocked = resolve; });
    const release = new Promise<void>(resolve => { releaseLock = resolve; });
    const reassignment = prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Query" WHERE id = ${queryId} FOR UPDATE`;
      markLocked(); await release;
      await tx.query.update({ where: { id: queryId }, data: { userId: otherId } });
    });
    await locked;
    const queued = enqueueTravelJob({ kind: 'flight_query', queryId, userId: ownerId });
    releaseLock(); await reassignment;
    await expect(queued).rejects.toThrow(/owner/);
    expect(await prisma.travelJob.count({ where: { queryId } })).toBe(0);
  });
  it('holds one lease per resource while keeping direct hotel/car browsing separate from VPN mutation', async () => {
    const tokens = await Promise.all([acquireTravelLease('vpn'), acquireTravelLease('vpn')]);
    expect(tokens.filter(Boolean)).toHaveLength(1);
    expect(await acquireTravelLease('browser')).not.toBeNull();
    const current = tokens.find(t => t !== null)!;
    await releaseTravelLease(current);
    expect((await lease()).generation).toBeGreaterThan(current.generation);
  });
  it('serializes short admission transactions across different execution resources', async () => {
    const active = new Set<string>();
    let overlapped = false;
    await Promise.all((['car_search', 'flight_batch'] as const).map(kind => prisma.$transaction(async tx => {
      await lockTravelResource(tx, kind);
      if (active.size) overlapped = true;
      active.add(kind);
      await new Promise(resolve => setTimeout(resolve, 30));
      active.delete(kind);
    })));
    expect(overlapped).toBe(false);
    expect(await acquireTravelLease('browser')).not.toBeNull();
    expect(await acquireTravelLease('vpn')).not.toBeNull();
  });
  it('releases transaction admission after rollback without leaking a session lock', async () => {
    await expect(prisma.$transaction(async tx => {
      await lockTravelAdmission(tx);
      await tx.query.update({ where: { id: queryId }, data: { label: 'Must roll back' } });
      throw new Error('Admission transaction interrupted');
    })).rejects.toThrow(/interrupted/);
    expect((await prisma.query.findUniqueOrThrow({ where: { id: queryId } })).label).toBe('Unchanged');
    const current = await lease();
    expect(await renewTravelLease(current)).toBe(true);
    await releaseTravelLease(current);
    expect((await lease()).generation).toBeGreaterThan(current.generation);
  });
  it('lets cancellation win before a late result reaches domain persistence', async () => {
    const job = await enqueueTravelJob({ kind: 'flight_query', queryId, userId: ownerId });
    const token = await lease(); await claimTravelJob(job.id, token);
    let locked!: () => void, release!: () => void;
    const admitted = new Promise<void>(resolve => { locked = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const cancellation = prisma.$transaction(async tx => {
      await lockTravelAdmission(tx); locked(); await pending;
      return cancelTravelJob(job.id, ownerId, false, tx);
    });
    await admitted;
    const completing = completeTravelJob(job.id, token, tx => tx.query.update({ where: { id: queryId }, data: { label: 'Cancelled result' } }));
    const rejected = expect(completing).rejects.toThrow(/cancelled/);
    release();
    expect(await cancellation).toBe(true);
    await rejected;
    expect((await prisma.query.findUniqueOrThrow({ where: { id: queryId } })).label).toBe('Unchanged');
    expect((await prisma.travelJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('cancelled');
  });
  it('cannot renew or release a replacement worker lease with an expired token', async () => {
    const old = await lease();
    await prisma.travelLease.update({ where: { id: old.id }, data: { expiresAt: new Date(0) } });
    expect(await renewTravelLease(old)).toBe(false);
    await expect(acquireTravelLease('vpn')).rejects.toMatchObject({ status: 503 });
    await recoverTravelAdmission({ userId: ownerId, isAdmin: true }, { generation: (await getTravelAdmission()).recoveryGeneration, oldWorkersStopped: true, networkVerified: true });
    const replacement = await lease();
    await releaseTravelLease(old);
    expect(await renewTravelLease(replacement)).toBe(true);
    expect(await acquireTravelLease('vpn')).toBeNull();
  });
  it('rejects claiming a flight job with a direct-browser lease', async () => {
    const job = await enqueueTravelJob({ kind: 'flight_query', queryId, userId: ownerId });
    await expect(claimTravelJob(job.id, await lease('browser'))).rejects.toThrow(/resource/);
    expect((await prisma.travelJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('queued');
  });
  it('atomically commits domain writes and releases the active refresh key for the next request', async () => {
    const job = await enqueueTravelJob({ kind: 'flight_query', queryId, userId: ownerId });
    const token = await lease(); await claimTravelJob(job.id, token);
    await completeTravelJob(job.id, token, tx => tx.query.update({ where: { id: queryId }, data: { label: 'Committed' } }));
    expect(await prisma.travelJob.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'succeeded', activeKey: null, leaseOwner: null, attempts: 1 });
    expect((await prisma.query.findUniqueOrThrow({ where: { id: queryId } })).label).toBe('Committed');
    expect((await enqueueTravelJob({ kind: 'flight_query', queryId, userId: ownerId })).id).not.toBe(job.id);
  });
  it('rolls back both domain writes and completion when persistence fails', async () => {
    const job = await enqueueTravelJob({ kind: 'flight_query', queryId, userId: ownerId });
    const token = await lease(); await claimTravelJob(job.id, token);
    await expect(completeTravelJob(job.id, token, async tx => {
      await tx.query.update({ where: { id: queryId }, data: { label: 'Must roll back' } });
      throw new Error('Storage failed');
    })).rejects.toThrow(/Storage/);
    expect((await prisma.query.findUniqueOrThrow({ where: { id: queryId } })).label).toBe('Unchanged');
    expect((await prisma.travelJob.findUniqueOrThrow({ where: { id: job.id } })).status).toBe('running');
    await failTravelJob(job.id, token, new Error('Storage failed'));
    expect(await prisma.travelJob.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'failed', error: 'Storage failed', activeKey: null });
  });
  it('rolls back a result if its lease expires during the commit transaction', async () => {
    const job = await enqueueTravelJob({ kind: 'flight_query', queryId, userId: ownerId });
    const token = await lease(); await claimTravelJob(job.id, token);
    await expect(completeTravelJob(job.id, token, async tx => {
      await tx.query.update({ where: { id: queryId }, data: { label: 'Late result' } });
      await tx.travelLease.update({ where: { id: token.id }, data: { expiresAt: new Date(0) } });
    })).rejects.toThrow(/lease/);
    expect((await prisma.query.findUniqueOrThrow({ where: { id: queryId } })).label).toBe('Unchanged');
  });
  it('never commits a late result after cancellation or lease replacement', async () => {
    const first = await enqueueTravelJob({ kind: 'flight_query', queryId, userId: ownerId });
    const old = await lease(); await claimTravelJob(first.id, old);
    await cancelTravelJob(first.id, ownerId, false);
    await expect(completeTravelJob(first.id, old, tx => tx.query.update({ where: { id: queryId }, data: { label: 'Cancelled result' } }))).rejects.toThrow(/cancelled/);
    const second = await enqueueTravelJob({ kind: 'flight_query', queryId, userId: ownerId });
    await claimTravelJob(second.id, old);
    await prisma.travelLease.update({ where: { id: old.id }, data: { expiresAt: new Date(0) } });
    const incident = await getTravelAdmission();
    await recoverTravelAdmission({ userId: ownerId, isAdmin: true }, { generation: incident.recoveryGeneration, oldWorkersStopped: true, networkVerified: true });
    await lease();
    await expect(completeTravelJob(second.id, old, tx => tx.query.update({ where: { id: queryId }, data: { label: 'Replaced result' } }))).rejects.toThrow(/lease/);
    expect(await prisma.travelJob.findUnique({ where: { id: second.id } })).toMatchObject({ status: 'failed', error: expect.stringMatching(/interrupted/) });
    expect((await prisma.query.findUniqueOrThrow({ where: { id: queryId } })).label).toBe('Unchanged');
  });
  it('enforces reference and lifecycle invariants even when callers bypass the service', async () => {
    await expect(prisma.travelJob.create({ data: { kind: 'car_search', queryId, activeKey: `car_search:${queryId}` } })).rejects.toThrow();
    await expect(prisma.travelJob.create({ data: { kind: 'flight_query', queryId, activeKey: null } })).rejects.toThrow();
    await expect(prisma.travelJob.create({ data: { kind: 'flight_query', queryId, activeKey: `flight_query:${queryId}`, status: 'running' } })).rejects.toThrow();
    await expect(prisma.travelAlertDelivery.create({ data: { eventKey: 'no-domain', message: json } })).rejects.toThrow();
  });
  it('enforces one active car refresh and safe integer prices at the database boundary', async () => {
    const tracker = await prisma.carTracker.create({ data: { userId: ownerId, label: 'DB constraints', currency: 'USD', search: json } });
    await prisma.carSearchRun.create({ data: { trackerId: tracker.id, request: json } });
    await expect(prisma.carSearchRun.create({ data: { trackerId: tracker.id, request: json } })).rejects.toThrow();
    await expect(prisma.carTracker.update({ where: { id: tracker.id }, data: { targetMinor: -1n } })).rejects.toThrow();
    await expect(prisma.carTracker.update({ where: { id: tracker.id }, data: { targetMinor: 9007199254740992n } })).rejects.toThrow();
  });
  it('rejects a snapshot that references another tracker’s search run', async () => {
    const first = await prisma.carTracker.create({ data: { userId: ownerId, label: 'First rental', currency: 'USD', search: json } });
    const second = await prisma.carTracker.create({ data: { userId: ownerId, label: 'Second rental', currency: 'USD', search: json } });
    const run = await prisma.carSearchRun.create({ data: { trackerId: first.id, request: json } });
    await expect(prisma.carSnapshot.create({ data: { trackerId: second.id, runId: run.id, source: 'discovercars', offer: json, currency: 'USD', totalMinor: 10000n, eligible: true, contractHash: 'a'.repeat(64), observedAt: new Date() } })).rejects.toThrow();
    expect(await prisma.carSnapshot.count({ where: { trackerId: second.id } })).toBe(0);
  });
});

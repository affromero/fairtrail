import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { acquireTravelLease, claimTravelJob, completeTravelJob, releaseTravelLease, type TravelLeaseToken } from '../travel/jobs';
import { cancelCarSearch, carJson, carMinorNumber, carTrackerDto, createCarSearch, createCarCatalogSearch, createCarTracker, deleteCarTracker, editCarTracker, getCarSearch, getCarTracker, listCarTrackers, refreshCarTracker } from './store';
import { carOfferFixture as offer, carSearchFixture as criteria, carReportFixture } from '@/test/car-fixtures';
import { finishCarRun } from './persistence';
import { carContractHash } from './selection';
import type { CarActor } from './access';
import { searchCarLocations } from './locations';
import { getCarRunView } from './views';
import { listCarSearchPage } from './search-list';

describe.skipIf(process.env.CAR_STORE_INTEGRATION_TESTS !== '1')('car ownership and persistence against isolated PostgreSQL', () => {
  let owner: CarActor, other: CarActor;
  const leases: TravelLeaseToken[] = [];
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
    if (url.hostname !== '127.0.0.1' || url.port !== '55440' || url.pathname !== '/car_test') throw new Error('Car store tests require disposable localhost:55440/car_test');
  });
  beforeEach(async () => {
    const suffix = crypto.randomUUID();
    owner = { userId: (await prisma.user.create({ data: { username: `car-store-owner-${suffix}` } })).id, isAdmin: false };
    other = { userId: (await prisma.user.create({ data: { username: `car-store-other-${suffix}` } })).id, isAdmin: false };
  });
  afterEach(async () => {
    for (const lease of leases.splice(0)) await releaseTravelLease(lease);
    if (!owner || !other) return;
    const userIds = [owner.userId!, other.userId!];
    await prisma.travelJob.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  async function completedSearch(value = offer()) {
    return prisma.carSearchRun.create({ data: { userId: owner.userId, request: carJson(criteria()), result: carJson({ offers: [value], candidates: [], errors: [] }), status: 'success', completedAt: new Date() } });
  }
  async function tracker(mode: 'best' | 'contract' = 'best') {
    const run = await completedSearch();
    return createCarTracker({ searchId: run.id, offerId: 'verified-quote', mode, target: { currency: 'GBP', minor: 9000 } }, owner);
  }
  async function running(id: string) {
    const run = await refreshCarTracker(id, owner);
    const job = await prisma.travelJob.findUniqueOrThrow({ where: { carRunId: run!.id } });
    const lease = await acquireTravelLease('browser');
    if (!lease) throw new Error('Expected isolated browser lease');
    leases.push(lease);
    await claimTravelJob(job.id, lease);
    await prisma.carSearchRun.update({ where: { id: run!.id }, data: { status: 'running' } });
    return { run: run!, job, lease };
  }

  it('serializes concurrent search quotas and creates each accepted run with one shared job', async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => createCarSearch(criteria(), owner)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(3);
    expect(results.filter(result => result.status === 'rejected').map(result => result.reason)).toEqual([expect.objectContaining({ status: 429 }), expect.objectContaining({ status: 429 })]);
    const runs = await prisma.carSearchRun.findMany({ where: { userId: owner.userId }, include: { travelJob: true } });
    expect(runs).toHaveLength(3);
    expect(runs.every(run => run.travelJob?.userId === owner.userId && run.travelJob.status === 'queued')).toBe(true);
  });
  it('paginates owned standalone history even when a cursor row is deleted and does not expose another account', async () => {
    const createdAt = new Date();
    for (let index = 0; index < 3; index++) await prisma.carSearchRun.create({ data: { userId: owner.userId, request: carJson(criteria()), status: 'cancelled', createdAt, completedAt: createdAt } });
    const foreign = await prisma.carSearchRun.create({ data: { userId: other.userId, request: carJson(criteria()), status: 'cancelled', createdAt, completedAt: createdAt } });
    const first = await listCarSearchPage(owner, null, 2);
    expect(first.searches).toHaveLength(2);
    expect(first.searches.every(row => row.id !== foreign.id)).toBe(true);
    expect(first.nextCursor).not.toBeNull();
    await prisma.carSearchRun.delete({ where: { id: first.searches.at(-1)!.id } });
    const second = await listCarSearchPage(owner, first.nextCursor, 2);
    expect(second.searches).toHaveLength(1); expect(second.nextCursor).toBeNull();
    expect(first.searches.some(row => row.id === second.searches[0]!.id)).toBe(false);
    await expect(listCarSearchPage(other, first.nextCursor)).rejects.toMatchObject({ status: 400 });
    expect((await listCarSearchPage({ ...other, isAdmin: true })).searches.map(row => row.id)).toEqual([foreign.id]);
  });

  it('recovers concurrent catalog search creation without duplicate jobs and preserves a deleted-run receipt', async () => {
    const place = (await searchCarLocations('LHR'))[0]!;
    const search = criteria(), key = crypto.randomUUID();
    const body = { pickup: { id: place.id, version: place.version }, dropoff: { id: place.id, version: place.version }, pickupAt: { date: search.pickupAt.date, time: search.pickupAt.time }, dropoffAt: { date: search.dropoffAt.date, time: search.dropoffAt.time }, driver: search.driver, currency: search.currency, sources: search.sources };
    const runs = await Promise.all(Array.from({ length: 4 }, () => createCarCatalogSearch(body, owner, key)));
    expect(new Set(runs.map(run => run.id)).size).toBe(1);
    expect(await prisma.travelJob.count({ where: { userId: owner.userId } })).toBe(1);
    const view = await getCarRunView(runs[0]!.id, owner);
    expect(view).toMatchObject({ status: 'queued', search: { pickup: { country: 'GB', providerIds: {}, catalog: { id: place.id } } }, result: null });
    await expect(createCarCatalogSearch({ ...body, currency: 'USD' }, owner, key)).rejects.toMatchObject({ status: 409 });
    await cancelCarSearch(view.id, owner);
    expect((await createCarCatalogSearch(body, owner, key)).status).toBe('cancelled');
    await prisma.travelJob.deleteMany({ where: { carRunId: view.id } });
    await prisma.carSearchRun.delete({ where: { id: view.id } });
    await expect(createCarCatalogSearch(body, owner, key)).rejects.toMatchObject({ status: 410 });
    expect(await prisma.carSearchRun.count({ where: { userId: owner.userId } })).toBe(0);
    expect(await prisma.carSearchCreation.count({ where: { userId: owner.userId, runId: null } })).toBe(1);
  }, 20_000);

  it('creates best tracking without narrowing provider preferences or retaining the discovery ceiling', async () => {
    const row = await tracker();
    expect(carTrackerDto(row)).toMatchObject({ selection: null, options: { mode: 'best' }, search: { sources: ['discovercars', 'autoeurope'], filters: { maxTotal: null } } });
    const queued = await prisma.carSearchRun.findFirstOrThrow({ where: { trackerId: row.id }, include: { travelJob: true } });
    expect(queued).toMatchObject({ trackerRevision: 0, status: 'queued', travelJob: { kind: 'car_search', userId: owner.userId } });
  });

  it('records concurrent refresh identities against one active run and replays them after completion', async () => {
    const row = await tracker(), key = crypto.randomUUID(), another = crypto.randomUUID();
    const runs = await Promise.all([key, key, another].map(key => refreshCarTracker(row.id, owner, false, { key, revision: 0 })));
    expect(new Set(runs.map(run => run!.id)).size).toBe(1);
    expect(await prisma.carRefreshRequest.count({ where: { userId: owner.userId } })).toBe(2);
    const active = await running(row.id);
    await finishCarRun(active.job.id, active.lease, carReportFixture());
    for (const receiptKey of [key, another]) expect(await refreshCarTracker(row.id, owner, false, { key: receiptKey, revision: 0 })).toMatchObject({ id: runs[0]!.id, status: 'success' });
    expect(await prisma.carSearchRun.count({ where: { trackerId: row.id } })).toBe(1);
    expect(await prisma.travelJob.count({ where: { userId: owner.userId } })).toBe(1);
  });

  it('replays a lost refresh acknowledgement after pause without restarting cancelled work', async () => {
    const row = await tracker(), key = crypto.randomUUID();
    const run = await refreshCarTracker(row.id, owner, false, { key, revision: 0 });
    await editCarTracker(row.id, { active: false }, owner, 0);
    expect(await refreshCarTracker(row.id, owner, false, { key, revision: 0 })).toMatchObject({ id: run!.id, status: 'cancelled' });
    await expect(refreshCarTracker(row.id, owner, false, { key: crypto.randomUUID(), revision: 0 })).rejects.toMatchObject({ status: 412 });
    await expect(refreshCarTracker(row.id, owner, false, { key: crypto.randomUUID(), revision: 1 })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.carSearchRun.count({ where: { trackerId: row.id } })).toBe(1);
  });

  it('rejects refresh key reuse for different settings or trackers', async () => {
    const row = await tracker(), second = await tracker(), key = crypto.randomUUID();
    await refreshCarTracker(row.id, owner, false, { key, revision: 0 });
    await expect(refreshCarTracker(row.id, owner, false, { key, revision: 1 })).rejects.toMatchObject({ status: 409 });
    await expect(refreshCarTracker(second.id, owner, false, { key, revision: 0 })).rejects.toMatchObject({ status: 409 });
    expect(await prisma.carRefreshRequest.count({ where: { userId: owner.userId } })).toBe(1);
  });

  it('retains refresh tombstones after pruning a run and deleting its tracker', async () => {
    const row = await tracker(), key = crypto.randomUUID();
    const run = await refreshCarTracker(row.id, owner, false, { key, revision: 0 });
    await cancelCarSearch(run!.id, owner);
    await prisma.travelJob.deleteMany({ where: { carRunId: run!.id } });
    await prisma.carSearchRun.delete({ where: { id: run!.id } });
    await expect(refreshCarTracker(row.id, owner, false, { key, revision: 0 })).rejects.toMatchObject({ status: 410 });
    await deleteCarTracker(row.id, owner);
    await expect(refreshCarTracker(row.id, owner, false, { key, revision: 0 })).rejects.toMatchObject({ status: 410 });
    expect(await prisma.carRefreshRequest.findFirst({ where: { userId: owner.userId } })).toMatchObject({ trackerId: row.id, runId: null });
    expect(await prisma.carSearchRun.count({ where: { trackerId: row.id } })).toBe(0);
  });

  it('checks current ownership before replaying a refresh receipt after reassignment', async () => {
    const row = await tracker(), key = crypto.randomUUID();
    await refreshCarTracker(row.id, owner, false, { key, revision: 0 });
    await editCarTracker(row.id, { userId: other.userId }, { ...owner, isAdmin: true });
    await expect(refreshCarTracker(row.id, owner, false, { key, revision: 0 })).rejects.toMatchObject({ status: 404 });
    const next = await refreshCarTracker(row.id, other, false, { key, revision: 1 });
    expect(next).toMatchObject({ userId: other.userId, trackerRevision: 1, status: 'queued' });
  });

  it('derives exact contract identity from the owned result rather than client prices or hashes', async () => {
    const run = await completedSearch();
    const row = await createCarTracker({ searchId: run.id, offerId: 'verified-quote', mode: 'contract', contractHash: 'forged', price: 1 }, owner);
    expect(row.selection).toEqual({ source: 'discovercars', contractHash: carContractHash(offer().contract) });
    expect(row.latestPriceMinor).toBeNull();
  });

  it('rolls back tracker creation if its first refresh cannot be enqueued', async () => {
    const run = await completedSearch();
    await Promise.all(Array.from({ length: 3 }, () => createCarSearch(criteria(), owner)));
    await expect(createCarTracker({ searchId: run.id, offerId: 'verified-quote' }, owner)).rejects.toMatchObject({ status: 429 });
    expect(await prisma.carTracker.count({ where: { userId: owner.userId } })).toBe(0);
    expect(await prisma.carSearchRun.count({ where: { userId: owner.userId, trackerId: { not: null } } })).toBe(0);
  });

  it('rejects stale, absent and foreign persisted quotes without creating trackers', async () => {
    const stale = await completedSearch(offer(new Date(Date.now() - 16 * 60_000).toISOString()));
    const current = await completedSearch();
    await expect(createCarTracker({ searchId: stale.id, offerId: 'verified-quote' }, owner)).rejects.toMatchObject({ status: 409 });
    await expect(createCarTracker({ searchId: current.id, offerId: 'invented' }, owner)).rejects.toThrow(/returned/);
    await expect(createCarTracker({ searchId: current.id, offerId: 'verified-quote' }, other)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.carTracker.count({ where: { userId: owner.userId } })).toBe(0);
  });

  it('returns the same active refresh for concurrent callers and uses the tracker owner for an administrator', async () => {
    const row = await tracker();
    const runs = await Promise.all(Array.from({ length: 4 }, () => refreshCarTracker(row.id, { ...other, isAdmin: true })));
    expect(new Set(runs.map(run => run!.id)).size).toBe(1);
    expect(runs.every(run => run!.userId === owner.userId && run!.trackerRevision === row.revision)).toBe(true);
    expect(await prisma.travelJob.count({ where: { carRun: { trackerId: row.id } } })).toBe(1);
  });

  it('hides another user’s searches and trackers from reads, lists and mutations', async () => {
    const row = await tracker();
    const run = await refreshCarTracker(row.id, owner);
    await expect(getCarTracker(row.id, other)).rejects.toMatchObject({ status: 404 });
    await expect(getCarSearch(run!.id, other)).rejects.toMatchObject({ status: 404 });
    await expect(editCarTracker(row.id, { active: false }, other)).rejects.toMatchObject({ status: 404 });
    await expect(deleteCarTracker(row.id, other)).rejects.toMatchObject({ status: 404 });
    expect(await listCarTrackers(other)).toEqual([]);
  });

  it('keeps administrators’ normal lists personal and requires explicit authorized administration listing', async () => {
    const row = await tracker();
    const admin = { ...other, isAdmin: true };
    expect(await listCarTrackers(admin)).toEqual([]);
    expect(await listCarTrackers(admin, 100, true)).toEqual(expect.arrayContaining([expect.objectContaining({ id: row.id })]));
    await expect(listCarTrackers(other, 100, true)).rejects.toMatchObject({ status: 403 });
    expect(await listCarTrackers({ userId: null, isAdmin: true })).toEqual(expect.arrayContaining([expect.objectContaining({ id: row.id })]));
  });

  it.each(['search', 'result'] as const)('rejects corrupt persisted %s without partial tracker creation', async field => {
    const run = await completedSearch();
    await prisma.carSearchRun.update({ where: { id: run.id }, data: field === 'search' ? { request: { pickup: 'corrupt' } } : { result: { offers: [{ id: 'verified-quote' }] } } });
    await expect(createCarTracker({ searchId: run.id, offerId: 'verified-quote' }, owner)).rejects.toThrow();
    expect(await prisma.carTracker.count({ where: { userId: owner.userId } })).toBe(0);
    expect(await prisma.travelJob.count({ where: { userId: owner.userId } })).toBe(0);
  });

  it.each(['pause', 'target', 'reassign'] as const)('fences a running result and cancels pending deliveries after %s', async change => {
    const row = await tracker();
    const active = await running(row.id);
    await prisma.carTracker.update({ where: { id: row.id }, data: { historicalLowMinor: 8500 } });
    const delivery = await prisma.travelAlertDelivery.create({ data: { carTrackerId: row.id, eventKey: crypto.randomUUID(), message: {} } });
    const input = change === 'pause' ? { active: false } : change === 'target' ? { target: { currency: 'GBP', minor: 8000 } } : { userId: other.userId };
    const edited = await editCarTracker(row.id, input, { ...owner, isAdmin: true });
    expect(edited.revision).toBe(row.revision + 1);
    expect(edited.historicalLowMinor).toBe(8500n);
    const lateEvent = `late-${crypto.randomUUID()}`;
    await expect(completeTravelJob(active.job.id, active.lease, async tx => {
      await tx.carSnapshot.create({ data: { trackerId: row.id, runId: active.run.id, source: 'discovercars', offer: carJson(offer()), currency: 'GBP', totalMinor: 1, eligible: true, contractHash: carContractHash(offer().contract), observedAt: new Date() } });
      await tx.travelAlertDelivery.create({ data: { carTrackerId: row.id, eventKey: lateEvent, message: {} } });
      return tx.carTracker.update({ where: { id: row.id }, data: { latestPriceMinor: 1 } });
    })).rejects.toThrow(/cancelled|completed|reclaimed/);
    expect(await prisma.carSnapshot.count({ where: { trackerId: row.id } })).toBe(0);
    expect(await prisma.travelAlertDelivery.findUnique({ where: { eventKey: lateEvent } })).toBeNull();
    expect(await prisma.carSearchRun.findUnique({ where: { id: active.run.id } })).toMatchObject({ status: 'cancelled', completedAt: expect.any(Date), error: expect.stringMatching(/cancelled/) });
    expect(await prisma.travelAlertDelivery.findUnique({ where: { id: delivery.id } })).toMatchObject({ pending: false });
    expect((await getCarTracker(row.id, { ...owner, isAdmin: true })).latestPriceMinor).toBeNull();
    if (change === 'reassign') expect((await prisma.carSearchRun.findUniqueOrThrow({ where: { id: active.run.id } })).userId).toBe(owner.userId);
  });

  it('preserves historical lows on notification changes and rearms only a changed target', async () => {
    const row = await tracker();
    await prisma.carTracker.update({ where: { id: row.id }, data: { historicalLowMinor: 8500, targetArmed: false } });
    expect(await editCarTracker(row.id, { notifyLows: false }, owner)).toMatchObject({ historicalLowMinor: 8500n, targetArmed: false });
    expect(await editCarTracker(row.id, { target: { currency: 'GBP', minor: 8000 } }, owner)).toMatchObject({ historicalLowMinor: 8500n, targetArmed: true });
  });

  it('rejects manual refresh while paused and cancels standalone searches idempotently', async () => {
    const row = await tracker();
    await editCarTracker(row.id, { active: false }, owner);
    await expect(refreshCarTracker(row.id, owner)).rejects.toMatchObject({ status: 409 });
    expect(await refreshCarTracker(row.id, owner, true)).toBeNull();
    const run = await createCarSearch(criteria(), owner);
    await expect(cancelCarSearch(run.id, other)).rejects.toMatchObject({ status: 404 });
    await cancelCarSearch(run.id, owner);
    expect(await cancelCarSearch(run.id, owner)).toMatchObject({ status: 'cancelled' });
    expect(await prisma.travelJob.findUnique({ where: { carRunId: run.id } })).toMatchObject({ status: 'cancelled', activeKey: null });
  });

  it('prevents a deleted tracker’s active worker from persisting a late result', async () => {
    const row = await tracker();
    const active = await running(row.id);
    await deleteCarTracker(row.id, owner);
    await expect(completeTravelJob(active.job.id, active.lease, tx => tx.carTracker.update({ where: { id: row.id }, data: { latestPriceMinor: 1 } }))).rejects.toThrow(/cancelled|completed|reclaimed/);
    expect(await prisma.carTracker.findUnique({ where: { id: row.id } })).toBeNull();
    expect(await prisma.carSearchRun.count({ where: { trackerId: row.id } })).toBe(0);
  });

  it('serializes an edit racing a committed observation without allowing a second stale write', async () => {
    const row = await tracker();
    const active = await running(row.id);
    let markWriting!: () => void, releaseWriting!: () => void;
    const writing = new Promise<void>(resolve => { markWriting = resolve; });
    const release = new Promise<void>(resolve => { releaseWriting = resolve; });
    const completion = completeTravelJob(active.job.id, active.lease, async tx => {
      markWriting(); await release;
      await tx.carSearchRun.update({ where: { id: active.run.id }, data: { status: 'success', completedAt: new Date() } });
      return tx.carTracker.update({ where: { id: row.id }, data: { latestPriceMinor: 10000 } });
    });
    await writing;
    const edit = editCarTracker(row.id, { active: false }, owner);
    releaseWriting();
    await completion;
    expect(await edit).toMatchObject({ active: false, revision: 1, latestPriceMinor: 10000n });
    await expect(completeTravelJob(active.job.id, active.lease, tx => tx.carTracker.update({ where: { id: row.id }, data: { latestPriceMinor: 1 } }))).rejects.toThrow(/cancelled|completed|reclaimed/);
    expect((await getCarTracker(row.id, owner)).latestPriceMinor).toBe(10000n);
  });

  it('serializes safe monetary values and rejects corrupt stored amounts or selections', async () => {
    const row = await tracker();
    expect(JSON.parse(JSON.stringify(carTrackerDto({ ...row, latestPriceMinor: 12345n })))).toMatchObject({ latestPriceMinor: 12345, options: { target: { currency: 'GBP', minor: 9000 } } });
    expect(() => carMinorNumber(9007199254740992n)).toThrow(/range/);
    expect(() => carMinorNumber(-1n)).toThrow(/range/);
    expect(() => carTrackerDto({ ...row, mode: 'contract', selection: null })).toThrow(/selection/);
  });

  it('leaves flight and hotel configuration unchanged through the full tracker lifecycle', async () => {
    const flight = await prisma.query.create({ data: { userId: owner.userId, rawInput: 'Compatibility sentinel', origin: 'LHR', originName: 'London', destination: 'JFK', destinationName: 'New York', dateFrom: new Date('2027-05-01'), dateTo: new Date('2027-05-10'), expiresAt: new Date('2027-05-01'), currency: 'GBP', cabinClass: 'business', vpnCountries: ['DE'], scrapeInterval: 6 } });
    const hotel = await prisma.hotelTracker.create({ data: { userId: owner.userId, hotelName: 'Compatibility hotel', search: { unchanged: true }, selection: {}, options: { scrapeInterval: 6 } } });
    const row = await tracker();
    await editCarTracker(row.id, { scrapeInterval: 12 }, owner);
    await refreshCarTracker(row.id, owner);
    await deleteCarTracker(row.id, owner);
    expect(await prisma.query.findUnique({ where: { id: flight.id } })).toEqual(flight);
    expect(await prisma.hotelTracker.findUnique({ where: { id: hotel.id } })).toEqual(hotel);
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { carOfferFixture, carReportFixture, carSearchFixture } from '@/test/car-fixtures';
import { acquireTravelLease, claimTravelJob, lockTravelAdmission, releaseTravelLease, type TravelLeaseToken } from '../travel/jobs';
import { carJson, createCarSearch, createCarTracker, editCarTracker, refreshCarTracker } from './store';
import { failCarRun, finishCarRun, saveCarProgress, startCarRun } from './persistence';
import type { CarActor } from './access';
import { getCarDetail } from './views';

describe.skipIf(process.env.CAR_PERSISTENCE_INTEGRATION_TESTS !== '1')('fenced car observation transactions against PostgreSQL', () => {
  let owner: CarActor, other: CarActor;
  let lease: TravelLeaseToken | null = null;
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
    if (url.hostname !== '127.0.0.1' || url.port !== '55440' || url.pathname !== '/car_test') throw new Error('Car persistence tests require disposable localhost:55440/car_test');
  });
  beforeEach(async () => {
    const suffix = crypto.randomUUID();
    owner = { userId: (await prisma.user.create({ data: { username: `car-persist-owner-${suffix}` } })).id, isAdmin: false };
    other = { userId: (await prisma.user.create({ data: { username: `car-persist-other-${suffix}` } })).id, isAdmin: false };
    lease = await acquireTravelLease('browser');
    if (!lease) throw new Error('Expected isolated browser lease');
  });
  afterEach(async () => {
    if (lease) await releaseTravelLease(lease);
    lease = null;
    if (!owner || !other) return;
    const ids = [owner.userId!, other.userId!];
    await prisma.travelJob.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  async function start(trackerId?: string) {
    const run = trackerId ? await refreshCarTracker(trackerId, owner) : await createCarSearch(carSearchFixture(), owner);
    const job = await prisma.travelJob.findUniqueOrThrow({ where: { carRunId: run!.id } });
    await claimTravelJob(job.id, lease!);
    await startCarRun(job.id, lease!);
    return { run: run!, job };
  }
  async function tracker(mode: 'best' | 'contract' = 'best') {
    const search = await prisma.carSearchRun.create({ data: { userId: owner.userId, request: carJson(carSearchFixture()), result: carJson(carReportFixture()), status: 'success', completedAt: new Date() } });
    return createCarTracker({ searchId: search.id, offerId: 'verified-quote', mode, target: { currency: 'GBP', minor: 10000 } }, owner);
  }

  it('keeps progress separate from price state and preserves it across a repeated start acknowledgement', async () => {
    const row = await tracker(), active = await start(row.id), report = carReportFixture();
    await saveCarProgress(active.job.id, lease!, report, new AbortController().signal);
    expect((await startCarRun(active.job.id, lease!)).run.result).toEqual(report);
    expect((await prisma.carTracker.findUniqueOrThrow({ where: { id: row.id } })).latestPriceMinor).toBeNull();
    expect(await prisma.carSnapshot.count({ where: { trackerId: row.id } })).toBe(0);
    await finishCarRun(active.job.id, lease!, report);
    expect(await prisma.carTracker.findUnique({ where: { id: row.id } })).toMatchObject({ latestPriceMinor: 10000n, historicalLowMinor: 10000n, targetArmed: false });
    const delivery = await prisma.travelAlertDelivery.findFirstOrThrow({ where: { carTrackerId: row.id } });
    expect(delivery).toMatchObject({ eventKey: `car:${active.job.id}:0`, pending: true, message: { data: { userId: owner.userId, trackerRevision: 0, totalMinor: 10000, target: true, newLow: false } } });
    await expect(finishCarRun(active.job.id, lease!, report)).rejects.toThrow(/completed|reclaimed/);
    await expect(failCarRun(active.job.id, lease!)).rejects.toThrow(/completed|reclaimed/);
    expect((await prisma.carSearchRun.findUniqueOrThrow({ where: { id: active.run.id } })).status).toBe('success');
    expect(await prisma.carSnapshot.count({ where: { trackerId: row.id } })).toBe(1);
    expect(await prisma.travelAlertDelivery.count({ where: { carTrackerId: row.id } })).toBe(1);
  });

  it('retains valid observations from a partial check without rearming the target', async () => {
    const row = await tracker();
    await prisma.carTracker.update({ where: { id: row.id }, data: { targetArmed: false, latestPriceMinor: 9000, historicalLowMinor: 9000 } });
    const active = await start(row.id), report = carReportFixture([carOfferFixture(undefined, 16000)]);
    report.providers[1]!.status = 'blocked'; report.successfulProviders = 1;
    report.errors.push({ source: 'autoeurope', message: 'Provider blocked this search' });
    await finishCarRun(active.job.id, lease!, report);
    expect(await prisma.carSearchRun.findUnique({ where: { id: active.run.id } })).toMatchObject({ status: 'partial' });
    expect(await prisma.carTracker.findUnique({ where: { id: row.id } })).toMatchObject({ latestPriceMinor: 16000n, historicalLowMinor: 9000n, targetArmed: false, lastError: expect.stringMatching(/blocked/) });
    expect(await prisma.travelAlertDelivery.count({ where: { carTrackerId: row.id } })).toBe(0);
  });

  it('stores a different contract as ineligible rather than replacing the selected car', async () => {
    const row = await tracker('contract'), active = await start(row.id), offer = carOfferFixture();
    offer.contract.supplierId = 'different-supplier';
    await finishCarRun(active.job.id, lease!, carReportFixture([offer], ['discovercars']));
    expect(await prisma.carSnapshot.findFirst({ where: { trackerId: row.id } })).toMatchObject({ eligible: false, reasons: [expect.stringMatching(/Different rental contract/)] });
    expect(await prisma.carTracker.findUnique({ where: { id: row.id } })).toMatchObject({ latestPriceMinor: null, historicalLowMinor: null, lastError: expect.stringMatching(/not verified among/) });
  });

  it('retains partial-pricing warnings alongside a verified price without rearming alerts', async () => {
    const row = await tracker(), active = await start(row.id), offer = carOfferFixture(undefined, 12000), report = carReportFixture([offer]);
    await prisma.carTracker.update({ where: { id: row.id }, data: { targetArmed: false } });
    report.providers[0]!.checked = 2; report.providers[0]!.discoveredVisible = 2;
    report.candidates.push({ source: 'discovercars', supplier: offer.supplier, model: offer.contract.model, bookingUrl: offer.bookingUrl, observedAt: offer.observedAt, advertisedTotal: { ...offer.total, status: 'estimated' }, requirements: [], reasons: ['Unconfirmed mandatory fee'] });
    await finishCarRun(active.job.id, lease!, report);
    expect(await prisma.carTracker.findUnique({ where: { id: row.id } })).toMatchObject({ latestPriceMinor: 12000n, targetArmed: false, lastError: expect.stringMatching(/incomplete pricing/) });
    expect((await prisma.carSearchRun.findUniqueOrThrow({ where: { id: active.run.id } })).status).toBe('partial');
  });

  it('rejects omitted observations rather than rearming from a falsely complete check', async () => {
    const row = await tracker(), active = await start(row.id), report = carReportFixture([carOfferFixture(undefined, 12000)]);
    await prisma.carTracker.update({ where: { id: row.id }, data: { targetArmed: false } });
    report.providers[0]!.checked = 8; report.providers[0]!.discoveredVisible = 8;
    await expect(finishCarRun(active.job.id, lease!, report)).rejects.toThrow(/missing observations/);
    expect(await prisma.carTracker.findUnique({ where: { id: row.id } })).toMatchObject({ latestPriceMinor: null, targetArmed: false });
    expect(await prisma.carSnapshot.count({ where: { trackerId: row.id } })).toBe(0);
  });

  it('rearms only after a complete above-target check and sends one subsequent crossing alert', async () => {
    const row = await tracker();
    await prisma.carTracker.update({ where: { id: row.id }, data: { targetArmed: false, historicalLowMinor: 8000, latestPriceMinor: 9000 } });
    const incomplete = await start(row.id), partial = carReportFixture([carOfferFixture(undefined, 12000)]);
    partial.providers[1]!.status = 'failed'; partial.successfulProviders = 1;
    partial.errors.push({ source: 'autoeurope', message: 'Provider could not finish' });
    await finishCarRun(incomplete.job.id, lease!, partial);
    expect((await prisma.carTracker.findUniqueOrThrow({ where: { id: row.id } })).targetArmed).toBe(false);
    const complete = await start(row.id);
    await finishCarRun(complete.job.id, lease!, carReportFixture([carOfferFixture(undefined, 12000)]));
    expect(await prisma.carTracker.findUnique({ where: { id: row.id } })).toMatchObject({ targetArmed: true, historicalLowMinor: 8000n, lastError: null });
    const crossing = await start(row.id);
    await finishCarRun(crossing.job.id, lease!, carReportFixture([carOfferFixture(undefined, 10000)]));
    const repeated = await start(row.id);
    await finishCarRun(repeated.job.id, lease!, carReportFixture([carOfferFixture(undefined, 10000)]));
    expect(await prisma.travelAlertDelivery.findMany({ where: { carTrackerId: row.id } })).toMatchObject([{ message: { data: { target: true, newLow: false, totalMinor: 10000 } } }]);
    expect((await prisma.carTracker.findUniqueOrThrow({ where: { id: row.id } })).targetArmed).toBe(false);
  });

  it('preserves previous price and alert state when observations are expired or the job fails', async () => {
    const row = await tracker();
    await prisma.carTracker.update({ where: { id: row.id }, data: { latestPriceMinor: 9000, historicalLowMinor: 8000, targetArmed: false } });
    const first = await start(row.id);
    await finishCarRun(first.job.id, lease!, carReportFixture([carOfferFixture(new Date(Date.now() - 16 * 60_000).toISOString())]));
    expect(await prisma.carSnapshot.findFirst({ where: { trackerId: row.id } })).toMatchObject({ eligible: false, reasons: expect.arrayContaining([expect.stringMatching(/expired/)]) });
    const second = await start(row.id); await failCarRun(second.job.id, lease!);
    expect(await prisma.carTracker.findUnique({ where: { id: row.id } })).toMatchObject({ latestPriceMinor: 9000n, historicalLowMinor: 8000n, targetArmed: false, lastError: expect.stringMatching(/could not finish/) });
    expect(await prisma.travelJob.findUnique({ where: { id: second.job.id } })).toMatchObject({ status: 'failed' });
    expect(await prisma.carSearchRun.findUnique({ where: { id: second.run.id } })).toMatchObject({ status: 'failed' });
  });

  it.each(['pause', 'reassign', 'revision'] as const)('rejects all late persistence after %s invalidates execution', async change => {
    const row = await tracker(), active = await start(row.id);
    if (change === 'revision') await prisma.carTracker.update({ where: { id: row.id }, data: { revision: { increment: 1 } } });
    else await editCarTracker(row.id, change === 'pause' ? { active: false } : { userId: other.userId }, { ...owner, isAdmin: true });
    await expect(saveCarProgress(active.job.id, lease!, carReportFixture(), new AbortController().signal)).rejects.toThrow();
    await expect(finishCarRun(active.job.id, lease!, carReportFixture())).rejects.toThrow();
    expect(await prisma.carSnapshot.count({ where: { trackerId: row.id } })).toBe(0);
    expect(await prisma.travelAlertDelivery.count({ where: { carTrackerId: row.id } })).toBe(0);
  });

  it.each(['resource', 'admission'])('bounds progress %s lock waits and leaves no deferred update after release', async kind => {
    const active = await start();
    let markLocked!: () => void, releaseLock!: () => void;
    const locked = new Promise<void>(resolve => { markLocked = resolve; });
    const release = new Promise<void>(resolve => { releaseLock = resolve; });
    const holder = prisma.$transaction(async tx => {
      if (kind === 'admission') await lockTravelAdmission(tx);
      else await tx.$queryRaw`SELECT id FROM "TravelLease" WHERE id = 'browser' FOR UPDATE`;
      markLocked(); await release;
    });
    await locked;
    try { await expect(saveCarProgress(active.job.id, lease!, carReportFixture(), new AbortController().signal)).rejects.toThrow(/lock timeout/); }
    finally { releaseLock(); await holder; }
    expect((await prisma.carSearchRun.findUniqueOrThrow({ where: { id: active.run.id } })).result).toBeNull();
  });

  it('rolls back a progress update when cancellation arrives after its database write', async () => {
    const active = await start(), controller = new AbortController();
    await prisma.$executeRawUnsafe('CREATE FUNCTION car_progress_test_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.3); RETURN NEW; END $$');
    try {
      await prisma.$executeRawUnsafe('CREATE TRIGGER car_progress_test_pause AFTER UPDATE ON "CarSearchRun" FOR EACH ROW WHEN (NEW.result IS NOT NULL) EXECUTE FUNCTION car_progress_test_pause()');
      const saving = saveCarProgress(active.job.id, lease!, carReportFixture(), controller.signal);
      const rejected = expect(saving).rejects.toThrow(/Cancelled after write/);
      let writing = false;
      for (let attempt = 0; attempt < 40 && !writing; attempt++) {
        const rows = await prisma.$queryRaw<{ writing: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event = 'PgSleep' AND query LIKE '%CarSearchRun%') AS writing`;
        writing = rows[0]?.writing === true;
        if (!writing) await new Promise(resolve => setTimeout(resolve, 5));
      }
      controller.abort(new Error('Cancelled after write'));
      await rejected;
      expect(writing).toBe(true);
      expect((await prisma.carSearchRun.findUniqueOrThrow({ where: { id: active.run.id } })).result).toBeNull();
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS car_progress_test_pause ON "CarSearchRun"');
      await prisma.$executeRawUnsafe('DROP FUNCTION car_progress_test_pause()');
    }
  });

  it('rolls back snapshots, alerts and prices when the lease expires during completion', async () => {
    const row = await tracker(), active = await start(row.id);
    await prisma.$executeRawUnsafe('CREATE FUNCTION car_lease_test_expire() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN UPDATE "TravelLease" SET "expiresAt" = timestamp \'1970-01-01\' WHERE id = \'browser\'; RETURN NEW; END $$');
    try {
      await prisma.$executeRawUnsafe('CREATE TRIGGER car_lease_test_expire AFTER INSERT ON "CarSnapshot" FOR EACH ROW EXECUTE FUNCTION car_lease_test_expire()');
      await expect(finishCarRun(active.job.id, lease!, carReportFixture())).rejects.toThrow(/lease/);
      expect(await prisma.carSnapshot.count({ where: { trackerId: row.id } })).toBe(0);
      expect(await prisma.travelAlertDelivery.count({ where: { carTrackerId: row.id } })).toBe(0);
      expect((await prisma.carTracker.findUniqueOrThrow({ where: { id: row.id } })).latestPriceMinor).toBeNull();
      expect((await prisma.carSearchRun.findUniqueOrThrow({ where: { id: active.run.id } })).status).toBe('running');
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS car_lease_test_expire ON "CarSnapshot"');
      await prisma.$executeRawUnsafe('DROP FUNCTION car_lease_test_expire()');
    }
    await finishCarRun(active.job.id, lease!, carReportFixture());
    expect(await prisma.carSnapshot.count({ where: { trackerId: row.id } })).toBe(1);
  });

  it('rejects a malformed sibling quote without committing the otherwise valid observation', async () => {
    const row = await tracker(), active = await start(row.id), report = carReportFixture();
    const malformed = carOfferFixture(); malformed.id = 'bad-sibling'; malformed.contract.seats = 0;
    report.offers.push(malformed); report.providers[0]!.checked = 2; report.providers[0]!.discoveredVisible = 2;
    await expect(finishCarRun(active.job.id, lease!, report)).rejects.toThrow(/seats/);
    expect(await prisma.carSnapshot.count({ where: { trackerId: row.id } })).toBe(0);
    expect((await prisma.travelJob.findUniqueOrThrow({ where: { id: active.job.id } })).status).toBe('running');
  });

  it('keeps historical eligibility consistent when a quote expires during the completion transaction', async () => {
    const row = await tracker(), active = await start(row.id);
    await prisma.$executeRawUnsafe('CREATE FUNCTION car_history_test_pause() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(2); RETURN NEW; END $$');
    try {
      await prisma.$executeRawUnsafe('CREATE TRIGGER car_history_test_pause AFTER INSERT ON "CarSnapshot" FOR EACH ROW EXECUTE FUNCTION car_history_test_pause()');
      const observedAt = new Date(Date.now() - 15 * 60_000 + 1500);
      await finishCarRun(active.job.id, lease!, carReportFixture([carOfferFixture(observedAt.toISOString())]));
      expect(Date.now() - observedAt.getTime()).toBeGreaterThan(15 * 60_000);
      const detail = await getCarDetail(row.id, owner);
      expect(detail.snapshots).toMatchObject([{ eligible: true, totalMinor: 10000 }]);
      expect(detail.tracker.latestPriceMinor).toBe(10000);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS car_history_test_pause ON "CarSnapshot"');
      await prisma.$executeRawUnsafe('DROP FUNCTION car_history_test_pause()');
    }
  });
});

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { carOfferFixture, carSearchFixture } from '@/test/car-fixtures';
import type { CarActor } from './access';
import { cancelCarSearch, carJson, createCarSearch, createCarTracker, deleteCarTracker, editCarTracker } from './store';

describe.skipIf(process.env.CAR_STORE_INTEGRATION_TESTS !== '1')('durable car creation retries against isolated PostgreSQL', () => {
  let owner: CarActor, other: CarActor;
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
    if (url.hostname !== '127.0.0.1' || url.port !== '55440' || url.pathname !== '/car_test') throw new Error('Car creation tests require disposable localhost:55440/car_test');
  });
  beforeEach(async () => {
    owner = { userId: (await prisma.user.create({ data: { username: `car-create-owner-${crypto.randomUUID()}` } })).id, isAdmin: false };
    other = { userId: (await prisma.user.create({ data: { username: `car-create-other-${crypto.randomUUID()}` } })).id, isAdmin: false };
  });
  afterEach(async () => {
    vi.useRealTimers();
    const userIds = [owner.userId!, other.userId!];
    await prisma.travelJob.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
  afterAll(async () => { await prisma.$disconnect(); });

  async function intent(actor = owner) {
    const run = await prisma.carSearchRun.create({ data: { userId: actor.userId, request: carJson(carSearchFixture()), result: carJson({ offers: [carOfferFixture()] }), status: 'success', completedAt: new Date() } });
    return { searchId: run.id, offerId: 'verified-quote' };
  }

  it('creates one tracker and first job when the same request arrives concurrently', async () => {
    const input = await intent(), key = crypto.randomUUID();
    const rows = await Promise.all(Array.from({ length: 5 }, () => createCarTracker(input, owner, key)));
    expect(new Set(rows.map(row => row.id)).size).toBe(1);
    expect(await prisma.carTracker.count({ where: { userId: owner.userId } })).toBe(1);
    expect(await prisma.travelJob.count({ where: { userId: owner.userId } })).toBe(1);
    expect(await prisma.carTrackerCreation.count({ where: { userId: owner.userId } })).toBe(1);
  });

  it('recovers a lost acknowledgement after quote expiry and even after the source search is removed', async () => {
    const input = await intent(), key = crypto.randomUUID(), row = await createCarTracker(input, owner, key);
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.now() + 16 * 60_000);
    expect((await createCarTracker(input, owner, key)).id).toBe(row.id);
    await expect(createCarTracker(input, owner, crypto.randomUUID())).rejects.toMatchObject({ status: 409 });
    await prisma.carSearchRun.delete({ where: { id: input.searchId } });
    expect((await createCarTracker(input, owner, key)).id).toBe(row.id);
    expect(await prisma.travelJob.count({ where: { userId: owner.userId } })).toBe(1);
  });

  it('normalizes omitted defaults, key case, whitespace and untrusted fields without changing the original tracker', async () => {
    const input = { ...await intent(), label: '  Airport holiday  ' }, key = crypto.randomUUID();
    const row = await createCarTracker(input, owner, key);
    const retry = await createCarTracker({ label: 'Airport holiday', mode: 'best', scrapeInterval: 3, notifyLows: true, target: null, offerId: input.offerId, searchId: input.searchId, price: 1, contractHash: 'untrusted' }, owner, key.toUpperCase());
    expect(retry).toEqual(row);
    expect(retry.label).toBe('Airport holiday');
    expect(retry.latestPriceMinor).toBeNull();
  });

  it.each([
    { mode: 'contract' }, { label: 'Different label' }, { notifyLows: false }, { scrapeInterval: 6 },
    { target: { currency: 'GBP', minor: 9000 } }, { offerId: 'different-offer' }, { searchId: 'different-search' },
  ])('rejects reuse for changed rental settings: %j', async change => {
    const input = await intent(), key = crypto.randomUUID(), row = await createCarTracker(input, owner, key);
    await expect(createCarTracker({ ...input, ...change }, owner, key)).rejects.toMatchObject({ status: 409 });
    expect(await prisma.carTracker.findUnique({ where: { id: row.id } })).toEqual(row);
    expect(await prisma.travelJob.count({ where: { userId: owner.userId } })).toBe(1);
  });

  it('retains a deleted receipt and never recreates the tracker on delayed retry', async () => {
    const input = await intent(), key = crypto.randomUUID(), row = await createCarTracker(input, owner, key);
    await deleteCarTracker(row.id, owner);
    await expect(createCarTracker(input, owner, key)).rejects.toMatchObject({ status: 410 });
    expect(await prisma.carTracker.count({ where: { userId: owner.userId } })).toBe(0);
    expect(await prisma.carTrackerCreation.findMany({ where: { userId: owner.userId } })).toMatchObject([{ trackerId: null }]);
  });

  it('rechecks current ownership on retry after reassignment', async () => {
    const input = await intent(), key = crypto.randomUUID(), row = await createCarTracker(input, owner, key);
    await editCarTracker(row.id, { userId: other.userId }, { ...owner, isAdmin: true });
    await expect(createCarTracker(input, owner, key)).rejects.toMatchObject({ status: 404 });
    expect(await prisma.carTracker.findUnique({ where: { id: row.id } })).toMatchObject({ userId: other.userId });
    expect(await prisma.carTracker.count({ where: { userId: owner.userId } })).toBe(0);
  });

  it('keeps the same UUID isolated between actors and never grants access to their source searches', async () => {
    const first = await intent(), second = await intent(other), key = crypto.randomUUID();
    const row = await createCarTracker(first, owner, key);
    await expect(createCarTracker(first, other, key)).rejects.toMatchObject({ status: 404 });
    const separate = await createCarTracker(second, other, key);
    expect(separate.id).not.toBe(row.id);
    expect(separate.userId).toBe(other.userId);
    expect(await prisma.carTrackerCreation.count({ where: { userId: { in: [owner.userId!, other.userId!] } } })).toBe(2);
  });

  it('rolls back the receipt with a rejected first refresh and permits the same intent after capacity is released', async () => {
    const input = await intent(), key = crypto.randomUUID();
    const searches = await Promise.all(Array.from({ length: 3 }, () => createCarSearch(carSearchFixture(), owner)));
    await expect(createCarTracker(input, owner, key)).rejects.toMatchObject({ status: 429 });
    expect(await prisma.carTrackerCreation.count({ where: { userId: owner.userId } })).toBe(0);
    expect(await prisma.carTracker.count({ where: { userId: owner.userId } })).toBe(0);
    await cancelCarSearch(searches[0]!.id, owner);
    const row = await createCarTracker(input, owner, key);
    expect(await prisma.carTrackerCreation.findMany({ where: { userId: owner.userId } })).toMatchObject([{ trackerId: row.id }]);
    expect(await prisma.carSearchRun.count({ where: { trackerId: row.id, status: 'queued' } })).toBe(1);
  });

  it('rejects a target in another currency without consuming the creation key', async () => {
    const input = await intent(), key = crypto.randomUUID();
    await expect(createCarTracker({ ...input, target: { currency: 'USD', minor: 9000 } }, owner, key)).rejects.toThrow(/currencies/);
    expect(await prisma.carTrackerCreation.count({ where: { userId: owner.userId } })).toBe(0);
    expect((await createCarTracker(input, owner, key)).currency).toBe('GBP');
  });
});

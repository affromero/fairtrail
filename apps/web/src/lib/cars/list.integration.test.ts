import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/prisma';
import { carSearchFixture } from '@/test/car-fixtures';
import { carJson } from './store';
import { listCarTrackerPage } from './list';
import type { CarActor } from './access';

describe.skipIf(process.env.CAR_STORE_INTEGRATION_TESTS !== '1')('rental list pagination against isolated PostgreSQL', () => {
  let owner: CarActor, other: CarActor;
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
    if (url.hostname !== '127.0.0.1' || url.port !== '55440' || url.pathname !== '/car_test') throw new Error('Car list tests require disposable localhost:55440/car_test');
  });
  beforeEach(async () => {
    const suffix = crypto.randomUUID();
    owner = { userId: (await prisma.user.create({ data: { username: `car-list-owner-${suffix}` } })).id, isAdmin: false };
    other = { userId: (await prisma.user.create({ data: { username: `car-list-other-${suffix}` } })).id, isAdmin: false };
  });
  afterEach(async () => { if (owner && other) await prisma.user.deleteMany({ where: { id: { in: [owner.userId!, other.userId!] } } }); });
  afterAll(async () => { await prisma.$disconnect(); });
  async function seed(actor = owner, count = 4, createdAt = new Date(Date.now() - 10000)) {
    const ids = Array.from({ length: count }, (_, index) => `${actor.userId}-${index}`);
    await prisma.carTracker.createMany({ data: ids.map(id => ({ id, userId: actor.userId, label: id, search: carJson(carSearchFixture()), currency: 'GBP', createdAt })) });
    return ids.reverse();
  }
  it('orders equal timestamps deterministically and includes every owned tracker once', async () => {
    const ids = await seed(); await seed(other);
    const first = await listCarTrackerPage(owner, { limit: 2 });
    expect(first.trackers.map(row => row.id)).toEqual(ids.slice(0, 2));
    expect(first.nextCursor).not.toBeNull();
    const last = await listCarTrackerPage(owner, { limit: 2, cursor: first.nextCursor });
    expect(last.trackers.map(row => row.id)).toEqual(ids.slice(2));
    expect(last.nextCursor).toBeNull();
  });
  it('continues after a deleted cursor row and ignores newly inserted rows until refresh', async () => {
    const ids = await seed();
    const first = await listCarTrackerPage(owner, { limit: 2 });
    await prisma.carTracker.delete({ where: { id: first.trackers[1]!.id } });
    const newId = `new-${crypto.randomUUID()}`;
    await prisma.carTracker.create({ data: { id: newId, userId: owner.userId, label: 'New rental', search: carJson(carSearchFixture()), currency: 'GBP' } });
    expect((await listCarTrackerPage(owner, { limit: 2, cursor: first.nextCursor })).trackers.map(row => row.id)).toEqual(ids.slice(2));
    expect((await listCarTrackerPage(owner, { limit: 2 })).trackers[0]!.id).toBe(newId);
  });
  it('keeps personal administrator lists scoped and rejects cursor reuse across accounts or modes', async () => {
    await seed(); const ids = await seed(other); const admin = { ...other, isAdmin: true };
    const personal = await listCarTrackerPage(admin, { limit: 2 });
    expect(personal.trackers.map(row => row.id)).toEqual(ids.slice(0, 2));
    await expect(listCarTrackerPage(owner, { cursor: personal.nextCursor })).rejects.toMatchObject({ status: 400 });
    await expect(listCarTrackerPage(admin, { cursor: personal.nextCursor, admin: true })).rejects.toMatchObject({ status: 400 });
    await expect(listCarTrackerPage(other, { admin: true })).rejects.toMatchObject({ status: 403 });
    expect((await listCarTrackerPage(admin, { admin: true })).trackers).toHaveLength(8);
  });
  it('applies ownership independently even to an invented valid cursor', async () => {
    const ownIds = await seed(), foreignIds = await seed(other);
    const cursor = Buffer.from(JSON.stringify({ version: 1, scope: JSON.stringify([owner.userId, false]), createdAt: new Date().toISOString(), id: foreignIds[0] })).toString('base64url');
    expect((await listCarTrackerPage(owner, { cursor })).trackers.map(row => row.id)).toEqual(ownIds);
  });
  it.each(['', '!bad', 'a'.repeat(1501), Buffer.from('{broken').toString('base64url'), Buffer.from(JSON.stringify({ version: 1, scope: 'wrong', createdAt: 'nonsense', id: 'x' })).toString('base64url')])('rejects malformed and oversized cursor input %#', async cursor => {
    await expect(listCarTrackerPage(owner, { cursor })).rejects.toMatchObject({ status: 400 });
  });
  it('rejects an invalid timestamp in an otherwise correctly scoped cursor', async () => {
    const cursor = Buffer.from(JSON.stringify({ version: 1, scope: JSON.stringify([owner.userId, false]), createdAt: '2026-02-30T00:00:00.000Z', id: 'x' })).toString('base64url');
    await expect(listCarTrackerPage(owner, { cursor })).rejects.toMatchObject({ status: 400 });
  });
});

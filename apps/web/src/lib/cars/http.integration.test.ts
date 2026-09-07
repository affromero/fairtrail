import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { createUserSessionToken } from '../user-auth';
import { carOfferFixture, carReportFixture, carSearchFixture } from '@/test/car-fixtures';
import { carJson, createCarSearch, createCarTracker } from './store';
import { carContractHash } from './selection';
import { carEndpoint } from './http';
import { GET as list, POST as create } from '@/app/api/cars/route';
import { GET as detail, PATCH as edit, DELETE as remove } from '@/app/api/cars/[id]/route';
import { POST as refresh } from '@/app/api/cars/[id]/scrape/route';
import { GET as status, DELETE as cancel } from '@/app/api/cars/search/[id]/route';

const boundary = vi.hoisted(() => ({ token: '' }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => boundary.token ? { value: boundary.token } : undefined }) }));
const request = (body?: unknown, method = 'GET', key = crypto.randomUUID()) => new Request('http://localhost/api/cars', { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) }) });
const context = (id: string) => ({ params: Promise.resolve({ id }) });

describe.skipIf(process.env.CAR_HTTP_INTEGRATION_TESTS !== '1')('car HTTP ownership, history and request bounds against PostgreSQL', () => {
  let owner = '', other = '';
  let previousConfig: { multiUserMode: boolean; enabled: boolean } | null;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
    if (url.hostname !== '127.0.0.1' || url.port !== '55440' || url.pathname !== '/car_test') throw new Error('Car HTTP tests require disposable localhost:55440/car_test');
    previousConfig = await prisma.extractionConfig.findUnique({ where: { id: 'singleton' }, select: { multiUserMode: true, enabled: true } });
    await prisma.extractionConfig.upsert({ where: { id: 'singleton' }, create: { multiUserMode: true, enabled: false }, update: { multiUserMode: true, enabled: false } });
  });
  beforeEach(async () => {
    vi.stubEnv('SELF_HOSTED', 'true'); vi.stubEnv('REDIS_URL', '');
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    owner = (await prisma.user.create({ data: { username: `car-http-owner-${crypto.randomUUID()}` } })).id;
    other = (await prisma.user.create({ data: { username: `car-http-other-${crypto.randomUUID()}` } })).id;
    boundary.token = createUserSessionToken(owner);
  });
  afterEach(async () => {
    await prisma.travelJob.deleteMany({ where: { userId: { in: [owner, other] } } });
    await prisma.user.deleteMany({ where: { id: { in: [owner, other] } } });
    vi.unstubAllEnvs(); vi.restoreAllMocks();
  });
  afterAll(async () => {
    if (previousConfig) await prisma.extractionConfig.update({ where: { id: 'singleton' }, data: previousConfig });
    else await prisma.extractionConfig.delete({ where: { id: 'singleton' } });
    await prisma.$disconnect();
  });
  async function completed() {
    return prisma.carSearchRun.create({ data: { userId: owner, request: carJson(carSearchFixture()), result: carJson(carReportFixture()), status: 'success', completedAt: new Date() } });
  }
  async function tracker() {
    const run = await completed();
    return createCarTracker({ searchId: run.id, offerId: 'verified-quote' }, { userId: owner, isAdmin: false });
  }

  it('creates a tracker from its owned quote and reports a deduplicated queued refresh', async () => {
    const run = await completed(), response = await create(request({ searchId: run.id, offerId: 'verified-quote' }, 'POST'));
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const row = (await response.json()).data.tracker;
    const first = await refresh(request(), context(row.id)), second = await refresh(request(), context(row.id));
    expect(first.status).toBe(202);
    expect((await first.json()).data).toEqual((await second.json()).data);
    expect(await prisma.travelJob.findMany({ where: { carRun: { trackerId: row.id } } })).toMatchObject([{ status: 'queued', attempts: 0 }]);
    expect((await (await list(request())).json()).data.trackers).toMatchObject([{ id: row.id, latestPriceMinor: null }]);
  });
  it('hides every foreign tracker and search operation without changing its state', async () => {
    const row = await tracker(), run = await prisma.carSearchRun.findFirstOrThrow({ where: { trackerId: row.id } });
    boundary.token = createUserSessionToken(other);
    for (const response of [await detail(request(), context(row.id)), await edit(request({ active: false }, 'PATCH'), context(row.id)), await remove(request(), context(row.id)), await refresh(request(), context(row.id)), await status(request(), context(run.id)), await cancel(request(), context(run.id))]) expect(response.status).toBe(404);
    expect((await (await list(request())).json()).data.trackers).toEqual([]);
    expect((await prisma.carTracker.findUniqueOrThrow({ where: { id: row.id } })).active).toBe(true);
    expect((await prisma.carSearchRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('queued');
  });
  it('requires a valid creation key and safely replays an accepted HTTP request', async () => {
    const run = await completed(), input = { searchId: run.id, offerId: 'verified-quote' }, key = crypto.randomUUID();
    for (const invalid of [undefined, '', 'not-a-uuid', `${key}junk`]) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (invalid !== undefined) headers['Idempotency-Key'] = invalid;
      expect((await create(new Request('http://localhost/api/cars', { method: 'POST', headers, body: JSON.stringify(input) }))).status).toBe(400);
    }
    expect(await prisma.carTracker.count({ where: { userId: owner } })).toBe(0);
    const first = await create(request(input, 'POST', key)), retry = await create(request(input, 'POST', key));
    expect(first.status).toBe(201); expect(retry.status).toBe(201);
    const firstData = (await first.json()).data, retryData = (await retry.json()).data, row = firstData.tracker;
    expect(firstData.creationKey).toBe(key); expect(retryData.creationKey).toBe(key);
    expect(retryData.tracker).toEqual(row);
    expect((await create(request({ ...input, label: 'Changed intent' }, 'POST', key))).status).toBe(409);
    await remove(request(), context(row.id));
    expect((await create(request(input, 'POST', key))).status).toBe(410);
  });
  it.each(['public', 'missing', 'revoked'])('rejects %s access before reading data', async mode => {
    if (mode === 'public') vi.stubEnv('SELF_HOSTED', 'false');
    if (mode === 'missing') boundary.token = '';
    if (mode === 'revoked') await prisma.user.update({ where: { id: owner }, data: { sessionsValidFrom: new Date(Date.now() + 1000) } });
    expect((await list(request())).status).toBe(mode === 'public' ? 404 : 401);
    expect((await create(request({}, 'POST'))).status).toBe(mode === 'public' ? 404 : 401);
  });
  it('requires explicit authorized administration and keeps an administrator’s normal list personal', async () => {
    const row = await tracker();
    boundary.token = createUserSessionToken(other);
    const adminRequest = new Request('http://localhost/api/cars?admin=true');
    expect((await list(adminRequest)).status).toBe(403);
    await prisma.user.update({ where: { id: other }, data: { isAdmin: true } });
    expect((await (await list(request())).json()).data.trackers).toEqual([]);
    expect((await (await list(adminRequest)).json()).data.trackers).toMatchObject([{ id: row.id }]);
  });
  it('keeps old verified history readable without allowing it to become a fresh tracker quote', async () => {
    const row = await tracker(), observedAt = new Date(Date.now() - 30 * 86_400_000), offer = carOfferFixture(observedAt.toISOString());
    const run = await prisma.carSearchRun.create({ data: { userId: owner, trackerId: row.id, trackerRevision: 0, request: row.search!, result: carJson(carReportFixture([offer])), status: 'success', createdAt: observedAt, completedAt: observedAt } });
    await prisma.carSnapshot.create({ data: { trackerId: row.id, runId: run.id, source: 'discovercars', offer: carJson(offer), currency: 'GBP', totalMinor: 10000, eligible: true, reasons: [], contractHash: carContractHash(offer.contract), observedAt } });
    const response = await detail(request(), context(row.id));
    expect(response.status).toBe(200);
    expect((await response.json()).data.snapshots).toMatchObject([{ totalMinor: 10000, eligible: true, observedAt: observedAt.toISOString() }]);
    expect((await status(request(), context(run.id))).status).toBe(200);
    expect((await create(request({ searchId: run.id, offerId: offer.id }, 'POST'))).status).toBe(409);
  });
  it('preserves owned search visibility across tracker reassignment without exposing the tracker', async () => {
    const row = await tracker(), run = await prisma.carSearchRun.findFirstOrThrow({ where: { trackerId: row.id } });
    await prisma.user.update({ where: { id: owner }, data: { isAdmin: true } });
    expect((await edit(request({ userId: other }, 'PATCH'), context(row.id))).status).toBe(200);
    await prisma.user.update({ where: { id: owner }, data: { isAdmin: false } });
    expect((await detail(request(), context(row.id))).status).toBe(404);
    expect((await status(request(), context(run.id))).status).toBe(200);
    boundary.token = createUserSessionToken(other);
    expect((await detail(request(), context(row.id))).status).toBe(200);
    expect((await status(request(), context(run.id))).status).toBe(404);
  });
  it('pauses and cancels queued work and refuses refresh until resumed', async () => {
    const row = await tracker();
    expect((await edit(request({ active: false }, 'PATCH'), context(row.id))).status).toBe(200);
    expect((await refresh(request(), context(row.id))).status).toBe(409);
    const run = await createCarSearch(carSearchFixture(), { userId: owner, isAdmin: false });
    expect((await (await cancel(request(), context(run.id))).json()).data.status).toBe('cancelled');
    expect((await (await cancel(request(), context(run.id))).json()).data.status).toBe('cancelled');
    expect((await remove(request(), context(row.id))).status).toBe(200);
    expect((await detail(request(), context(row.id))).status).toBe(404);
  });
  it('rejects malformed JSON and chunked oversized bodies before creating a tracker', async () => {
    expect((await create(new Request('http://localhost/api/cars', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' }))).status).toBe(400);
    expect((await create(new Request('http://localhost/api/cars', { method: 'POST', body: '{}' }))).status).toBe(415);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(40_000)); controller.enqueue(new Uint8Array(40_000)); controller.close(); } });
    const oversized = new Request('http://localhost/api/cars', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit);
    expect((await create(oversized)).status).toBe(413);
    expect(await prisma.carTracker.count({ where: { userId: owner } })).toBe(0);
  });
  it('returns a bounded generic error for corrupt history instead of leaking stored data', async () => {
    const row = await tracker();
    await prisma.carTracker.update({ where: { id: row.id }, data: { search: { secret: 'private-corrupt-payload' } } });
    const response = await detail(request(), context(row.id));
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('private-corrupt-payload');
  });
  it.each([10001n, 9007199254740992n])('rejects inconsistent or unsafe historical amounts at the read or storage boundary: %s', async totalMinor => {
    const row = await tracker(), offer = carOfferFixture(), run = await prisma.carSearchRun.findFirstOrThrow({ where: { trackerId: row.id } });
    const writing = prisma.carSnapshot.create({ data: { trackerId: row.id, runId: run.id, source: 'discovercars', offer: carJson(offer), currency: 'GBP', totalMinor, eligible: true, reasons: [], contractHash: carContractHash(offer.contract), observedAt: new Date(offer.observedAt) } });
    if (totalMinor > BigInt(Number.MAX_SAFE_INTEGER)) {
      await expect(writing).rejects.toThrow(/CarSnapshot_amount_check/);
      expect((await (await detail(request(), context(row.id))).json()).data.snapshots).toEqual([]);
      return;
    }
    await writing;
    const response = await detail(request(), context(row.id));
    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/Stored rental history is invalid/);
  });
  it('does not expose an unverified quote as eligible history even when its stored flag is corrupted', async () => {
    const row = await tracker(), offer = carOfferFixture(), run = await prisma.carSearchRun.findFirstOrThrow({ where: { trackerId: row.id } });
    offer.taxesIncluded.status = 'unknown';
    await prisma.carSnapshot.create({ data: { trackerId: row.id, runId: run.id, source: 'discovercars', offer: carJson(offer), currency: 'GBP', totalMinor: 10000, eligible: true, reasons: [], contractHash: carContractHash(offer.contract), observedAt: new Date(offer.observedAt) } });
    expect((await detail(request(), context(row.id))).status).toBe(500);
  });
  it('maps transaction conflicts to retryable responses and redacts unexpected backend exceptions', async () => {
    const conflict = await carEndpoint(async () => { throw Object.assign(new Error('Private query detail'), { code: 'P2034' }); });
    expect(conflict.status).toBe(409);
    expect(await conflict.text()).not.toContain('Private query detail');
    const failure = await carEndpoint(async () => { throw new Error('Private query detail'); });
    expect(failure.status).toBe(500);
    expect(failure.headers.get('cache-control')).toBe('private, no-store');
    expect(await failure.text()).not.toContain('Private query detail');
  });
});

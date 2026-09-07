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
  it('returns owned rental pages with explicit continuation and rejects invalid pagination inputs', async () => {
    const createdAt = new Date(Date.now() - 1000);
    await prisma.carTracker.createMany({ data: [owner, other].flatMap(userId => Array.from({ length: 3 }, (_, index) => ({ id: `${userId}-${index}`, userId, label: `Rental ${index}`, search: carJson(carSearchFixture()), currency: 'GBP', createdAt }))) });
    const first = await list(new Request('http://localhost/api/cars?limit=2'));
    expect(first.status).toBe(200); expect(first.headers.get('cache-control')).toBe('private, no-store');
    const page = (await first.json()).data;
    expect(page.trackers.map((row: { id: string }) => row.id)).toEqual([`${owner}-2`, `${owner}-1`]);
    const next = new Request(`http://localhost/api/cars?limit=2&cursor=${encodeURIComponent(page.nextCursor)}`);
    expect((await (await list(next)).json()).data).toMatchObject({ trackers: [{ id: `${owner}-0` }], nextCursor: null });
    for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'limit=01', 'limit=', 'cursor=bad!']) expect((await list(new Request(`http://localhost/api/cars?${query}`))).status).toBe(400);
    boundary.token = createUserSessionToken(other);
    expect((await list(next)).status).toBe(400);
    boundary.token = '';
    expect((await list(next)).status).toBe(401);
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
  it('reports the selected provider for an exact-contract refresh without changing the stored search', async () => {
    const source = await completed();
    const row = await createCarTracker({ searchId: source.id, offerId: 'verified-quote', mode: 'contract' }, { userId: owner, isAdmin: false });
    const run = await prisma.carSearchRun.findFirstOrThrow({ where: { trackerId: row.id } });
    const response = await status(request(), context(run.id));
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({ id: run.id, trackerId: row.id, status: 'queued', search: { sources: ['discovercars'] } });
    expect((await prisma.carSearchRun.findUniqueOrThrow({ where: { id: run.id } })).request).toEqual(run.request);
    const offer = carOfferFixture();
    await prisma.carSearchRun.update({ where: { id: run.id }, data: { status: 'success', completedAt: new Date(), result: carJson(carReportFixture([offer], ['discovercars'])) } });
    const done = await status(request(), context(run.id));
    expect(done.status).toBe(200);
    expect((await done.json()).data.result).toMatchObject({ total: 1, completed: 1, offers: [{ id: offer.id }] });
  });
  it.each(['best', 'contract'] as const)('retains the verified %s observation beyond the recent history window after failed checks', async mode => {
    const source = await completed(), row = await createCarTracker({ searchId: source.id, offerId: 'verified-quote', mode }, { userId: owner, isAdmin: false });
    const originalTime = new Date(Date.now() - 3 * 3_600_000), original = carOfferFixture(originalTime.toISOString());
    const originalRun = await prisma.carSearchRun.create({ data: { trackerId: row.id, userId: owner, request: row.search!, status: 'success', createdAt: originalTime, completedAt: originalTime } });
    const verified = await prisma.carSnapshot.create({ data: { trackerId: row.id, runId: originalRun.id, source: 'discovercars', offer: carJson(original), currency: 'GBP', totalMinor: 10000, eligible: true, reasons: [], contractHash: carContractHash(original.contract), observedAt: originalTime } });
    if (mode === 'contract') {
      const observedAt = new Date(originalTime.getTime() + 60_000), mismatched = carOfferFixture(observedAt.toISOString());
      mismatched.contract.fuelPolicy = 'Return empty';
      const run = await prisma.carSearchRun.create({ data: { trackerId: row.id, userId: owner, request: row.search!, status: 'success', createdAt: observedAt, completedAt: observedAt } });
      await prisma.carSnapshot.create({ data: { trackerId: row.id, runId: run.id, source: 'discovercars', offer: carJson(mismatched), currency: 'GBP', totalMinor: 10000, eligible: true, reasons: [], contractHash: carContractHash(mismatched.contract), observedAt } });
    }
    const newer = Array.from({ length: 101 }, (_, index) => ({ id: crypto.randomUUID(), time: new Date(Date.now() - 2 * 3_600_000 + index * 60_000) }));
    await prisma.carSearchRun.createMany({ data: newer.map(entry => ({ id: entry.id, trackerId: row.id, userId: owner, request: row.search!, status: 'partial', createdAt: entry.time, completedAt: entry.time })) });
    await prisma.carSnapshot.createMany({ data: newer.map(entry => {
      const offer = carOfferFixture(entry.time.toISOString()); offer.taxesIncluded.status = 'unknown';
      return { trackerId: row.id, runId: entry.id, source: 'discovercars', offer: carJson(offer), currency: 'GBP', totalMinor: 10000, eligible: false, reasons: ['Tax inclusion was not verified'], contractHash: carContractHash(offer.contract), observedAt: entry.time };
    }) });
    await prisma.carTracker.update({ where: { id: row.id }, data: { latestPriceMinor: 10000, lastCheckedAt: new Date(), lastError: 'Latest check failed' } });
    const response = await detail(request(), context(row.id)); expect(response.status).toBe(200);
    const data = (await response.json()).data;
    expect(data.snapshots).toHaveLength(100); expect(data.snapshots.every((entry: { eligible: boolean }) => !entry.eligible)).toBe(true);
    expect(data.latestObservation).toMatchObject({ id: verified.id, observedAt: originalTime.toISOString(), totalMinor: 10000, eligible: true });
    expect(data.tracker.lastCheckedAt).not.toBe(data.latestObservation.observedAt);
  });
  it('uses the most recently evaluated matching observation when equal prices repeat', async () => {
    const row = await tracker(), base = Date.now() - 60_000;
    let expected = '';
    for (const index of [0, 1]) {
      const observedAt = new Date(base - index * 1000), evaluatedAt = new Date(base + index * 1000), offer = carOfferFixture(observedAt.toISOString());
      const run = await prisma.carSearchRun.create({ data: { trackerId: row.id, userId: owner, request: row.search!, status: 'success', createdAt: observedAt, completedAt: evaluatedAt } });
      expected = (await prisma.carSnapshot.create({ data: { trackerId: row.id, runId: run.id, source: 'discovercars', offer: carJson(offer), currency: 'GBP', totalMinor: 10000, eligible: true, reasons: [], contractHash: carContractHash(offer.contract), observedAt } })).id;
    }
    await prisma.carTracker.update({ where: { id: row.id }, data: { latestPriceMinor: 10000 } });
    const response = await detail(request(), context(row.id)); expect(response.status).toBe(200);
    expect((await response.json()).data.latestObservation.id).toBe(expected);
  });
  it('allows only one concurrent settings request to advance a given tracker revision', async () => {
    const row = await tracker();
    const conditional = () => { const r = request({ label: 'Updated weekend' }, 'PATCH'); r.headers.set('X-Car-Revision', '0'); return r; };
    const responses = await Promise.all([edit(conditional(), context(row.id)), edit(conditional(), context(row.id))]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 412]);
    const current = await detail(request(), context(row.id));
    expect(current.headers.get('X-Car-Revision')).toBe('1');
    expect((await current.json()).data.tracker).toMatchObject({ label: 'Updated weekend', revision: 1 });
  });
  it('rejects a late edit and deletion before disturbing newer queued work or alerts', async () => {
    const row = await tracker();
    const editAt = (revision: number, label: string) => { const r = request({ label }, 'PATCH'); r.headers.set('X-Car-Revision', String(revision)); return edit(r, context(row.id)); };
    expect((await editAt(0, 'First acknowledged state')).status).toBe(200);
    expect((await editAt(1, 'Newer intentional state')).status).toBe(200);
    await refresh(request(), context(row.id));
    const queued = await prisma.travelJob.findMany({ where: { carRun: { trackerId: row.id }, status: 'queued' } });
    const alert = await prisma.travelAlertDelivery.create({ data: { carTrackerId: row.id, eventKey: `revision-test-${row.id}`, message: { title: 'Test notification' } } });
    expect((await editAt(0, 'Late retry')).status).toBe(412);
    const deletion = request(undefined, 'DELETE'); deletion.headers.set('X-Car-Revision', '1');
    expect((await remove(deletion, context(row.id))).status).toBe(412);
    expect(await prisma.travelJob.findMany({ where: { carRun: { trackerId: row.id }, status: 'queued' } })).toEqual(queued);
    expect(await prisma.travelAlertDelivery.findUniqueOrThrow({ where: { id: alert.id } })).toEqual(alert);
    expect((await prisma.carTracker.findUniqueOrThrow({ where: { id: row.id } })).label).toBe('Newer intentional state');
  });
  it.each(['-1', '1.5', '01', '2147483648', '1,2', '"1"', 'NaN'])('rejects malformed revision header %s without changing the tracker', async value => {
    const row = await tracker(), update = request({ active: false }, 'PATCH'); update.headers.set('X-Car-Revision', value);
    expect((await edit(update, context(row.id))).status).toBe(400);
    const deletion = request(undefined, 'DELETE'); deletion.headers.set('X-Car-Revision', value);
    expect((await remove(deletion, context(row.id))).status).toBe(400);
    expect(await prisma.carTracker.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ active: true, revision: 0 });
  });
  it('preserves owned search visibility across tracker reassignment without exposing the tracker', async () => {
    const row = await tracker(), run = await prisma.carSearchRun.findFirstOrThrow({ where: { trackerId: row.id } });
    await prisma.user.update({ where: { id: owner }, data: { isAdmin: true } });
    expect((await edit(request({ userId: other }, 'PATCH'), context(row.id))).status).toBe(200);
    await prisma.user.update({ where: { id: owner }, data: { isAdmin: false } });
    expect((await detail(request(), context(row.id))).status).toBe(404);
    expect((await status(request(), context(run.id))).status).toBe(200);
    const retry = request({ label: 'Late owner request' }, 'PATCH'); retry.headers.set('X-Car-Revision', '0');
    expect((await edit(retry, context(row.id))).status).toBe(404);
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

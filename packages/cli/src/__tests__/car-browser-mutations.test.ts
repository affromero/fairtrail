import { createServer, type Server, type ServerResponse, type IncomingMessage } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CarClient } from '../lib/car-client.js';
import { CarBrowser } from '../lib/car-browser.js';
import { carTrackerViewFixture } from '../../../../apps/web/src/test/car-fixtures.js';

let server: Server, browser: CarBrowser, scope: string, directory: string;
let tracker: ReturnType<typeof carTrackerViewFixture>;
let mutate: (request: IncomingMessage, response: ServerResponse, body: Record<string, unknown>) => void;
let mutations: { method: string; key: string; revision: string; body: Record<string, unknown> }[];
let deleted: boolean;
function reply(response: ServerResponse, data: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(status === 200 ? { ok: true, data } : { ok: false, error: 'Server state changed' }));
}
beforeEach(async () => {
  scope = 'user:alice'; tracker = { ...carTrackerViewFixture(), revision: 7 }; mutations = []; deleted = false;
  directory = await mkdtemp(join(tmpdir(), 'car-browser-mutations-'));
  mutate = (request, response, body) => {
    if (request.method === 'PATCH') {
      tracker = { ...tracker, active: body.active as boolean, revision: tracker.revision + 1 };
      reply(response, { tracker }); return;
    }
    reply(response, { id: 'run-one', status: 'queued', trackerId: tracker.id, refreshKey: request.headers['idempotency-key'] });
  };
  server = createServer(async (request, response) => {
    let text = ''; for await (const chunk of request) text += String(chunk);
    if (request.method !== 'GET') {
      const body = JSON.parse(text || '{}') as Record<string, unknown>;
      mutations.push({ method: request.method!, key: String(request.headers['idempotency-key']), revision: String(request.headers['x-car-revision']), body });
      mutate(request, response, body); return;
    }
    const data = request.url === '/api/cars/session' ? { scope, isAdmin: false }
      : request.url === `/api/cars/${tracker.id}` ? { tracker, snapshots: [], runs: [], latestObservation: null, deliveries: [], notificationsConfigured: false, canReassign: false }
        : { trackers: deleted ? [] : [tracker], nextCursor: null };
    reply(response, data);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No local server');
  browser = new CarBrowser(new CarClient(`http://127.0.0.1:${address.port}`), false, directory);
  await browser.reload(); await browser.open(tracker.id);
});
afterEach(async () => {
  browser.close(); await browser.settle(); server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});

it('captures the displayed revision and sends nothing until explicitly confirmed', async () => {
  tracker.search.pickup.providerNames = { discovercars: 'Airport pickup area' };
  tracker.search.dropoff.providerNames = { discovercars: 'Airport return area' };
  await browser.reload();
  browser.requestAction('pause');
  expect(browser.getSnapshot().confirmation).toMatchObject({ scope, operation: { id: tracker.id, revision: tracker.revision, body: { active: false } }, locations: [expect.stringContaining('Airport pickup area'), expect.stringContaining('Airport return area')] });
  expect(await readdir(directory)).toEqual([]); expect(mutations).toEqual([]);
  await browser.confirm();
  expect(mutations).toMatchObject([{ method: 'PATCH', revision: '7', body: { active: false } }]);
  expect(browser.getSnapshot()).toMatchObject({ detail: { tracker: { active: false, revision: 8 } }, recoveries: [{ outcome: 'confirmed' }] });
});

it('invalidates an unsubmitted confirmation when navigating or reloading newer settings', async () => {
  browser.requestAction('delete'); await browser.back(); await browser.confirm();
  await browser.open(tracker.id); browser.requestAction('pause');
  tracker = { ...tracker, revision: 8 }; await browser.reload(); await browser.confirm();
  expect(browser.getSnapshot()).toMatchObject({ confirmation: null, detail: { tracker: { revision: 8 } } });
  expect(mutations).toEqual([]); expect(await readdir(directory)).toEqual([]);
});

it('hides private data if the account changes between displaying and confirming a change', async () => {
  browser.requestAction('pause'); scope = 'user:bob'; await browser.confirm();
  expect(browser.getSnapshot()).toMatchObject({ hidden: true, detail: null, confirmation: null, trackers: [] });
  expect(mutations).toEqual([]); expect(await readdir(directory)).toEqual([]);
});

it('allows pausing after a lost refresh reply and recovers the original refresh without a second job', async () => {
  let loseReply = true;
  const jobs = new Set<string>();
  mutate = (request, response, body) => {
    if (request.method === 'PATCH') {
      tracker = { ...tracker, active: body.active as boolean, revision: tracker.revision + 1 };
      reply(response, { tracker }); return;
    }
    jobs.add(String(request.headers['idempotency-key']));
    if (loseReply) { loseReply = false; response.destroy(); return; }
    reply(response, { id: 'run-one', status: 'success', trackerId: tracker.id, refreshKey: request.headers['idempotency-key'] });
  };
  browser.requestAction('refresh'); await browser.confirm();
  const path = browser.getReceiptPaths()[0]!, original = await readFile(path, 'utf8');
  expect(browser.getSnapshot().recoveries).toMatchObject([{ path, outcome: 'unconfirmed' }]);
  browser.requestAction('refresh'); expect(browser.getSnapshot().confirmation).toBeNull();
  browser.requestAction('pause'); await browser.confirm();
  expect(browser.getSnapshot().detail?.tracker.active).toBe(false);
  await browser.reviewReceipt(path);
  expect(browser.getSnapshot().confirmation).toMatchObject({ receiptPath: path, scope, operation: { kind: 'refresh', revision: 7 } });
  expect(mutations.map(row => row.method)).toEqual(['POST', 'PATCH']);
  await browser.confirm();
  expect(jobs.size).toBe(1);
  expect(mutations.filter(row => row.method === 'POST').map(row => row.revision)).toEqual(['7', '7']);
  expect(await readFile(path, 'utf8')).toBe(original);
  expect(browser.getSnapshot().recoveries.find(row => row.path === path)?.outcome).toBe('confirmed');
});

it('requires explicit receipt recovery and acceptance of current revision after an uncertain edit', async () => {
  let loseReply = true;
  mutate = (request, response, body) => {
    if (String(request.headers['x-car-revision']) !== String(tracker.revision)) { reply(response, null, 412); return; }
    tracker = { ...tracker, active: body.active as boolean, revision: tracker.revision + 1 };
    if (loseReply) { loseReply = false; response.destroy(); return; }
    reply(response, { tracker });
  };
  browser.requestAction('pause'); await browser.confirm(); await browser.reload();
  browser.requestAction('resume'); expect(browser.getSnapshot().confirmation).toBeNull();
  const path = browser.getReceiptPaths()[0]!;
  await browser.reviewReceipt(path); await browser.confirm();
  expect(browser.getSnapshot().recoveries[0]?.outcome).toBe('stale');
  browser.requestAction('resume');
  expect(browser.getSnapshot().confirmation).toMatchObject({ conflict: true, operation: { revision: 8 } });
  await browser.confirm();
  expect(browser.getSnapshot().detail?.tracker).toMatchObject({ active: true, revision: 9 });
  expect(mutations.map(row => row.revision)).toEqual(['7', '7', '8']);
});

it('refuses a receipt whose complete payload changed after its recovery preview', async () => {
  mutate = (request, response) => { response.destroy(); };
  browser.requestAction('pause'); await browser.confirm();
  const path = browser.getReceiptPaths()[0]!;
  await browser.reviewReceipt(path);
  const receipt = JSON.parse(await readFile(path, 'utf8'));
  receipt.operation.body.active = true;
  await writeFile(path, JSON.stringify(receipt));
  await browser.confirm();
  expect(mutations).toHaveLength(1);
  expect(browser.getSnapshot().error).toMatch(/changed after review/);
});

it('retains and reports a receipt when closing immediately after publication without sending its request', async () => {
  browser.subscribeReceipts(() => browser.close());
  browser.requestAction('refresh'); await browser.confirm(); await browser.settle();
  expect(browser.getReceiptPaths()).toHaveLength(1);
  expect(JSON.parse(await readFile(browser.getReceiptPaths()[0]!, 'utf8')).operation.kind).toBe('refresh');
  expect(mutations).toEqual([]);
  expect(browser.getSnapshot()).toMatchObject({ hidden: true, confirmation: null, detail: null });
});

it('clears private recovery metadata on denial and restores pending guards only for the original account', async () => {
  mutate = (request, response) => reply(response, null, 401);
  browser.requestAction('pause'); await browser.confirm();
  expect(browser.getSnapshot()).toMatchObject({ hidden: true, detail: null, recoveries: [{ operation: null, scope: null, outcome: 'inaccessible' }] });
  expect(browser.getReceiptPaths()).toHaveLength(1);
  await browser.reload(); await browser.open(tracker.id); browser.requestAction('delete');
  expect(browser.getSnapshot().confirmation).toBeNull();
  expect(browser.getSnapshot().recoveries[0]?.operation?.kind).toBe('edit');
  expect(mutations).toHaveLength(1);
});

it('hides the acknowledgement when the account changes during a successful mutation', async () => {
  mutate = (request, response, body) => {
    tracker = { ...tracker, active: body.active as boolean, revision: tracker.revision + 1 };
    scope = 'user:bob'; reply(response, { tracker });
  };
  browser.requestAction('pause'); await browser.confirm();
  expect(browser.getSnapshot()).toMatchObject({ hidden: true, detail: null, notice: null, recoveries: [{ operation: null, scope: null }] });
  expect(browser.getReceiptPaths()).toHaveLength(1);
});

it('returns to the authoritative empty list after confirmed deletion and retains the deletion receipt', async () => {
  mutate = (request, response) => { deleted = true; reply(response, { id: tracker.id, deleted: true }); };
  browser.requestAction('delete'); await browser.confirm();
  expect(browser.getSnapshot()).toMatchObject({ trackers: [], detail: null, recoveries: [{ outcome: 'confirmed', operation: { kind: 'delete' } }] });
  expect(mutations).toMatchObject([{ method: 'DELETE', revision: '7' }]);
  expect(browser.getReceiptPaths()).toHaveLength(1);
});

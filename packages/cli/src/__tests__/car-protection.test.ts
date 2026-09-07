import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CarClient } from '../lib/car-client.js';
import { readCarOfferReview } from '../lib/car-protection.js';
import { registerCarCommands } from '../lib/car-cli.js';
import { performCarMutation, replayCarMutation } from '../lib/car-operations.js';
import { carOfferFixture, carReportFixture, carSearchFixture, carTrackerViewFixture } from '../../../../apps/web/src/test/car-fixtures.js';
import { carContractHash } from '../../../../apps/web/src/lib/cars/selection.js';

const choiceId = 'c51f31ce-1f53-486b-b84c-2817429f3a73';
function baseRun() {
  const offer = carOfferFixture(), report = carReportFixture([offer]);
  report.protection = [{ offerId: offer.id, status: 'complete', error: null, choices: [{ id: choiceId,
    source: 'discovercars', productId: '35', name: 'Full Coverage', termsSummary: 'Reimbursement; tyres excluded.',
    policyLinks: ['https://www.sincerainsurance.com/policy'], observedExtraPrice: { currency: 'GBP', minor: 1800 },
    sourceUrl: 'https://www.discovercars.com/offer/coverage/example', observedAt: offer.observedAt,
  }] }];
  return { id: 'parent', trackerId: null, trackingClosed: false, status: 'success', createdAt: offer.observedAt,
    completedAt: offer.observedAt, error: null, search: carSearchFixture(), result: report };
}
function protectedRun() {
  const run = baseRun(), offer = run.result.offers[0]!;
  run.search.sources = ['discovercars']; run.search.extras.protection = [{ source: 'discovercars', productId: '35' }];
  run.search.protectionRecheck = { searchId: 'base', offerId: offer.id, choiceId, baseContractHash: carContractHash(offer.contract), baseCoverageTerms: offer.contract.coverageTerms };
  const extra = { kind: 'protection' as const, productId: '35', quantity: 1, category: null };
  offer.contract.extras.push(extra); offer.contract.coverageProductIds.push('35'); offer.contract.coverageTerms += ' Reimbursement; tyres excluded.';
  offer.extras.push({ ...extra, availability: { ...offer.available, text: 'Full Coverage' }, eligibility: { ...offer.driverEligible, text: 'Reimbursement; tyres excluded.' }, included: { ...offer.available, value: false }, chargeId: 'protection' });
  offer.charges.push({ id: 'protection', label: 'Full Coverage', kind: 'extra', payment: 'now', amount: { ...offer.total, value: { currency: 'GBP', minor: 1800 } } });
  offer.total.value = { currency: 'GBP', minor: 11800 }; run.result = carReportFixture([offer], ['discovercars']);
  return run;
}
let server: Server, directory: string, client: CarClient, scope: string, current: ReturnType<typeof baseRun>;
let changeScopeOnRead: boolean;
let requests: { path: string; method: string; body: string; key: string | undefined }[];
let handle: (request: IncomingMessage, response: ServerResponse) => Promise<void> | void;
function reply(response: ServerResponse, data: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ ok: status < 400, ...(status < 400 ? { data } : { error: 'Server rejected request' }) }));
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'car-protection-cli-')); scope = 'user:alice'; current = baseRun(); requests = []; changeScopeOnRead = false;
  handle = (request, response) => reply(response, { id: 'child', status: 'queued', creationKey: request.headers['idempotency-key'] }, 202);
  server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += String(chunk);
    requests.push({ path: request.url!, method: request.method!, body, key: request.headers['idempotency-key'] as string | undefined });
    if (request.url === '/api/cars/session') return reply(response, { scope, isAdmin: false });
    if (request.method === 'GET' && request.url === '/api/cars/search/parent') {
      reply(response, current); if (changeScopeOnRead) scope = 'user:bob'; return;
    }
    await handle(request, response);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test server');
  client = new CarClient(`http://127.0.0.1:${address.port}`, 'test-session');
  vi.stubEnv('FLIGHT_FINDER_SESSION', 'test-session');
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); process.exitCode = 0;
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});
async function command(args: string[]) {
  const output = vi.spyOn(console, 'log').mockImplementation(() => undefined), errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const program = new Command(); registerCarCommands(program);
  await program.parseAsync(['node', 'flightfinder', 'cars', '--server', client.origin, '--receipt-dir', directory, '--json', ...args]);
  return { output: output.mock.calls.map(call => JSON.parse(String(call[0]))), errors: errors.mock.calls.map(call => JSON.parse(String(call[0]))) };
}
const inspect = () => readCarOfferReview(client, 'parent', 'verified-quote');
const protect = (review: string) => command(['protect', 'parent', 'verified-quote', choiceId, '--review', review]);

describe('reviewed CLI rental protection', () => {
  it('prints full terms, policy links and observed extra price without claiming a combined price', async () => {
    const result = await command(['protection', 'parent', 'verified-quote']);
    expect(result.output[0]).toMatchObject({ canRecheck: true, trackingReview: null, offer: { total: { value: { minor: 10000 } } },
      discovery: { choices: [{ termsSummary: expect.stringContaining('tyres'), policyLinks: ['https://www.sincerainsurance.com/policy'], observedExtraPrice: { minor: 1800 }, review: expect.stringMatching(/^[a-f0-9]{64}$/) }] } });
    expect(await readdir(directory)).toEqual([]); expect(requests.every(request => request.method === 'GET')).toBe(true);
  });
  it('persists the canonical selected choice before sending and correlates the protected child', async () => {
    const review = (await inspect()).discovery!.choices[0]!.review!;
    handle = async (request, response) => {
      const files = await readdir(directory), receipt = JSON.parse(await readFile(join(directory, files[0]!), 'utf8'));
      expect(receipt).toMatchObject({ scope, key: request.headers['idempotency-key'], operation: { kind: 'protect', id: 'parent', revision: null, body: { offerId: 'verified-quote', choiceId } } });
      reply(response, { id: 'child', status: 'queued', creationKey: receipt.key }, 202);
    };
    const result = await protect(review);
    expect(result.output[0]).toMatchObject({ result: { id: 'child', creationKey: expect.any(String) } });
    expect(requests.filter(request => request.method === 'POST')).toMatchObject([{ path: '/api/cars/search/parent/protection', body: JSON.stringify({ offerId: 'verified-quote', choiceId }) }]);
  });
  it.each(['terms', 'price', 'account', 'closure'] as const)('requires renewed choice review after %s changes', async change => {
    const review = (await inspect()).discovery!.choices[0]!.review!;
    if (change === 'terms') current.result.protection![0]!.choices[0]!.termsSummary += ' New exclusion.';
    if (change === 'price') current.result.protection![0]!.choices[0]!.observedExtraPrice.minor++;
    if (change === 'account') scope = 'user:bob';
    if (change === 'closure') current.trackingClosed = true;
    await protect(review);
    expect(process.exitCode).toBe(1); expect(await readdir(directory)).toEqual([]);
    expect(requests.every(request => request.method === 'GET')).toBe(true);
  });
  it('binds review to the server origin', async () => {
    const original = (await inspect()).discovery!.choices[0]!.review;
    const alternate = new CarClient(client.origin.replace('127.0.0.1', 'localhost'), 'test-session');
    expect((await readCarOfferReview(alternate, 'parent', 'verified-quote')).discovery!.choices[0]!.review).not.toBe(original);
  });
  it('hides offer terms when the account changes during inspection and sends no mutation', async () => {
    changeScopeOnRead = true;
    const result = await command(['protection', 'parent', 'verified-quote']);
    expect(result.output).toEqual([]); expect(process.exitCode).toBe(1);
    expect(await readdir(directory)).toEqual([]); expect(requests.every(request => request.method === 'GET')).toBe(true);
  });
  it('offers a fresh protection recheck for an expired observation without allowing tracking of its old price', async () => {
    const old = new Date(Date.now() - 60 * 60_000).toISOString();
    current = JSON.parse(JSON.stringify(current).replaceAll(current.createdAt, old));
    const review = await inspect();
    expect(review).toMatchObject({ canRecheck: true, canTrack: false, discovery: { choices: [{ review: expect.any(String) }] } });
    await protect(review.discovery!.choices[0]!.review!);
    expect(requests.filter(request => request.method === 'POST')).toHaveLength(1);
  });
  it('recovers an accepted protected search without reading a subsequently closed parent', async () => {
    let path = '', lost = true; const jobs = new Set<string>();
    handle = (request, response) => {
      jobs.add(String(request.headers['idempotency-key']));
      if (lost) { response.destroy(); return; }
      reply(response, { id: 'child', status: 'success', creationKey: request.headers['idempotency-key'] });
    };
    await expect(performCarMutation(directory, client, { kind: 'protect', id: 'parent', revision: null, body: { offerId: 'verified-quote', choiceId } }, saved => { path = saved; })).rejects.toMatchObject({ outcome: 'unconfirmed' });
    const before = await readFile(path, 'utf8'); current.trackingClosed = true; lost = false;
    expect(await replayCarMutation(path, client)).toMatchObject({ result: { id: 'child', status: 'success' } });
    expect(jobs.size).toBe(1); expect(await readFile(path, 'utf8')).toBe(before);
    expect(requests.some(request => request.path === '/api/cars/search/parent')).toBe(false);
  });
  it.each([410, 412] as const)('retains rejected protected receipts without reading a tracker on HTTP %i', async status => {
    handle = (request, response) => reply(response, null, status);
    await expect(performCarMutation(directory, client, { kind: 'protect', id: 'parent', revision: null, body: { offerId: 'verified-quote', choiceId } }, () => undefined)).rejects.toMatchObject({ status });
    expect(await readdir(directory)).toHaveLength(1);
    expect(requests.every(request => request.path === '/api/cars/session' || request.path === '/api/cars/search/parent/protection')).toBe(true);
  });
  it('does not accept a mismatched protected search acknowledgement', async () => {
    handle = (request, response) => reply(response, { id: 'child', status: 'queued', creationKey: crypto.randomUUID() });
    await expect(performCarMutation(directory, client, { kind: 'protect', id: 'parent', revision: null, body: { offerId: 'verified-quote', choiceId } }, () => undefined)).rejects.toMatchObject({ outcome: 'unconfirmed' });
  });
  it('requires review of the fresh protected offer before tracking and preserves recovery after closure', async () => {
    current = protectedRun();
    const review = await inspect();
    expect(review).toMatchObject({ canTrack: true, canRecheck: false, trackingReview: expect.stringMatching(/^[a-f0-9]{64}$/), offer: { total: { value: { minor: 11800 } } } });
    await command(['track', 'parent', 'verified-quote']); expect(process.exitCode).toBe(1);
    expect(await readdir(directory)).toEqual([]); process.exitCode = 0;
    handle = (request, response) => { response.destroy(); };
    await command(['track', 'parent', 'verified-quote', '--review-protection', review.trackingReview!]);
    const files = await readdir(directory); expect(files).toHaveLength(1);
    current.trackingClosed = true;
    handle = (request, response) => reply(response, { tracker: carTrackerViewFixture(), creationKey: request.headers['idempotency-key'] });
    expect(await replayCarMutation(join(directory, files[0]!), client)).toMatchObject({ result: { tracker: { id: 'tracker-one' } } });
    expect(new Set(requests.filter(request => request.method === 'POST').map(request => request.key)).size).toBe(1);
  });
  it('keeps base tracking available without a protection review flag', async () => {
    handle = (request, response) => reply(response, { tracker: carTrackerViewFixture(), creationKey: request.headers['idempotency-key'] });
    const result = await command(['track', 'parent', 'verified-quote']);
    expect(result.output[0]).toMatchObject({ result: { tracker: { id: 'tracker-one' } } });
    expect(requests.filter(request => request.method === 'POST')).toMatchObject([{ path: '/api/cars' }]);
  });
  it('rejects an old fresh-offer review after its price changes without changing its offer ID', async () => {
    current = protectedRun(); const review = await inspect();
    current.result.offers[0]!.total.value!.minor += 100;
    current.result.offers[0]!.charges[0]!.amount.value!.minor += 100;
    await command(['track', 'parent', 'verified-quote', '--review-protection', review.trackingReview!]);
    expect(process.exitCode).toBe(1); expect(await readdir(directory)).toEqual([]);
    expect(requests.every(request => request.method === 'GET')).toBe(true);
  });
});

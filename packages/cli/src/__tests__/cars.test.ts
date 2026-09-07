import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CarClient } from '../lib/car-client.js';
import { CarMutationError, performCarMutation, replayCarMutation, waitForCarSearch } from '../lib/car-operations.js';
import { registerCarCommands } from '../lib/car-cli.js';
import { readCarInput } from '../lib/car-cli-input.js';
import { carReportFixture, carSearchFixture, carTrackerViewFixture } from '../../../../apps/web/src/test/car-fixtures.js';

let server: Server, directory: string, client: CarClient, scope: string;
let handle: (request: IncomingMessage, response: ServerResponse, body: string) => Promise<void> | void;
let requests: { method: string; path: string; key: string | undefined; revision: string | undefined; body: string }[];
const refresh = { kind: 'refresh' as const, id: 'tracker-one', body: null, revision: 7 };
function respond(response: ServerResponse, data: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ ok: true, data }));
}
function reject(response: ServerResponse, status: number, error: string) {
  response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ ok: false, error }));
}
function runView(status = 'running') {
  const now = new Date().toISOString(), active = status === 'running' || status === 'queued';
  return { id: 'run-one', trackerId: null, status, createdAt: now, completedAt: active ? null : now, error: null, search: carSearchFixture(), result: active ? null : carReportFixture() };
}
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'car-commands-')); scope = 'user:alice'; requests = [];
  handle = (request, response) => respond(response, { id: 'run-one', trackerId: 'tracker-one', status: 'queued', refreshKey: request.headers['idempotency-key'] });
  server = createServer(async (request, response) => {
    let body = ''; for await (const chunk of request) body += String(chunk);
    requests.push({ method: request.method!, path: request.url!, key: request.headers['idempotency-key'] as string | undefined, revision: request.headers['x-car-revision'] as string | undefined, body });
    if (request.url === '/api/cars/session') { respond(response, { scope, isAdmin: scope === 'single' }); return; }
    await handle(request, response, body);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No local server');
  client = new CarClient(`http://127.0.0.1:${address.port}`, 'session');
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs(); process.exitCode = 0;
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});
describe('durable car command execution', () => {
  it('refuses confirmation from a different displayed account before writing a receipt or sending a mutation', async () => {
    await expect(performCarMutation(directory, client, refresh, () => undefined, undefined, 'user:bob')).rejects.toMatchObject({ name: 'CarScopeError' });
    expect(await readdir(directory)).toEqual([]);
    expect(requests.every(request => request.method === 'GET' && request.path === '/api/cars/session')).toBe(true);
  });
  it('recovers a lost acknowledgement after restart and concurrent retries without scheduling another refresh', async () => {
    let prepared = '', loseReply = true;
    const jobs = new Map<string, string>();
    handle = async (request, response) => {
      expect(JSON.parse(await readFile(prepared, 'utf8'))).toMatchObject({ key: request.headers['idempotency-key'], operation: refresh });
      const key = String(request.headers['idempotency-key']);
      if (!jobs.has(key)) jobs.set(key, `run-${jobs.size + 1}`);
      if (loseReply) { loseReply = false; response.destroy(); return; }
      respond(response, { id: jobs.get(key), trackerId: 'tracker-one', status: 'success', refreshKey: key });
    };
    await expect(performCarMutation(directory, client, refresh, path => { prepared = path; })).rejects.toMatchObject({ outcome: 'unconfirmed', receiptPath: expect.any(String) });
    const original = await readFile(prepared, 'utf8');
    const recovered = await Promise.all([replayCarMutation(prepared, new CarClient(client.origin, 'new-session')), replayCarMutation(prepared, client)]);
    expect(recovered.map(value => value.result)).toEqual(Array.from({ length: 2 }, () => ({ id: 'run-1', trackerId: 'tracker-one', status: 'success', refreshKey: JSON.parse(original).key })));
    expect([...jobs.values()]).toEqual(['run-1']);
    expect(await readFile(prepared, 'utf8')).toBe(original);
    expect(new Set(requests.filter(request => request.method === 'POST').map(request => request.revision))).toEqual(new Set(['7']));
  });
  it('sends no mutation when account scope changes after publication', async () => {
    await expect(performCarMutation(directory, client, refresh, () => { scope = 'user:bob'; })).rejects.toBeInstanceOf(CarMutationError);
    expect(requests.every(request => request.method === 'GET' && request.path === '/api/cars/session')).toBe(true);
    expect(await readdir(directory)).toHaveLength(1);
  });
  it.each([
    { id: 'run-one', trackerId: 'different', status: 'queued' },
    { id: 'run-one', trackerId: 'tracker-one', status: 'invented' },
    { id: '../foreign', trackerId: 'tracker-one', status: 'queued' },
  ])('keeps malformed or mismatched successful acknowledgements unconfirmed', async invalid => {
    handle = (request, response) => respond(response, { ...invalid, refreshKey: request.headers['idempotency-key'] });
    await expect(performCarMutation(directory, client, refresh, () => undefined)).rejects.toMatchObject({ outcome: 'unconfirmed' });
    expect(await readdir(directory)).toHaveLength(1);
  });
  it.each([[410, 'removed'], [404, 'inaccessible'], [503, 'unconfirmed']] as const)('preserves the original receipt on HTTP %i without assuming a replacement or deletion', async (status, outcome) => {
    handle = (request, response) => reject(response, status, 'Server state changed');
    await expect(performCarMutation(directory, client, refresh, () => undefined)).rejects.toMatchObject({ outcome, status });
    expect(await readdir(directory)).toHaveLength(1);
  });
  it('accepts replayed creation even when that tracker has since changed its settings', async () => {
    const tracker = { ...carTrackerViewFixture(), revision: 9, active: false };
    handle = (request, response) => respond(response, { tracker, creationKey: request.headers['idempotency-key'] }, 201);
    const result = await performCarMutation(directory, client, { kind: 'track', id: null, revision: null, body: { searchId: 'search-one', offerId: 'offer-one' } }, () => undefined);
    expect(result.result).toMatchObject({ tracker: { id: 'tracker-one', revision: 9, active: false } });
  });
  it('reports current settings after a stale PATCH without treating them as proof the earlier request succeeded', async () => {
    const tracker = { ...carTrackerViewFixture(), revision: 8, active: false };
    handle = (request, response) => request.method === 'PATCH' ? reject(response, 412, 'Revision changed')
      : respond(response, { tracker, snapshots: [], runs: [], latestObservation: null, notificationsConfigured: false, canReassign: false });
    await expect(performCarMutation(directory, client, { kind: 'edit', id: 'tracker-one', revision: 7, body: { active: false } }, () => undefined))
      .rejects.toMatchObject({ outcome: 'stale', status: 412, current: { tracker: { active: false, revision: 8 } } });
  });
  it('surfaces a failed reconciliation read instead of hiding its error', async () => {
    handle = (request, response) => reject(response, request.method === 'PATCH' ? 412 : 503, request.method === 'PATCH' ? 'Revision changed' : 'Database unavailable');
    await expect(performCarMutation(directory, client, { kind: 'edit', id: 'tracker-one', revision: 7, body: { active: false } }, () => undefined))
      .rejects.toThrow(/Current settings could not be verified: Database unavailable/);
  });
  it('stops polling on interruption without cancelling the server search', async () => {
    const controller = new AbortController();
    handle = (request, response) => { respond(response, runView()); controller.abort(); };
    await expect(waitForCarSearch(client, 'run-one', { signal: controller.signal, intervalMs: 1 })).rejects.toThrow(/was not cancelled/);
    expect(requests.every(request => request.method === 'GET')).toBe(true);
  });
  it('returns complete price evidence from a terminal search instead of just an advertised total', async () => {
    const run = runView('success'); handle = (request, response) => respond(response, run);
    expect(await waitForCarSearch(client, 'run-one')).toEqual(run);
  });
});
describe('rental CLI commands', () => {
  async function run(args: string[]) {
    const command = new Command(), handled = registerCarCommands(command);
    vi.stubEnv('FLIGHT_FINDER_SESSION', 'session');
    await command.parseAsync(['node', 'flightfinder', 'cars', '--server', client.origin, '--receipt-dir', directory, '--json', ...args]);
    expect(handled()).toBe(true);
  }
  it('reads account-bound preferences without creating a mutation receipt', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    handle = (request, response) => respond(response, { scope, userId: 'alice', providers: [], effectiveProviders: ['discovercars', 'autoeurope'], revision: 3, savingAllowed: true });
    await run(['preferences']);
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ providers: [], revision: 3 });
    expect(await readdir(directory)).toEqual([]);
    expect(requests.every(row => row.method === 'GET')).toBe(true);
  });
  it('hides preferences if the account changes during the read', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handle = (request, response) => {
      respond(response, { scope, userId: 'alice', providers: [], effectiveProviders: ['discovercars', 'autoeurope'], revision: 0, savingAllowed: true });
      scope = 'user:bob';
    };
    await run(['preferences']);
    expect(process.exitCode).toBe(1);
    expect(output.mock.calls).toEqual([]);
    expect(await readdir(directory)).toEqual([]);
  });
  it('shows single-user defaults without allowing an implicit server-wide preference write', async () => {
    scope = 'single';
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handle = (request, response) => respond(response, { scope, userId: null, providers: [], effectiveProviders: ['discovercars', 'autoeurope'], revision: null, savingAllowed: false });
    await run(['preferences']);
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ savingAllowed: false, providers: [] });
    await run(['preferences', '--reset', '--revision', '0']);
    expect(String(errors.mock.calls.at(-1)?.[0])).toMatch(/personal account/);
    expect(requests.every(row => row.method === 'GET')).toBe(true);
    expect(await readdir(directory)).toEqual([]);
  });
  it('does not publish a preference receipt targeting another account', async () => {
    await expect(performCarMutation(directory, client, { kind: 'preferences', id: 'bob', revision: 0, body: { providers: [] } }, () => undefined)).rejects.toThrow(/account/);
    expect(await readdir(directory)).toEqual([]);
    expect(requests.every(row => row.method === 'GET')).toBe(true);
  });
  it('resolves omitted search sources from saved preferences before retaining the search receipt', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined); vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const search = carSearchFixture(), catalog = { id: 'ourairports:1', version: 'a'.repeat(64) };
    const body = { ...search, sources: undefined, pickup: catalog, dropoff: catalog, pickupAt: { date: search.pickupAt.date, time: search.pickupAt.time }, dropoffAt: { date: search.dropoffAt.date, time: search.dropoffAt.time } };
    const path = join(directory, 'search.json'); await writeFile(path, JSON.stringify(body));
    handle = (request, response) => request.method === 'POST'
      ? respond(response, { id: 'run-one', status: 'queued', creationKey: request.headers['idempotency-key'] }, 202)
      : respond(response, { scope, userId: 'alice', providers: ['autoeurope'], effectiveProviders: ['autoeurope'], revision: 2, savingAllowed: true });
    await run(['search', '--file', path]);
    expect(process.exitCode ?? 0).toBe(0);
    expect(JSON.parse(requests.find(row => row.method === 'POST')!.body).sources).toEqual(['autoeurope']);
    const saved = (await readdir(directory)).find(name => name !== 'search.json')!;
    expect(JSON.parse(await readFile(join(directory, saved), 'utf8')).operation.body.sources).toEqual(['autoeurope']);
  });
  it.each([['--providers', 'autoeurope,discovercars'], ['--reset']] as const)('persists a revision-fenced preference receipt before changing choices: %s', (...flags) => {
    return (async () => {
      const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      let providers: string[] = [], revision = 3;
      handle = async (request, response, body) => {
        if (request.method === 'PATCH') {
          expect(request.url).toBe('/api/cars/preferences/alice');
          const files = await readdir(directory);
          expect(JSON.parse(await readFile(join(directory, files[0]!), 'utf8'))).toMatchObject({ scope, operation: { kind: 'preferences', id: 'alice', revision: 3 } });
          expect(request.headers['x-car-revision']).toBe('3');
          providers = JSON.parse(body).providers; revision++;
        }
        respond(response, { scope, userId: 'alice', providers, effectiveProviders: providers.length ? providers : ['discovercars', 'autoeurope'], revision, savingAllowed: true });
      };
      await run(['preferences', ...flags, '--revision', '3']);
      expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ result: { revision: 4, providers: flags[0] === '--reset' ? [] : ['autoeurope', 'discovercars'] } });
    })();
  });
  it('keeps a lost preference acknowledgement unproven and does not overwrite a newer revision on retry', async () => {
    let revision = 0, providers = ['discovercars'], saved = '';
    handle = (request, response, body) => {
      if (request.method === 'PATCH') {
        if (Number(request.headers['x-car-revision']) !== revision) { reject(response, 412, 'Preferences changed'); return; }
        revision++; providers = JSON.parse(body).providers; response.destroy(); return;
      }
      respond(response, { scope, userId: 'alice', providers, effectiveProviders: providers, revision, savingAllowed: true });
    };
    await expect(performCarMutation(directory, client, { kind: 'preferences', id: 'alice', revision: 0, body: { providers: ['autoeurope'] } }, path => { saved = path; })).rejects.toMatchObject({ outcome: 'unconfirmed' });
    await expect(replayCarMutation(saved, client)).rejects.toMatchObject({ outcome: 'stale', current: { providers: ['autoeurope'], revision: 1 } });
    expect(revision).toBe(1);
    expect(JSON.parse(await readFile(saved, 'utf8')).operation.revision).toBe(0);
  });
  it('rejects an acknowledgement with a foreign preference owner or a different ordered selection', async () => {
    for (const changes of [{ userId: 'bob', scope: 'user:bob' }, { providers: ['discovercars', 'autoeurope'], effectiveProviders: ['discovercars', 'autoeurope'] }]) {
      handle = (request, response) => respond(response, { scope, userId: 'alice', providers: ['autoeurope', 'discovercars'], effectiveProviders: ['autoeurope', 'discovercars'], revision: 1, savingAllowed: true, ...changes });
      await expect(performCarMutation(directory, client, { kind: 'preferences', id: 'alice', revision: 0, body: { providers: ['autoeurope', 'discovercars'] } }, () => undefined)).rejects.toMatchObject({ outcome: 'unconfirmed' });
    }
  });
  it.each([['--reset'], ['--providers', 'unknown', '--revision', '0'], ['--reset', '--providers', 'autoeurope', '--revision', '0']])('rejects invalid preference changes before sending requests: %s', async (...flags) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await run(['preferences', ...flags]);
    expect(process.exitCode).toBe(1);
    expect(requests).toEqual([]);
  });
  it('publishes recovery information before sending a refresh and prints correlated JSON', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined), errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handle = (request, response) => {
      expect(JSON.parse(String(errors.mock.calls[0]?.[0]))).toMatchObject({ state: 'prepared', receiptPath: expect.any(String) });
      respond(response, { id: 'run-one', trackerId: 'tracker-one', status: 'queued', refreshKey: request.headers['idempotency-key'] });
    };
    await run(['refresh', 'tracker-one', '--revision', '7']);
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ receiptPath: expect.any(String), result: { id: 'run-one', trackerId: 'tracker-one', status: 'queued' } });
    expect(requests.every(request => request.path.startsWith('/api/cars'))).toBe(true);
  });
  it('updates only the selected target using integer minor units and the specified revision', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined); vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const tracker = { ...carTrackerViewFixture(), revision: 8, options: { ...carTrackerViewFixture().options, target: { currency: 'GBP', minor: 12345 } } };
    handle = (request, response) => respond(response, { tracker });
    await run(['alerts', 'tracker-one', '--revision', '7', '--target', '123.45', '--currency', 'GBP']);
    const update = requests.find(request => request.method === 'PATCH');
    expect(update).toMatchObject({ revision: '7', path: '/api/cars/tracker-one' });
    expect(JSON.parse(update!.body)).toEqual({ target: { currency: 'GBP', minor: 12345 } });
    expect(process.exitCode ?? 0).toBe(0);
  });
  it.each([
    { command: ['pause', 'tracker-one', '--revision', '7'], body: { active: false } },
    { command: ['resume', 'tracker-one', '--revision', '7'], body: { active: true } },
    { command: ['rename', 'tracker-one', 'Family weekend', '--revision', '7'], body: { label: 'Family weekend' } },
    { command: ['reassign', 'tracker-one', 'bob', '--revision', '7'], body: { userId: 'bob' } },
    { command: ['alerts', 'tracker-one', '--revision', '7', '--clear-target', '--no-lows', '--interval', '6'], body: { target: null, notifyLows: false, scrapeInterval: 6 } },
  ])('applies the requested settings without inserting unrelated defaults: $command', async ({ command, body }) => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined); vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handle = (request, response, text) => {
      const update = JSON.parse(text), original = carTrackerViewFixture();
      respond(response, { tracker: { ...original, ...update, options: { ...original.options, ...update }, revision: 8 } });
    };
    await run(command);
    expect(JSON.parse(requests.find(request => request.method === 'PATCH')!.body)).toEqual(body);
    expect(process.exitCode ?? 0).toBe(0);
  });
  it.each([
    { command: ['delete', 'tracker-one', '--revision', '7'], path: '/api/cars/tracker-one', reply: { id: 'tracker-one', deleted: true } },
    { command: ['cancel', 'run-one'], path: '/api/cars/search/run-one', reply: { id: 'run-one', status: 'cancelled' } },
  ])('requires a matching destructive-operation acknowledgement: $command', async ({ command, path, reply }) => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined); vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handle = (request, response) => respond(response, reply);
    await run(command);
    expect(requests.find(request => request.method === 'DELETE')).toMatchObject({ path, body: '' });
    expect(process.exitCode ?? 0).toBe(0);
  });
  it.each(['success', 'failed'])('starts the reviewed file unchanged in intent and reports terminal %s status', async status => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined); vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const search = carSearchFixture(), catalog = { id: 'ourairports:1', version: 'a'.repeat(64) };
    const body = { ...search, pickup: catalog, dropoff: catalog, pickupAt: { date: search.pickupAt.date, time: search.pickupAt.time }, dropoffAt: { date: search.dropoffAt.date, time: search.dropoffAt.time } };
    const path = join(directory, 'search.json'); await writeFile(path, JSON.stringify(body));
    handle = (request, response) => request.method === 'POST'
      ? respond(response, { id: 'run-one', status: 'queued', creationKey: request.headers['idempotency-key'] }, 202)
      : respond(response, { ...runView(status), error: status === 'failed' ? 'Provider unavailable' : null });
    await run(['search', '--file', path, '--wait']);
    expect(JSON.parse(requests.find(request => request.method === 'POST')!.body)).toEqual(body);
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ result: { status } });
    expect(process.exitCode ?? 0).toBe(status === 'failed' ? 1 : 0);
  });
  it.each([
    ['alerts', 'tracker-one', '--revision', '7', '--target', '12.345', '--currency', 'GBP'],
    ['alerts', 'tracker-one', '--revision', '7', '--target', '10'],
    ['refresh', 'tracker-one', '--revision', '-1'],
  ].map(args => ({ args })))('rejects invalid arguments before any server call $args', async ({ args }) => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await run(args);
    expect(requests).toEqual([]); expect(process.exitCode).toBe(1);
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toHaveProperty('error');
  });
  it('returns a visible error for invalid list data rather than an empty tracker list', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined), error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handle = (request, response) => respond(response, { trackers: [carTrackerViewFixture(), carTrackerViewFixture()], nextCursor: null });
    await run(['list']);
    expect(output.mock.calls).toEqual([]);
    expect(JSON.parse(String(error.mock.calls[0]?.[0]))).toMatchObject({ error: expect.stringContaining('did not advance') });
  });
  it('keeps an incomplete natural-language draft editable without starting a search', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    handle = (request, response) => respond(response, { draft: { pickupQuery: 'London', driver: { age: 30 }, warnings: ['Confirm your dates'] } });
    await run(['parse', 'A rental in London']);
    expect(JSON.parse(String(output.mock.calls[0]?.[0]))).toMatchObject({ reviewRequired: true, draft: { pickupQuery: 'London', driver: { age: 30, licenceYears: null }, pickupAt: { date: null, time: null }, warnings: ['Confirm your dates'] } });
    expect(requests.map(request => request.path)).toEqual(['/api/cars/parse']);
    expect(await readdir(directory)).toEqual([]);
  });
  it('rejects a missing draft instead of substituting empty suggestions', async () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined); vi.spyOn(console, 'error').mockImplementation(() => undefined);
    handle = (request, response) => respond(response, {});
    await run(['parse', 'A rental in London']);
    expect(output.mock.calls).toEqual([]); expect(process.exitCode).toBe(1);
  });
  it('bounds file input and does not include malformed payload contents in errors', async () => {
    const path = join(directory, 'input.json');
    await writeFile(path, 'x'.repeat(64 * 1024 + 1));
    await expect(readCarInput(path)).rejects.toThrow(/64 KiB/);
    await writeFile(path, '{"secret": "do-not-print"');
    await expect(readCarInput(path)).rejects.toThrow('Rental input must be valid UTF-8 JSON');
    await expect(readCarInput(directory)).rejects.toThrow(/regular file/);
  });
});

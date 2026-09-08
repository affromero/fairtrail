import { createServer, type Server } from 'node:http';
import { chmod, copyFile, mkdir, mkdtemp, open, readFile, readdir, rm, stat, symlink, writeFile, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CarClient } from '../lib/car-client.js';
import { readCarReceipt, saveCarReceipt, type CarOperation } from '../lib/car-receipts.js';

let directory: string, server: Server, client: CarClient, scope: string, denied: boolean;
let requests: string[];
const intent: CarOperation = { kind: 'refresh', id: 'tracker-one', body: null, revision: 7 };
const searchBody = () => ({
  pickup: { id: 'ourairports:1', version: 'a'.repeat(64) }, dropoff: { id: 'geonames:2', version: 'a'.repeat(64) },
  pickupAt: { date: '2026-10-15', time: '11:00' }, dropoffAt: { date: '2026-10-18', time: '11:00' },
  driver: { age: 30, licenceYears: 10, residenceCountry: 'US' }, currency: 'USD', sources: ['autoeurope', 'discovercars'],
});
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'car-receipts-')); scope = 'user:alice'; denied = false; requests = [];
  server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    response.writeHead(denied ? 401 : 200);
    response.end(JSON.stringify(denied ? { ok: false, error: 'Sign in' } : { ok: true, data: { scope, isAdmin: false } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No local server');
  client = new CarClient(`http://127.0.0.1:${address.port}`, 'private-session', 'private-token');
});
afterEach(async () => {
  vi.restoreAllMocks();
  server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  await rm(directory, { recursive: true, force: true });
});
describe('durable car CLI recovery records', () => {
  it.each([
    { id: null, revision: null, body: { offerId: 'offer', choiceId: 'c51f31ce-1f53-486b-b84c-2817429f3a73' } },
    { id: 'parent', revision: 0, body: { offerId: 'offer', choiceId: 'c51f31ce-1f53-486b-b84c-2817429f3a73' } },
    { id: 'parent', revision: null, body: { offerId: 'offer', choiceId: 'invented' } },
    { id: 'parent', revision: null, body: { offerId: 'offer', choiceId: 'c51f31ce-1f53-486b-b84c-2817429f3a73', price: 1 } },
  ])('refuses invalid protection targets or invented payload fields before publication', async invalid => {
    await expect(saveCarReceipt(directory, client, { kind: 'protect', ...invalid })).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
    expect(requests.every(request => request === 'GET /api/cars/session')).toBe(true);
  });
  it('rejects a FIFO receipt without waiting for a writer', async () => {
    const path = join(directory, 'pipe.json');
    await promisify(execFile)('mkfifo', ['-m', '600', path]);
    await expect(readCarReceipt(path, client)).rejects.toThrow(/private/);
    expect((await stat(path)).isFIFO()).toBe(true);
  });
  it('rejects a directory in place of a receipt before reading its contents', async () => {
    const path = join(directory, 'directory.json'); await mkdir(path, { mode: 0o700 });
    await expect(readCarReceipt(path, client)).rejects.toThrow(/private/);
    expect(await readdir(path)).toEqual([]);
  });
  it('rejects storage whose parent allows replacement by other users', async () => {
    const parent = join(directory, 'shared'), storage = join(parent, 'receipts');
    await mkdir(parent, { mode: 0o700 }); await chmod(parent, 0o777);
    await expect(saveCarReceipt(storage, client, intent)).rejects.toThrow(/parent directories/);
    expect(await readdir(parent)).toEqual([]);
    expect(requests.every(request => request === 'GET /api/cars/session')).toBe(true);
  });
  it('preserves a published receipt after directory synchronization fails without sending a mutation', async () => {
    const handle = await open(directory, 'r');
    const prototype = Object.getPrototypeOf(handle) as FileHandle;
    const sync = prototype.sync;
    await handle.close();
    let failed = false;
    vi.spyOn(prototype, 'sync').mockImplementation(async function (this: FileHandle) {
      if (!failed && (await this.stat()).isDirectory()) { failed = true; throw new Error('Injected disk synchronization failure'); }
      return sync.call(this);
    });
    await expect(saveCarReceipt(directory, client, intent)).rejects.toThrow(/no mutation was sent/);
    const files = await readdir(directory);
    expect(files).toHaveLength(1);
    const saved = await readCarReceipt(join(directory, files[0]!), client);
    expect(saved.operation).toEqual(intent);
    expect(files).toEqual([`${saved.key}.json`]);
    expect(requests.every(request => request === 'GET /api/cars/session')).toBe(true);
  });
  it('rejects a payload larger than the API limit before publishing a receipt', async () => {
    await expect(saveCarReceipt(directory, client, { kind: 'edit', id: 'tracker-one', revision: 7, body: { label: 'x'.repeat(64 * 1024) } })).rejects.toThrow(/payload is too large/);
    expect(await readdir(directory)).toEqual([]);
  });
  it('recovers the same immutable identity after a new client starts without persisting credentials', async () => {
    const saved = await saveCarReceipt(directory, client, intent);
    const text = await readFile(saved.path, 'utf8');
    expect(text).not.toMatch(/private-session|private-token|authorization|cookie/i);
    expect((await stat(saved.path)).mode & 0o777).toBe(0o600);
    expect(await readCarReceipt(saved.path, new CarClient(client.origin, 'new-session'))).toEqual(saved.receipt);
    expect(await readFile(saved.path, 'utf8')).toBe(text);
    expect(requests.every(request => request === 'GET /api/cars/session')).toBe(true);
  });
  it('publishes concurrent requests independently without partial records or overwritten identities', async () => {
    const saved = await Promise.all(Array.from({ length: 8 }, () => saveCarReceipt(directory, client, intent)));
    expect(new Set(saved.map(value => value.receipt.key)).size).toBe(8);
    expect((await readdir(directory)).sort()).toEqual(saved.map(value => `${value.receipt.key}.json`).sort());
    for (const value of saved) expect(await readCarReceipt(value.path, client)).toEqual(value.receipt);
  });
  it('reauthenticates on read and rejects another account without changing the saved record', async () => {
    const saved = await saveCarReceipt(directory, client, intent), original = await readFile(saved.path, 'utf8');
    scope = 'user:bob';
    await expect(readCarReceipt(saved.path, client)).rejects.toThrow(/another server, account/);
    expect(await readFile(saved.path, 'utf8')).toBe(original);
  });
  it('does not infer an account when the current session is denied', async () => {
    const saved = await saveCarReceipt(directory, client, intent); denied = true;
    await expect(readCarReceipt(saved.path, client)).rejects.toMatchObject({ status: 401 });
    await expect(saveCarReceipt(directory, client, intent)).rejects.toMatchObject({ status: 401 });
    expect(await readdir(directory)).toEqual([`${saved.receipt.key}.json`]);
  });
  it('rejects a renamed receipt and symlink without accepting another request identity', async () => {
    const saved = await saveCarReceipt(directory, client, intent), renamed = join(directory, 'different.json'), linked = join(directory, 'linked.json');
    await copyFile(saved.path, renamed); await symlink(saved.path, linked);
    await expect(readCarReceipt(renamed, client)).rejects.toThrow(/another server, account, or request/);
    await expect(readCarReceipt(linked, client)).rejects.toThrow();
  });
  it('refuses readable-by-others directories and files', async () => {
    const saved = await saveCarReceipt(directory, client, intent);
    await chmod(saved.path, 0o644);
    await expect(readCarReceipt(saved.path, client)).rejects.toThrow(/private/);
    await chmod(directory, 0o755);
    await expect(saveCarReceipt(directory, client, intent)).rejects.toThrow(/private/);
  });
  it.each(['{', 'x'.repeat(128 * 1024 + 1)])('rejects corrupt or oversized records without overwriting them', async content => {
    const saved = await saveCarReceipt(directory, client, intent);
    await writeFile(saved.path, content);
    await expect(readCarReceipt(saved.path, client)).rejects.toThrow();
    expect(await readFile(saved.path, 'utf8')).toBe(content);
  });
  it('rejects accidental credential fields before creating a record', async () => {
    await expect(saveCarReceipt(directory, client, { kind: 'edit', id: 'tracker-one', revision: 7, body: { authorization: 'secret' } })).rejects.toThrow(/Unexpected field/);
    expect(await readdir(directory)).toEqual([]);
  });
  it('roundtrips real budget and target amounts while detaching caller-owned input', async () => {
    const body = { ...searchBody(), filters: { maxTotal: { currency: 'USD', minor: 12500 } } };
    const search = await saveCarReceipt(directory, client, { kind: 'search', id: null, revision: null, body });
    body.filters.maxTotal.minor = 999;
    expect(search.receipt.operation.body).toMatchObject({ filters: { maxTotal: { currency: 'USD', minor: 12500 } } });
    expect(await readCarReceipt(search.path, client)).toEqual(search.receipt);
    const track = await saveCarReceipt(directory, client, { kind: 'track', id: null, revision: null, body: { searchId: 'search-one', offerId: 'offer-one', target: { currency: 'JPY', minor: 15000 } } });
    expect((await readCarReceipt(track.path, client)).operation.body).toEqual({ searchId: 'search-one', offerId: 'offer-one', target: { currency: 'JPY', minor: 15000 }, mode: 'best', notifyLows: true, scrapeInterval: 3 });
    const edit = await saveCarReceipt(directory, client, { kind: 'edit', id: 'tracker-one', revision: 7, body: { target: { currency: 'USD', minor: 10000 } } });
    expect((await readCarReceipt(edit.path, client)).operation.body).toEqual({ target: { currency: 'USD', minor: 10000 } });
  });
  it('validates old search receipts without changing omitted defaults or their original request body', async () => {
    const body = { ...searchBody(), pickupAt: { date: '2000-01-01', time: '11:00' }, dropoffAt: { date: '2000-01-02', time: '11:00' }, currency: 'usd' };
    const saved = await saveCarReceipt(directory, client, intent);
    const content = JSON.stringify({ ...saved.receipt, operation: { kind: 'search', id: null, revision: null, body } });
    await writeFile(saved.path, content);
    expect((await readCarReceipt(saved.path, client)).operation.body).toEqual(body);
    expect(await readFile(saved.path, 'utf8')).toBe(content);
  });
  it.each([
    { active: 'false' }, { scrapeInterval: 0 }, { target: { currency: 'USD', minor: -1 } },
    { target: { currency: 'USD', minor: 10, authorization: 'secret' } }, {},
  ])('rejects invalid edits before publication', async body => {
    await expect(saveCarReceipt(directory, client, { kind: 'edit', id: 'tracker-one', revision: 7, body })).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
  });
  it.each([
    { driver: { age: 30, licenceYears: 10, residenceCountry: 'US', authorization: 'secret' } },
    { extras: { additionalDrivers: [{ age: 30, cookie: 'secret' }] } },
    { extras: { protection: [{ source: 'discovercars', productId: { token: 'secret' } }] } },
    { pickup: { id: 'ourairports:1', version: { token: 'secret' } } },
  ])('rejects nested credential containers before publishing or replaying', async invalid => {
    const body = { ...searchBody(), ...invalid };
    await expect(saveCarReceipt(directory, client, { kind: 'search', id: null, revision: null, body })).rejects.toThrow();
    expect(await readdir(directory)).toEqual([]);
    const saved = await saveCarReceipt(directory, client, intent);
    const content = JSON.stringify({ ...saved.receipt, operation: { kind: 'search', id: null, revision: null, body } });
    await writeFile(saved.path, content);
    await expect(readCarReceipt(saved.path, client)).rejects.toThrow();
    expect(await readFile(saved.path, 'utf8')).toBe(content);
  });
});

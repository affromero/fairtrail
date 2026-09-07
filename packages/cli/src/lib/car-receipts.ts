import { constants } from 'node:fs';
import { link, mkdir, open, realpath, unlink, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CarClient, CarScopeError } from './car-client.js';
import { carCreationInput } from '../../../../apps/web/src/lib/cars/creation-input.js';
import { carInputFields, normalizeCarSearchInput } from '../../../../apps/web/src/lib/cars/public-input.js';
import { carText, validateCarOptions } from '../../../../apps/web/src/lib/cars/validation.js';

type Kind = 'search' | 'track' | 'refresh' | 'edit' | 'delete' | 'cancel';
export interface CarOperation { kind: Kind; id: string | null; body: Record<string, unknown> | null; revision: number | null }
export interface CarReceipt { version: 1; key: string; origin: string; scope: string; createdAt: string; operation: CarOperation }
const MAX_BYTES = 128 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const fields: Record<Kind, readonly string[]> = {
  search: ['pickup', 'dropoff', 'pickupAt', 'dropoffAt', 'driver', 'currency', 'sources', 'extras', 'filters'],
  track: ['searchId', 'offerId', 'label', 'mode', 'target', 'notifyLows', 'scrapeInterval'],
  refresh: [], edit: ['active', 'target', 'notifyLows', 'scrapeInterval', 'userId', 'label'], delete: [], cancel: [],
};
function object(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Invalid car recovery record');
  return raw as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unexpected field in car recovery record');
}
function normalizePayload(body: Record<string, unknown>, kind: Kind): Record<string, unknown> {
  if (kind === 'search') return normalizeCarSearchInput(body);
  if (body.target != null) carInputFields(body.target, ['currency', 'minor']);
  if (kind === 'track') {
    const { searchId, offerId, label, options } = carCreationInput(body);
    return { searchId, offerId, ...options, ...(label === null ? {} : { label }) };
  }
  if (!Object.keys(body).length) throw new Error('Car recovery update must change at least one setting');
  if (body.active !== undefined && typeof body.active !== 'boolean') throw new Error('Car active setting must be a boolean');
  const options = validateCarOptions(body);
  return {
    ...(body.active === undefined ? {} : { active: body.active }),
    ...(body.target === undefined ? {} : { target: options.target }),
    ...(body.notifyLows === undefined ? {} : { notifyLows: options.notifyLows }),
    ...(body.scrapeInterval === undefined ? {} : { scrapeInterval: options.scrapeInterval }),
    ...(body.userId === undefined ? {} : { userId: carText(body.userId, 200, 'tracker owner') }),
    ...(body.label === undefined ? {} : { label: carText(body.label, 250, 'tracker label') }),
  };
}
function operation(raw: unknown, normalize: boolean): CarOperation {
  const value = object(raw); exact(value, ['kind', 'id', 'body', 'revision']);
  if (typeof value.kind !== 'string' || !Object.hasOwn(fields, value.kind)) throw new Error('Invalid car recovery operation');
  const kind = value.kind as Kind, creates = kind === 'search' || kind === 'track';
  if (creates ? value.id !== null : typeof value.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value.id)) throw new Error('Invalid car recovery target');
  const revision = value.revision;
  if (['refresh', 'edit', 'delete'].includes(kind) ? !Number.isSafeInteger(revision) || Number(revision) < 0 || Number(revision) > 2147483647 : revision !== null) throw new Error('Invalid car recovery revision');
  let body = value.body === null ? null : object(value.body);
  if (fields[kind].length ? body === null : body !== null) throw new Error('Invalid car recovery payload');
  if (body) {
    exact(body, fields[kind]);
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized, 'utf8') > 64 * 1024) throw new Error('Car recovery payload is too large');
    body = object(JSON.parse(serialized));
    exact(body, fields[kind]);
    const canonical = normalizePayload(body, kind);
    if (normalize) body = canonical;
  }
  return { kind, id: value.id as string | null, body, revision: revision as number | null };
}
function receipt(raw: unknown, normalize = false): CarReceipt {
  const value = object(raw); exact(value, ['version', 'key', 'origin', 'scope', 'createdAt', 'operation']);
  if (value.version !== 1 || typeof value.key !== 'string' || !UUID.test(value.key)
    || typeof value.origin !== 'string' || new CarClient(value.origin).origin !== value.origin
    || typeof value.scope !== 'string' || !/^(?:single|user:[A-Za-z0-9_-]{1,200})$/.test(value.scope)
    || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('Invalid car recovery identity');
  return { version: 1, key: value.key, origin: value.origin, scope: value.scope, createdAt: value.createdAt, operation: operation(value.operation, normalize) };
}
async function privateDescriptor(file: FileHandle, directory: boolean) {
  const stat = await file.stat();
  if (!(directory ? stat.isDirectory() : stat.isFile()) || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) throw new Error('Car recovery storage must be private and owned by the current user');
  return stat;
}
async function directoryHandle(directory: string) {
  const file = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { await privateDescriptor(file, true); return file; }
  catch (error) { await file.close(); throw error; }
}
async function trustedDirectory(directory: string): Promise<string> {
  if (!process.getuid) throw new Error('Private car recovery storage requires POSIX ownership checks');
  const parent = await realpath(dirname(resolve(directory)));
  let ancestor = parent;
  while (true) {
    const file = await open(ancestor, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      const trustedOwner = stat.uid === 0 || stat.uid === process.getuid();
      const stickyRoot = stat.uid === 0 && (stat.mode & 0o1000) !== 0;
      if (!trustedOwner || ((stat.mode & 0o022) !== 0 && !stickyRoot)) throw new Error('Car recovery parent directories must prevent replacement by other users');
    } finally { await file.close(); }
    const next = dirname(ancestor); if (next === ancestor) break;
    ancestor = next;
  }
  return join(parent, basename(resolve(directory)));
}
async function unchanged(directory: string, expected: FileHandle) {
  const current = await directoryHandle(directory);
  try {
    const [before, after] = await Promise.all([expected.stat(), current.stat()]);
    if (before.dev !== after.dev || before.ino !== after.ino) throw new Error('Car recovery directory changed during access');
  } finally { await current.close(); }
}

/** Immutable publication: no server mutation may precede this successful return. */
export async function saveCarReceipt(directory: string, client: CarClient, intent: CarOperation, signal?: AbortSignal, expectedScope?: string): Promise<{ path: string; receipt: CarReceipt }> {
  const session = await client.getSession(signal);
  if (expectedScope !== undefined && session.scope !== expectedScope) throw new CarScopeError();
  const value = receipt({ version: 1, key: randomUUID(), origin: client.origin, scope: session.scope, createdAt: new Date().toISOString(), operation: intent }, true);
  const data = Buffer.from(JSON.stringify(value));
  if (data.length > MAX_BYTES) throw new Error('Car recovery record is too large');
  directory = await trustedDirectory(directory);
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) { if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'EEXIST') throw error; }
  const dir = await directoryHandle(directory), temporary = join(directory, `.pending-${randomUUID()}`), path = join(directory, `${value.key}.json`);
  let created = false;
  try {
    const file = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    created = true;
    try { await privateDescriptor(file, false); await file.writeFile(data); await file.sync(); }
    finally { await file.close(); }
    await unchanged(directory, dir); signal?.throwIfAborted();
    await link(temporary, path);
    await dir.sync(); await unchanged(directory, dir);
    return { path, receipt: value };
  } catch (error) {
    throw new Error(`Car recovery record ${value.key} could not be safely published; no mutation was sent. Inspect ${directory} before retrying.`, { cause: error });
  } finally {
    try { if (created) { await unchanged(directory, dir); await unlink(temporary); await dir.sync(); } }
    finally { await dir.close(); }
  }
}

/** Always reauthenticate before accepting a record for replay; credentials never come from disk. */
export async function readCarReceipt(path: string, client: CarClient, signal?: AbortSignal, expectedScope?: string): Promise<CarReceipt> {
  const session = await client.getSession(signal);
  if (expectedScope !== undefined && session.scope !== expectedScope) throw new CarScopeError();
  path = resolve(path);
  const directory = await trustedDirectory(dirname(path)), dir = await directoryHandle(directory);
  path = join(directory, basename(path));
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
    try {
      const stat = await privateDescriptor(file, false);
      if (stat.size > MAX_BYTES) throw new Error('Car recovery record is too large');
      const bytes = Buffer.alloc(MAX_BYTES + 1); let size = 0;
      while (size < bytes.length) {
        const read = await file.read(bytes, size, bytes.length - size, size);
        if (!read.bytesRead) break;
        size += read.bytesRead;
      }
      if (size > MAX_BYTES) throw new Error('Car recovery record is too large');
      const value = receipt(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))));
      if (basename(path) !== `${value.key}.json` || value.origin !== client.origin || value.scope !== session.scope) throw new Error('Car recovery record belongs to another server, account, or request');
      await unchanged(directory, dir); signal?.throwIfAborted();
      return value;
    } finally { await file.close(); }
  } finally { await dir.close(); }
}

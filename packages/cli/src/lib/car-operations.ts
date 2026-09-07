import { setTimeout as delay } from 'node:timers/promises';
import { CarClient } from './car-client.js';
import { readCarReceipt, saveCarReceipt, type CarOperation, type CarReceipt } from './car-receipts.js';
import { TravelResponseError } from '../../../../apps/web/src/components/travel/client.js';
import { carRecord, carText } from '../../../../apps/web/src/lib/cars/validation.js';
import { validateCarTrackerView } from '../../../../apps/web/src/lib/cars/tracker-view.js';
import { validateCarDetailView } from '../../../../apps/web/src/lib/cars/detail-view.js';
import { carRunIsActive, validateCarRunView } from '../../../../apps/web/src/lib/cars/run-view.js';

const statuses = ['queued', 'running', 'success', 'partial', 'unavailable', 'failed', 'cancelled'];
export class CarMutationError extends Error {
  constructor(message: string, public readonly receiptPath: string, public readonly outcome: 'unconfirmed' | 'removed' | 'inaccessible' | 'stale' | 'rejected', public readonly status?: number, public readonly current?: unknown) {
    super(message); this.name = 'CarMutationError';
  }
}
function acknowledgement(raw: unknown, receipt: CarReceipt) {
  const value = carRecord(raw), { kind, id, revision, body } = receipt.operation;
  if (kind === 'track' || kind === 'edit') {
    const tracker = validateCarTrackerView(value.tracker);
    if (kind === 'track') {
      if (value.creationKey !== receipt.key) throw new Error('Tracker acknowledgement belongs to another request');
      return { tracker, creationKey: receipt.key };
    }
    if (tracker.id !== id || tracker.revision !== revision! + 1) throw new Error('Tracker update acknowledgement has an inconsistent revision');
    for (const [key, expected] of Object.entries(body!)) {
      const actual = ['target', 'notifyLows', 'scrapeInterval'].includes(key) ? tracker.options[key as 'target' | 'notifyLows' | 'scrapeInterval'] : tracker[key as 'active' | 'userId' | 'label'];
      if (key === 'target' && expected !== null) {
        const amount = carRecord(expected), observed = carRecord(actual);
        if (amount.currency !== observed.currency || amount.minor !== observed.minor) throw new Error('Tracker update acknowledgement has different settings');
      } else if (actual !== expected) throw new Error('Tracker update acknowledgement has different settings');
    }
    return { tracker };
  }
  const resultId = carText(value.id, 200, 'rental operation identity');
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(resultId)) throw new Error('Invalid rental operation identity');
  if (kind === 'delete') {
    if (resultId !== id || value.deleted !== true) throw new Error('Deletion acknowledgement belongs to another tracker');
    return { id: resultId, deleted: true };
  }
  if (typeof value.status !== 'string' || !statuses.includes(value.status)) throw new Error('Unknown rental operation status');
  if (kind === 'search' && value.creationKey !== receipt.key) throw new Error('Search acknowledgement belongs to another request');
  if (kind === 'refresh' && (value.refreshKey !== receipt.key || value.trackerId !== id)) throw new Error('Refresh acknowledgement belongs to another request');
  if (kind === 'cancel' && (resultId !== id || ['queued', 'running'].includes(value.status))) throw new Error('Server did not confirm search cancellation or completion');
  return { id: resultId, status: value.status, ...(kind === 'search' ? { creationKey: receipt.key } : {}), ...(kind === 'refresh' ? { trackerId: id, refreshKey: receipt.key } : {}) };
}

/** A retry reads its original identity from disk and never substitutes a new request or revision. */
export async function replayCarMutation(path: string, client: CarClient, signal?: AbortSignal) {
  let receipt: CarReceipt | undefined;
  try {
    receipt = await readCarReceipt(path, client, signal);
    const { kind, id, body, revision } = receipt.operation;
    const endpoint = kind === 'search' ? '/api/cars/search' : kind === 'track' ? '/api/cars' : kind === 'cancel' ? `/api/cars/search/${id}` : `/api/cars/${id}${kind === 'refresh' ? '/scrape' : ''}`;
    const raw = await client.request<unknown>(endpoint, {
      method: kind === 'edit' ? 'PATCH' : kind === 'delete' || kind === 'cancel' ? 'DELETE' : 'POST',
      ...(body === null ? {} : { body }), ...(revision === null ? {} : { revision }), idempotencyKey: receipt.key, signal,
    });
    signal?.throwIfAborted();
    return { receiptPath: path, result: acknowledgement(raw, receipt) };
  } catch (error) {
    const response = error instanceof TravelResponseError ? error : null;
    const status = response?.status, definitive = response?.definitive && !signal?.aborted;
    const outcome = definitive && status === 410 ? 'removed' : [401, 403, 404].includes(status ?? 0) ? 'inaccessible'
      : definitive && status === 412 ? 'stale' : definitive && [400, 409, 413, 415, 428, 429].includes(status ?? 0) ? 'rejected' : 'unconfirmed';
    let current: unknown, reconciliationError = '';
    if (outcome === 'stale' && receipt?.operation.id && receipt.operation.kind !== 'cancel') {
      try { current = validateCarDetailView(await client.request(`/api/cars/${receipt.operation.id}`, { signal }), receipt.operation.id); }
      catch (readError) { reconciliationError = ` Current settings could not be verified: ${readError instanceof Error ? readError.message : String(readError)}.`; }
    }
    const explanation = outcome === 'removed' ? 'The server retained a tombstone; this receipt cannot create a replacement.'
      : outcome === 'inaccessible' ? 'Access is unavailable. This does not confirm deletion; restore the original account access before retrying.'
      : outcome === 'stale' ? 'The revision changed. Review current settings; do not replace the saved revision and replay.'
      : 'The original receipt is retained. Use cars retry with this path to repeat the same request; do not repeat the original command to recover it.';
    throw new CarMutationError(`${error instanceof Error ? error.message : String(error)}. ${explanation}${reconciliationError}`, path, outcome, status, current);
  }
}
export async function performCarMutation(directory: string, client: CarClient, intent: CarOperation, prepared: (path: string) => void, signal?: AbortSignal) {
  const saved = await saveCarReceipt(directory, client, intent, signal);
  prepared(saved.path);
  return replayCarMutation(saved.path, client, signal);
}

/** Polling is read-only. Interrupting it leaves the server job available for results or explicit cancellation. */
export async function waitForCarSearch(client: CarClient, id: string, options: { signal?: AbortSignal; timeoutMs?: number; intervalMs?: number } = {}) {
  const timeoutMs = options.timeoutMs ?? 120 * 60_000, intervalMs = options.intervalMs ?? 2000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120 * 60_000 || !Number.isSafeInteger(intervalMs) || intervalMs < 1 || intervalMs > 30_000) throw new Error('Invalid rental polling limits');
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]);
  try {
    while (true) {
      signal.throwIfAborted();
      const run = validateCarRunView(await client.request(`/api/cars/search/${encodeURIComponent(id)}`, { signal }), id);
      signal.throwIfAborted();
      if (!carRunIsActive(run)) return run;
      await delay(intervalMs, undefined, { signal });
    }
  } catch (error) {
    throw new Error(`Stopped waiting for search ${id}; the server search was not cancelled. Use cars results ${id} or cars cancel ${id}. ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

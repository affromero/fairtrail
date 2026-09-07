export class TravelResponseError extends Error {
  constructor(message: string, public readonly status: number, public readonly definitive = true) { super(message); this.name = 'TravelResponseError'; }
}
export const TRAVEL_ACCESS_LOST_EVENT = 'flight-finder:travel-access-lost';

async function boundedJson(response: Response, limit: number): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing response body');
  const decoder = new TextDecoder(); let text = '', bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        void reader.cancel().catch(() => undefined);
        throw new TravelResponseError('Server response exceeds the permitted size', response.status, false);
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}

/** Shared JSON envelope handling; callers own deadlines and mutation retry policy. */
export async function travelRequest<T>(url: string, init?: RequestInit, limits?: { maxResponseBytes: number }): Promise<T> {
  if (limits && (!Number.isSafeInteger(limits.maxResponseBytes) || limits.maxResponseBytes < 1)) throw new Error('Response size limit must be a positive integer');
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  if (typeof window !== 'undefined' && [401, 403].includes(response.status)) window.dispatchEvent(new Event(TRAVEL_ACCESS_LOST_EVENT));
  let body: unknown;
  try { body = limits ? await boundedJson(response, limits.maxResponseBytes) : await response.json(); }
  catch (error) {
    if (error instanceof TravelResponseError) throw error;
    throw new TravelResponseError('Invalid server response', response.status, false);
  }
  if (!body || typeof body !== 'object' || !('ok' in body)) throw new TravelResponseError('Invalid server response', response.status, false);
  if (body.ok === false && 'error' in body && typeof body.error === 'string') throw new TravelResponseError(body.error, response.status, !response.ok);
  if (!response.ok) throw new TravelResponseError(`HTTP ${response.status}`, response.status, false);
  if (body.ok !== true || !('data' in body)) throw new TravelResponseError('Invalid server response', response.status, false);
  return body.data as T;
}

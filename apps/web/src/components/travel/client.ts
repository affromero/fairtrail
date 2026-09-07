export class TravelResponseError extends Error {
  constructor(message: string, public readonly status: number, public readonly definitive = true) { super(message); this.name = 'TravelResponseError'; }
}
export const TRAVEL_ACCESS_LOST_EVENT = 'flight-finder:travel-access-lost';

/** Shared JSON envelope handling; callers own deadlines and mutation retry policy. */
export async function travelRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  if (typeof window !== 'undefined' && [401, 403].includes(response.status)) window.dispatchEvent(new Event(TRAVEL_ACCESS_LOST_EVENT));
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new TravelResponseError('Invalid server response', response.status, false); }
  if (!body || typeof body !== 'object' || !('ok' in body)) throw new TravelResponseError('Invalid server response', response.status, false);
  if (body.ok === false && 'error' in body && typeof body.error === 'string') throw new TravelResponseError(body.error, response.status, !response.ok);
  if (!response.ok) throw new TravelResponseError(`HTTP ${response.status}`, response.status, false);
  if (body.ok !== true || !('data' in body)) throw new TravelResponseError('Invalid server response', response.status, false);
  return body.data as T;
}

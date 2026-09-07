export class TravelResponseError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = 'TravelResponseError'; }
}

/** Shared JSON envelope handling; callers own deadlines and mutation retry policy. */
export async function travelRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const response = await fetch(url, { ...init, headers });
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('ok' in body)) throw new Error('Invalid server response');
  if (body.ok === false && 'error' in body && typeof body.error === 'string') throw new TravelResponseError(body.error, response.status);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (body.ok !== true || !('data' in body)) throw new Error('Invalid server response');
  return body.data as T;
}

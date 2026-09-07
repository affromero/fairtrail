import { apiError } from '../api-response';
import { TravelJobError } from '../travel/jobs';
import { carActor, type CarActor } from './access';
import { CarError } from './types';
import { carInteger } from './validation';

const MAX_BODY_BYTES = 64 * 1024;

export function carRevisionPrecondition(request: Request): number | undefined {
  const value = request.headers.get('X-Car-Revision');
  if (value === null) return undefined;
  if (!/^(?:0|[1-9]\d{0,9})$/.test(value)) throw new CarError('X-Car-Revision must contain a nonnegative tracker revision');
  return carInteger(Number(value), 0, 2147483647, 'Tracker revision');
}

export async function readCarJson(request: Request): Promise<unknown> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new CarError('Send an application/json request', 415);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) throw new CarError('Rental request is too large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new CarError('Missing JSON request body');
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut = false;
  let cancellation: Promise<void> | null = null;
  let cancellationError: unknown;
  const timer = setTimeout(() => {
    timedOut = true;
    cancellation = reader.cancel().catch(error => { cancellationError = error; });
  }, 5000);
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new CarError('Rental request is too large', 413); }
      chunks.push(chunk.value);
    }
  } finally { clearTimeout(timer); await cancellation; reader.releaseLock(); }
  if (timedOut) throw new CarError('Rental request body timed out; retry', 408, { cause: cancellationError });
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (error) { throw new SyntaxError('Invalid UTF-8 JSON request', { cause: error }); }
  return JSON.parse(text) as unknown;
}

async function endpointResponse(action: (actor: CarActor) => Promise<Response>): Promise<Response> {
  try { return await action(await carActor()); }
  catch (error) {
    if (error instanceof CarError || error instanceof TravelJobError) {
      if (error.status >= 500) console.error('[cars] Request failed:', error);
      return apiError(error.message, error.status);
    }
    if (error instanceof SyntaxError) return apiError('Invalid JSON request', 400);
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') return apiError('Another rental operation is in progress; retry', 409);
    console.error('[cars] Request failed:', error);
    return apiError('Car operation failed; check the server logs and retry', 500);
  }
}

export async function carEndpoint(action: (actor: CarActor) => Promise<Response>): Promise<Response> {
  const response = await endpointResponse(action);
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

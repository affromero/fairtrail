import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCarJson } from './http';

const streamRequest = (body: ReadableStream<Uint8Array>) => new Request('http://localhost/api/cars', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body, duplex: 'half' } as RequestInit);
afterEach(() => vi.useRealTimers());
describe('bounded rental JSON request streams', () => {
  it('decodes UTF-8 split across transport chunks without changing user text', async () => {
    const bytes = new TextEncoder().encode('{"label":"Bogotá"}');
    const stream = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(new Uint8Array([byte])); controller.close(); } });
    expect(await readCarJson(streamRequest(stream))).toEqual({ label: 'Bogotá' });
  });
  it('cancels a stalled body at the deadline and returns a retryable timeout', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    const reading = readCarJson(streamRequest(stream));
    const rejected = expect(reading).rejects.toMatchObject({ status: 408 });
    await vi.advanceTimersByTimeAsync(5001); await rejected;
    expect(cancelled).toBe(true);
  });
  it('rejects invalid UTF-8 instead of silently replacing bytes in submitted fields', async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([0xff])); controller.close(); } });
    await expect(readCarJson(streamRequest(stream))).rejects.toBeInstanceOf(SyntaxError);
  });
});

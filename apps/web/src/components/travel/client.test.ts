import { afterEach, describe, expect, it, vi } from 'vitest';
import { travelRequest } from './client';
import { hotelRequest } from '../hotels/client';

afterEach(() => { vi.unstubAllGlobals(); });
describe.each([{ label: 'travel', request: travelRequest }, { label: 'hotel compatibility', request: hotelRequest }])('$label JSON requests', ({ request }) => {
  it('returns response data and preserves request headers, body and cancellation', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: { id: 'saved-tracker' } })));
    vi.stubGlobal('fetch', fetcher);
    const signal = new AbortController().signal;
    expect(await request('/api/example', { method: 'POST', body: '{}', headers: new Headers({ 'Idempotency-Key': 'request-key' }), signal })).toEqual({ id: 'saved-tracker' });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('/api/example'); expect(init).toMatchObject({ method: 'POST', body: '{}', signal });
    expect(init.headers.get('Content-Type')).toBe('application/json'); expect(init.headers.get('Idempotency-Key')).toBe('request-key');
  });
  it('preserves a structured server rejection message and HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'Quote expired' }), { status: 409 })));
    await expect(request('/api/example')).rejects.toMatchObject({ message: 'Quote expired', status: 409 });
  });
  it.each([null, {}, { ok: true }, { ok: false, error: 42 }, { ok: 'true', data: {} }])('rejects a malformed envelope instead of reporting success: %j', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
    await expect(request('/api/example')).rejects.toThrow(/Invalid server response/);
  });
  it('does not classify an inconsistent error response as a definitive server rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data: {} }), { status: 400 })));
    const error = await request('/api/example').catch((value: unknown) => value);
    expect(error).toMatchObject({ message: 'HTTP 400' });
    expect(error).toMatchObject({ status: 400, definitive: false });
  });
  it.each([401, 403, 404])('preserves HTTP %i when authentication middleware returns HTML', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Access unavailable</html>', { status })));
    await expect(request('/api/example')).rejects.toMatchObject({ status, definitive: false });
  });
});

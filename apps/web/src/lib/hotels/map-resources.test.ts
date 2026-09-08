/** @vitest-environment jsdom */
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_HOTEL_MAP_CONFIG } from './map-config';
import { fetchHotelMapResource, resolveHotelMapDocument } from './map-resources';

const origin = 'https://finder.example';
const base = 'https://tiles.openfreemap.org/styles/liberty';
afterEach(() => vi.unstubAllGlobals());

it('resolves nested map sources, sprites and glyphs against their document', () => {
  const result = resolveHotelMapDocument({ version: 8, sources: { map: { type: 'vector', url: '../planet' } }, sprite: './sprite', glyphs: '/fonts/{fontstack}/{range}.pbf' }, DEFAULT_HOTEL_MAP_CONFIG, origin, base);
  expect(result).toMatchObject({ sources: { map: { url: 'https://tiles.openfreemap.org/planet' } }, sprite: 'https://tiles.openfreemap.org/styles/sprite' });
});

it('blocks unlisted nested resources before requesting them', () => {
  expect(() => resolveHotelMapDocument({ sources: { map: { type: 'vector', tiles: ['https://unlisted.example/{z}/{x}/{y}.pbf'] } } }, DEFAULT_HOTEL_MAP_CONFIG, origin, base)).toThrow(/origin/);
});

it('does not interpret provider attribution as executable HTML', () => {
  const result = resolveHotelMapDocument({ attribution: '<a href="https://example.org">Map contributors</a><img src=x onerror=alert(1)>' }, DEFAULT_HOTEL_MAP_CONFIG, origin, base);
  expect(result).toEqual({ attribution: '<a href="https://example.org/" target="_blank" rel="noopener noreferrer">Map contributors</a>' });
});

it('preserves credit links while removing executable schemes, nested markup and event handlers', () => {
  const result = resolveHotelMapDocument({ attribution: '<script>alert(1)</script><a href="javascript:alert(1)">Unsafe</a> <a href="https://example.org/?a=1&amp;b=2" onclick="alert(1)"><b>© Contributors</b></a>' }, DEFAULT_HOTEL_MAP_CONFIG, origin, base);
  const element = document.createElement('div');
  element.innerHTML = (result as { attribution: string }).attribution;
  expect(element.textContent).toBe('Unsafe © Contributors');
  expect(element.querySelector('script, b, [onclick]')).toBeNull();
  expect([...element.querySelectorAll('a')].map(link => link.href)).toEqual(['https://example.org/?a=1&b=2']);
});

it('omits credentials and referrers and refuses redirects at the HTTP boundary', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ tiles: ['/tiles/{z}/{x}/{y}.pbf'] })));
  vi.stubGlobal('fetch', fetcher);
  const signal = new AbortController().signal;
  const result = await fetchHotelMapResource(base, DEFAULT_HOTEL_MAP_CONFIG, origin, 'json', signal);
  expect(fetcher).toHaveBeenCalledWith(base, { signal: expect.any(AbortSignal), credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  expect(result).toMatchObject({ tiles: ['https://tiles.openfreemap.org/tiles/{z}/{x}/{y}.pbf'] });
});

it('surfaces HTTP failures and oversized resources instead of substituting another provider', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })));
  await expect(fetchHotelMapResource(base, DEFAULT_HOTEL_MAP_CONFIG, origin, 'json', new AbortController().signal)).rejects.toThrow(/503/);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { headers: { 'Content-Length': String(20 * 1024 * 1024) } })));
  await expect(fetchHotelMapResource(base, DEFAULT_HOTEL_MAP_CONFIG, origin, 'json', new AbortController().signal)).rejects.toThrow(/large/);
});

it('cancels chunked downloads when they exceed the limit without buffering the remaining body', async () => {
  let cancelled = false;
  const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); }, cancel() { cancelled = true; } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
  await expect(fetchHotelMapResource(base, DEFAULT_HOTEL_MAP_CONFIG, origin, 'arrayBuffer', new AbortController().signal)).rejects.toThrow(/large/);
  expect(cancelled).toBe(true);
});

it('cancels a stalled response body when its owning map aborts', async () => {
  let cancelled = false;
  const body = new ReadableStream({ cancel() { cancelled = true; } });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
  const controller = new AbortController();
  const pending = fetchHotelMapResource(base, DEFAULT_HOTEL_MAP_CONFIG, origin, 'arrayBuffer', controller.signal);
  const outcome = expect(pending).rejects.toThrow(/cancelled/);
  await Promise.resolve();
  controller.abort(new Error('Map cancelled'));
  await outcome;
  expect(cancelled).toBe(true);
});

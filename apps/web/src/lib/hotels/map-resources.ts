import { hotelMapResourceUrl, type HotelMapConfig } from './map-config';

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeAttribution(value: string): string {
  if (value.length > 16384) throw new Error('Map attribution is too large');
  // Template contents are inert: no scripts, images or frames are activated.
  // Reconstruct only text and credential-free HTTPS links, never provider HTML.
  const template = document.createElement('template');
  template.innerHTML = value;
  const escape = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  let node = walker.nextNode();
  while (node) {
    if (node.nodeType === Node.TEXT_NODE) parts.push(escape(node.textContent ?? ''));
    if (node instanceof Element && node.tagName === 'A') {
      const text = escape(node.textContent ?? '');
      let url: URL | null = null;
      try { url = new URL(node.getAttribute('href') ?? ''); } catch { /* Invalid links remain readable text. */ }
      parts.push(url?.protocol === 'https:' && !url.username && !url.password ? `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text);
      while (node.lastChild) node = node.lastChild;
      walker.currentNode = node;
    } else if (node instanceof Element && ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'TEMPLATE'].includes(node.tagName)) {
      while (node.lastChild) node = node.lastChild;
      walker.currentNode = node;
    }
    node = walker.nextNode();
  }
  return parts.join('');
}

/** Normalize only documented network-bearing fields; never evaluate style data. */
export function resolveHotelMapDocument(value: unknown, config: HotelMapConfig, appOrigin: string, base: string): unknown {
  if (!record(value)) throw new Error('Invalid map document');
  const result = { ...value };
  const resolve = (url: unknown): string => {
    if (typeof url !== 'string') throw new Error('Invalid map resource URL');
    return hotelMapResourceUrl(url, config, appOrigin, base).replace(/%7B([a-zA-Z0-9_-]+)%7D/g, '{$1}');
  };
  if ('url' in result) result.url = resolve(result.url);
  if ('tiles' in result) {
    if (!Array.isArray(result.tiles)) throw new Error('Invalid map tile URLs');
    result.tiles = result.tiles.map(resolve);
  }
  if ('glyphs' in result) result.glyphs = resolve(result.glyphs);
  if ('sprite' in result) {
    result.sprite = Array.isArray(result.sprite) ? result.sprite.map(sprite => {
      if (!record(sprite) || typeof sprite.id !== 'string') throw new Error('Invalid map sprite');
      return { id: sprite.id, url: resolve(sprite.url) };
    }) : resolve(result.sprite);
  }
  if ('sources' in result) {
    if (!record(result.sources)) throw new Error('Invalid map sources');
    result.sources = Object.fromEntries(Object.entries(result.sources).map(([name, source]) => {
      if (!record(source) || !['vector', 'raster', 'raster-dem'].includes(String(source.type))) throw new Error('Base maps must use vector or raster tile sources');
      return [name, resolveHotelMapDocument(source, config, appOrigin, base)];
    }));
  }
  if ('imports' in result) throw new Error('Imported map styles are not supported');
  if (typeof result.attribution === 'string') {
    result.attribution = safeAttribution(result.attribution);
  }
  return result;
}

export async function fetchHotelMapResource(url: string, config: HotelMapConfig, appOrigin: string, type: string | undefined, signal: AbortSignal): Promise<unknown> {
  const target = hotelMapResourceUrl(url, config, appOrigin);
  const boundedSignal = AbortSignal.any([signal, AbortSignal.timeout(15000)]);
  const response = await fetch(target, { signal: boundedSignal, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
  if (!response.ok) throw new Error(`Map resource failed (${response.status})`);
  if (Number(response.headers.get('content-length') ?? 0) > 16 * 1024 * 1024) { await response.body?.cancel(); throw new Error('Map resource is too large'); }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Map resource has no body');
  const chunks: Uint8Array[] = [];
  let length = 0;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  boundedSignal.addEventListener('abort', abort, { once: true });
  if (boundedSignal.aborted) abort();
  try {
    for (;;) {
      boundedSignal.throwIfAborted();
      const chunk = await reader.read();
      boundedSignal.throwIfAborted();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 16 * 1024 * 1024) { await reader.cancel(); throw new Error('Map resource is too large'); }
      chunks.push(chunk.value);
    }
  } finally { boundedSignal.removeEventListener('abort', abort); reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const data = bytes.buffer;
  if (type === 'json') return resolveHotelMapDocument(JSON.parse(new TextDecoder().decode(data)) as unknown, config, appOrigin, target);
  if (type === 'arrayBuffer' || type === 'image') return data;
  return new TextDecoder().decode(data);
}

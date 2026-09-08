import { carRecord } from './validation';
import { CarError } from './types';

interface RenderedRecord { kind: 'text' | 'model' | 'unsupported'; value: unknown }

/** React Flight T rows count UTF-8 bytes; their contents may contain newlines. */
function framedRecords(fragments: string[]): Map<string, RenderedRecord> {
  const bytes = Buffer.from(fragments.join(''), 'utf8'), records = new Map<string, RenderedRecord>();
  if (bytes.length > 4_000_000) throw new CarError('Rendered rental quote exceeds the capture limit');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let offset = 0, count = 0;
  while (offset < bytes.length) {
    if (++count > 20000) throw new CarError('Rendered rental record count exceeds the capture limit');
    if (bytes[offset] === 10) { offset++; continue; }
    const colon = bytes.indexOf(58, offset), rawId = bytes.subarray(offset, colon).toString('utf8');
    if (colon < offset || colon - offset > 8 || !/^[0-9a-f]*$/.test(rawId)) throw new CarError('Invalid rendered rental record framing');
    const id = Number.parseInt(rawId || '0', 16).toString(16);
    offset = colon + 1;
    const tag = String.fromCharCode(bytes[offset] ?? 0);
    let record: RenderedRecord | undefined;
    if ('TAOobUSsLlGgMmV'.includes(tag)) {
      const comma = bytes.indexOf(44, offset), length = bytes.subarray(offset + 1, comma).toString('utf8');
      if (comma < offset || comma - offset > 9 || !/^[0-9a-f]{1,8}$/.test(length)) throw new CarError('Invalid rendered rental text length');
      const end = comma + 1 + Number.parseInt(length, 16);
      if (end > bytes.length) throw new CarError('Truncated rendered rental text');
      record = tag === 'T' ? { kind: 'text', value: decoder.decode(bytes.subarray(comma + 1, end)) } : { kind: 'unsupported', value: null };
      offset = end;
    } else {
      const end = bytes.indexOf(10, offset);
      if (end < 0) throw new CarError('Truncated rendered rental record');
      const payload = decoder.decode(bytes.subarray(offset, end));
      offset = end + 1;
      // Hints/debug rows and stream terminators do not define plain data identities.
      if ('HNDJWC'.includes(tag)) continue;
      record = { kind: 'unsupported', value: null };
      if (!'IERrXx'.includes(tag)) {
        if (!'[{"tfn0123456789-'.includes(tag)) throw new CarError('Unsupported rendered rental record tag');
        try { record = { kind: 'model', value: JSON.parse(payload) }; }
        catch { /* Reserve malformed data identities so later records cannot replace them. */ }
      }
    }
    if (!record) continue;
    if (records.has(id)) throw new CarError('Provider rendered conflicting duplicate record identities');
    records.set(id, record);
  }
  return records;
}

/** Resolve plain quote data only. Never load modules, call functions or evaluate code. */
function resolveQuote(raw: Record<string, unknown>, records: Map<string, RenderedRecord>): Record<string, unknown> {
  let nodes = 0, bytes = 0;
  const text = (value: string) => {
    bytes += Buffer.byteLength(value, 'utf8');
    if (bytes > 1_000_000) throw new CarError('Expanded rental text exceeds the capture limit');
    return value;
  };
  const resolve = (value: unknown, path: Set<string>, depth: number): unknown => {
    if (++nodes > 50000 || depth > 30) throw new CarError('Expanded rental data exceeds the capture limit');
    if (typeof value === 'string') {
      if (value.startsWith('$$')) return text(value.slice(1));
      if (!value.startsWith('$')) return text(value);
      if (!/^\$[0-9a-f]{1,8}$/.test(value)) throw new CarError('Unsupported rendered rental data reference');
      const id = Number.parseInt(value.slice(1), 16).toString(16), record = records.get(id);
      if (!record || path.has(id)) throw new CarError('Missing or cyclic rendered rental data reference');
      if (record.kind === 'unsupported') throw new CarError('Unsupported rendered rental data reference');
      if (record.kind === 'text') return text(record.value as string);
      return resolve(record.value, new Set([...path, id]), depth + 1);
    }
    if (Array.isArray(value)) return value.map(item => resolve(item, path, depth + 1));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [text(key), resolve(item, path, depth + 1)]));
  };
  return carRecord(resolve(raw, new Set(), 0));
}

export function discoverCarsOfferFromScripts(scripts: string[], offerId: string): Record<string, unknown> {
  if (scripts.length > 1000 || scripts.reduce((size, script) => size + script.length, 0) > 5_000_000) throw new CarError('Rendered rental page exceeds the capture limit');
  const chunks: unknown[] = [];
  for (const script of scripts) {
    const match = script.trim().match(/^self\.__next_f\.push\((\[[\s\S]*\])\);?$/);
    if (!match) continue;
    try { chunks.push(JSON.parse(match[1]!)); } catch { /* Non-JSON scripts are not quote data. */ }
  }
  return discoverCarsRenderedOffer(chunks, offerId);
}

/** Reads JSON records rendered by the provider; never evaluates provider JavaScript. */
export function discoverCarsRenderedOffer(chunks: unknown, offerId: string): Record<string, unknown> {
  if (!Array.isArray(chunks) || chunks.length > 1000) throw new CarError('Missing rendered rental quote');
  const fragments = chunks.filter((entry): entry is [number, string] => Array.isArray(entry) && entry[0] === 1 && typeof entry[1] === 'string').map(entry => entry[1]);
  if (fragments.reduce((size, fragment) => size + fragment.length, 0) > 4_000_000) throw new CarError('Rendered rental quote exceeds the capture limit');
  const records = framedRecords(fragments);
  let match: Record<string, unknown> | undefined;
  let visited = 0;
  const visit = (value: unknown, depth: number): void => {
    if (++visited > 100000 || depth > 30) throw new CarError('Rendered rental data exceeds the capture limit');
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, depth + 1)); return; }
    const record = carRecord(value);
    if (record.offerId === offerId && record.vehicle && record.priceObject) {
      if (match && JSON.stringify(match) !== JSON.stringify(record)) throw new CarError('Provider rendered conflicting rental quotes');
      match = record;
      return;
    }
    Object.values(record).forEach(item => visit(item, depth + 1));
  };
  for (const record of records.values()) if (record.kind === 'model') visit(record.value, 0);
  if (!match) throw new CarError('Provider did not render the selected rental quote');
  const keys = ['offerId', 'rentalPeriod', 'showFreeCancellation', 'vehicle', 'includedOptions', 'supplier', 'extras', 'pickup', 'dropoff', 'pickupClosingInfo', 'needToKnow', 'deposit', 'coverage', 'priceObject'];
  return resolveQuote(Object.fromEntries(keys.filter(key => Object.hasOwn(match!, key)).map(key => [key, match![key]])), records);
}

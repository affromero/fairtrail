import { carRecord } from './validation';
import { CarError } from './types';

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
  let match: Record<string, unknown> | undefined;
  const visit = (value: unknown, depth: number): void => {
    if (depth > 30 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) { value.forEach(item => visit(item, depth + 1)); return; }
    const record = carRecord(value);
    if (record.offerId === offerId && record.vehicle && record.priceObject) {
      if (match && JSON.stringify(match) !== JSON.stringify(record)) throw new CarError('Provider rendered conflicting rental quotes');
      match = record;
      return;
    }
    Object.values(record).forEach(item => visit(item, depth + 1));
  };
  for (const line of fragments.join('').split('\n')) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    let record: unknown;
    try { record = JSON.parse(line.slice(separator + 1)); } catch { continue; }
    visit(record, 0);
  }
  if (!match) throw new CarError('Provider did not render the selected rental quote');
  const keys = ['offerId', 'rentalPeriod', 'showFreeCancellation', 'vehicle', 'includedOptions', 'supplier', 'extras', 'pickup', 'dropoff', 'pickupClosingInfo', 'needToKnow', 'deposit', 'coverage', 'priceObject'];
  return Object.fromEntries(keys.map(key => [key, match![key]]));
}

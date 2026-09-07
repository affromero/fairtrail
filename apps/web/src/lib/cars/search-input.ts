import { createHash } from 'node:crypto';
import { getCarCatalogPlace } from './locations';
import { carRecord, carText, validateCarSearch } from './validation';
import { validateCarCreationKey } from './creation-input';
import { CarError, type CarLocation } from './types';
import type { CarActor } from './access';

async function location(raw: unknown): Promise<CarLocation> {
  const input = carRecord(raw);
  if (Object.keys(input).some(key => !['id', 'version'].includes(key))) throw new CarError('Select a catalog location; provider identifiers and geography are server-managed');
  const place = await getCarCatalogPlace(carText(input.id, 80, 'location identity'), carText(input.version, 64, 'location version'));
  return { name: place.name, country: place.country, timeZone: place.timeZone, catalog: { id: place.id, version: place.version }, providerIds: {}, providerNames: {} };
}

/** Public requests contain intent, never trusted provider or timezone metadata. */
export function carSearchReceipt(raw: unknown, actor: CarActor, requestKey: unknown) {
  const key = validateCarCreationKey(requestKey);
  const canonical = (value: unknown, depth = 0): unknown => {
    if (depth > 10) throw new CarError('Rental request is nested too deeply');
    if (Array.isArray(value)) return value.map(item => canonical(item, depth + 1));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item, depth + 1)]));
    return value;
  };
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return { id: hash(['car-search-v1', actor.userId, key]), requestHash: hash(canonical(raw)) };
}

export async function carSearchIntent(raw: unknown) {
  const input = carRecord(raw);
  const allowed = ['pickup', 'dropoff', 'pickupAt', 'dropoffAt', 'driver', 'currency', 'sources', 'extras', 'filters'];
  if (Object.keys(input).some(field => !allowed.includes(field))) throw new CarError('Unsupported rental search field');
  for (const rawTime of [input.pickupAt, input.dropoffAt]) {
    if (Object.keys(carRecord(rawTime)).some(field => !['date', 'time'].includes(field))) throw new CarError('Enter date and local time; the station timezone is server-managed');
  }
  const pickup = await location(input.pickup), dropoff = await location(input.dropoff);
  const search = validateCarSearch({ ...input, pickup, dropoff }, new Date(), { allowUnresolvedProviders: true });
  // Protection products must first be observed at the provider, not invented by a client.
  if (search.extras.protection.length) throw new CarError('Protection is selected from verified provider products, not free-text product identifiers');
  return search;
}

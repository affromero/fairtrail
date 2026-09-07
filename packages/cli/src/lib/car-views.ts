import { CarClient } from './car-client.js';
import { carRecord, carText } from '../../../../apps/web/src/lib/cars/validation.js';
import { validateCarTrackerView } from '../../../../apps/web/src/lib/cars/tracker-view.js';
import { validateCarRunSummary } from '../../../../apps/web/src/lib/cars/run-view.js';

function cursor(raw: unknown): string | null {
  if (raw === null) return null;
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{1,1500}$/.test(raw)) throw new Error('Invalid rental page cursor');
  return raw;
}
function page<T extends { id: string }>(raw: unknown, key: string, parse: (value: unknown) => T, previous: string | null) {
  const value = carRecord(raw), rows = value[key], nextCursor = cursor(value.nextCursor);
  if (!Array.isArray(rows) || rows.length > 25) throw new Error('Invalid rental page');
  const records = rows.map(parse);
  if (new Set(records.map(row => row.id)).size !== records.length || nextCursor && (!records.length || nextCursor === previous)) throw new Error('Rental page did not advance');
  return { records, nextCursor };
}
export async function readCarTrackerPage(client: CarClient, position: string | null = null, admin = false, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (position !== null) params.set('cursor', cursor(position)!);
  if (admin) params.set('admin', 'true');
  const result = page(await client.request(`/api/cars?${params}`, { signal }), 'trackers', validateCarTrackerView, position);
  return { trackers: result.records, nextCursor: result.nextCursor };
}
export async function readCarSearchPage(client: CarClient, position: string | null = null, signal?: AbortSignal) {
  if (position !== null) cursor(position);
  const result = page(await client.request(`/api/cars/search${position ? `?cursor=${position}` : ''}`, { signal }), 'searches', raw => {
    const value = carRecord(raw), row = validateCarRunSummary(value);
    if (row.trackerId !== null) throw new Error('Standalone search list contains a tracker check');
    return { ...row, label: carText(value.label, 503, 'rental label') };
  }, position);
  return { searches: result.records, nextCursor: result.nextCursor };
}

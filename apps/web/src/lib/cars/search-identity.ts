import type { CarLocation, CarSearch } from './types';

/** Provider metadata is resolved asynchronously; catalog intent is immutable. */
export function carSearchIdentity(search: CarSearch): string {
  const location = (value: CarLocation) => value.catalog
    ? { name: value.name, country: value.country, timeZone: value.timeZone, catalog: value.catalog }
    : value;
  return JSON.stringify({ ...search, pickup: location(search.pickup), dropoff: location(search.dropoff) });
}

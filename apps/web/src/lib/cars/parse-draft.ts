import { Temporal } from '@js-temporal/polyfill';
import { carInteger, carRecord, carText, validateCarCountry, validateCarExtras } from './validation';
import { currencyPrecision, validateCarMoney } from './money';
import { validateCarProviders } from './preferences';
import { CarError, type CarExtras, type CarMoney, type CarSource } from './types';

export interface CarDriverDraft { age: number | null; licenceYears: number | null; residenceCountry: string | null }
export interface CarParseDraft {
  pickupQuery: string | null; dropoffQuery: string | null; sameLocation: boolean | null;
  pickupAt: { date: string | null; time: string | null }; dropoffAt: { date: string | null; time: string | null };
  driver: CarDriverDraft; currency: string | null; sources: CarSource[] | null;
  childSeats: CarExtras['childSeats'] | null; additionalDrivers: CarDriverDraft[] | null;
  filters: { transmission: 'any' | 'automatic' | 'manual' | null; minSeats: number | null; unlimitedMileage: boolean | null; freeCancellation: boolean | null; maxTotal: CarMoney | null };
  warnings: string[];
}
const optional = <T>(raw: unknown, parse: (value: unknown) => T): T | null => raw === null || raw === undefined ? null : parse(raw);
function record(raw: unknown, keys: string[]) {
  const value = carRecord(raw ?? {});
  if (Object.keys(value).some(key => !keys.includes(key))) throw new CarError('AI draft contains unsupported fields');
  return value;
}
function boolean(raw: unknown): boolean {
  if (typeof raw !== 'boolean') throw new CarError('Invalid draft checkbox');
  return raw;
}
function driver(raw: unknown): CarDriverDraft {
  const value = record(raw, ['age', 'licenceYears', 'residenceCountry']);
  const age = optional(value.age, value => carInteger(value, 18, 99, 'Driver age'));
  return { age, licenceYears: optional(value.licenceYears, value => carInteger(value, 0, age === null ? 83 : age - 16, 'Licence years')), residenceCountry: optional(value.residenceCountry, validateCarCountry) };
}
function dateTime(raw: unknown) {
  const value = record(raw, ['date', 'time']);
  return {
    date: optional(value.date, raw => {
      const text = carText(raw, 10, 'draft date');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new CarError('Use a complete calendar date');
      try { return Temporal.PlainDate.from(text, { overflow: 'reject' }).toString(); }
      catch { throw new CarError('Invalid draft date'); }
    }),
    time: optional(value.time, raw => {
      const text = carText(raw, 5, 'draft time');
      if (!/^(?:[01]\d|2[0-3]):(?:00|30)$/.test(text)) throw new CarError('Choose a supported half-hour pickup or return time');
      return text;
    }),
  };
}

/** A suggestion can be incomplete. It never carries trusted provider geography. */
export function validateCarParseDraft(raw: unknown): CarParseDraft {
  const value = record(raw, ['pickupQuery', 'dropoffQuery', 'sameLocation', 'pickupAt', 'dropoffAt', 'driver', 'currency', 'sources', 'childSeats', 'additionalDrivers', 'filters', 'warnings']);
  const filters = record(value.filters, ['transmission', 'minSeats', 'unlimitedMileage', 'freeCancellation', 'maxTotal']);
  const currency = optional(value.currency, raw => { const code = carText(raw, 3, 'draft currency').toUpperCase(); currencyPrecision(code); return code; });
  const warnings = value.warnings ?? [];
  if (!Array.isArray(warnings) || warnings.length > 12) throw new CarError('Too many draft warnings');
  const transmission = optional(filters.transmission, raw => {
    if (raw !== 'any' && raw !== 'automatic' && raw !== 'manual') throw new CarError('Invalid draft transmission');
    return raw;
  });
  return {
    pickupQuery: optional(value.pickupQuery, raw => carText(raw, 100, 'pickup query')), dropoffQuery: optional(value.dropoffQuery, raw => carText(raw, 100, 'return query')), sameLocation: optional(value.sameLocation, boolean),
    pickupAt: dateTime(value.pickupAt), dropoffAt: dateTime(value.dropoffAt), driver: driver(value.driver), currency,
    sources: optional(value.sources, validateCarProviders),
    childSeats: optional(value.childSeats, raw => validateCarExtras({ childSeats: raw }).childSeats),
    additionalDrivers: optional(value.additionalDrivers, raw => {
      if (!Array.isArray(raw) || raw.length > 4) throw new CarError('Choose up to four additional drivers');
      return raw.map(driver);
    }),
    filters: { transmission, minSeats: optional(filters.minSeats, raw => carInteger(raw, 2, 9, 'Minimum seats')), unlimitedMileage: optional(filters.unlimitedMileage, boolean), freeCancellation: optional(filters.freeCancellation, boolean), maxTotal: optional(filters.maxTotal, raw => validateCarMoney(raw, currency ?? undefined)) },
    warnings: warnings.map(raw => carText(raw, 500, 'draft warning')),
  };
}

import { describe, expect, it } from 'vitest';
import { resolveCarLocalTime, validateCarExtras, validateCarFilters, validateCarLocalDateTime, validateCarOptions, validateCarSearch } from './validation';

const now = new Date('2026-09-01T00:00:00Z');
const location = { name: 'London Heathrow Airport', country: 'GB', timeZone: 'Europe/London', providerIds: { discovercars: '1712', autoeurope: '547' } };
const request = () => ({
  pickup: location, dropoff: location,
  pickupAt: { date: '2026-10-15', time: '11:00' },
  dropoffAt: { date: '2026-10-18', time: '11:00' },
  driver: { age: 35, licenceYears: 10, residenceCountry: 'US' },
  currency: 'USD', sources: ['autoeurope', 'discovercars'],
});

describe('rental search validation', () => {
  it('validates local syntax independently of station DST and current eligibility for durable replay', () => {
    expect(validateCarLocalDateTime({ date: '2000-01-01', time: '01:30' })).toEqual({ date: '2000-01-01', time: '01:30' });
    expect(validateCarLocalDateTime({ date: '2026-10-25', time: '01:30' })).toEqual({ date: '2026-10-25', time: '01:30' });
    expect(() => resolveCarLocalTime({ date: '2026-10-25', time: '01:30' }, 'Europe/London')).toThrow(/ambiguous/);
  });
  it('uses the same filter defaults and currency rules before and after catalog resolution', () => {
    const filters = { transmission: 'automatic', maxTotal: { currency: 'USD', minor: 12500 } };
    expect(validateCarSearch({ ...request(), filters }, now).filters).toEqual(validateCarFilters(filters, 'USD'));
    expect(() => validateCarFilters(filters, 'GBP')).toThrow(/currencies/);
  });
  it('keeps distinct provider labels bound to the same selected location IDs', () => {
    const providerNames = { discovercars: 'London Airport Heathrow (LHR)', autoeurope: 'London Heathrow Airport' };
    const result = validateCarSearch({ ...request(), pickup: { ...location, providerNames } }, now);
    expect(result.pickup).toMatchObject({ providerIds: location.providerIds, providerNames });
    expect(() => validateCarSearch({ ...request(), pickup: { ...location, providerNames: { discovercars: 'x'.repeat(251) } } }, now)).toThrow(/location name/);
  });
  it('preserves provider preference order and resolves station-local time without trusting a supplied instant', () => {
    const search = validateCarSearch({ ...request(), pickupAt: { ...request().pickupAt, instant: '2000-01-01T00:00:00Z' } }, now);
    expect(search.sources).toEqual(['autoeurope', 'discovercars']);
    expect(search.pickupAt).toEqual({ date: '2026-10-15', time: '11:00', timeZone: 'Europe/London', instant: '2026-10-15T10:00:00Z' });
    expect(search.extras).toEqual({ childSeats: [], additionalDrivers: [], protection: [] });
  });
  it.each([
    ['2026-03-29', '01:30', 'Europe/London'],
    ['2026-10-25', '01:30', 'Europe/London'],
    ['2026-04-05', '01:45', 'Australia/Lord_Howe'],
    ['2026-10-04', '02:15', 'Australia/Lord_Howe'],
    ['2026-02-30', '12:00', 'Europe/London'],
    ['2026-10-15', '24:00', 'Europe/London'],
    ['2026-10-15', '11:00', '+01:00'],
    ['2026-10-15', '11:00', 'Not/AZone'],
  ])('rejects invalid or ambiguous pickup time %s %s in %s', (date, time, timeZone) => {
    expect(() => resolveCarLocalTime({ date, time, timeZone })).toThrow();
  });
  it('retains local times across a DST change without assuming 24-hour billing days', () => {
    const search = validateCarSearch({ ...request(), pickupAt: { date: '2026-10-24', time: '11:00' }, dropoffAt: { date: '2026-10-25', time: '11:00' } }, now);
    expect(search.pickupAt.instant).toBe('2026-10-24T10:00:00Z');
    expect(search.dropoffAt.instant).toBe('2026-10-25T11:00:00Z');
  });
  it('accepts an earlier-looking return clock time when the return instant is later in another zone', () => {
    const search = validateCarSearch({ ...request(),
      pickup: { ...location, timeZone: 'Europe/Paris' },
      pickupAt: { date: '2026-10-15', time: '11:00' },
      dropoffAt: { date: '2026-10-15', time: '10:30' },
    }, now);
    expect(search.pickupAt.instant).toBe('2026-10-15T09:00:00Z');
    expect(search.dropoffAt.instant).toBe('2026-10-15T09:30:00Z');
  });
  it('rejects a client timezone that differs from the selected station', () => {
    expect(() => validateCarSearch({ ...request(), pickupAt: { ...request().pickupAt, timeZone: 'America/New_York' } }, now)).toThrow(/station timezone/);
  });
  it.each([
    { currency: 'ZZZ' },
    { sources: [] },
    { sources: null },
    { sources: 'autoeurope' },
    { sources: ['discovercars', 'discovercars'] },
    { sources: ['unverified'] },
    { pickup: { ...location, providerIds: { discovercars: '1712' } } },
    { driver: { age: 17, licenceYears: 1, residenceCountry: 'US' } },
    { driver: { age: 23, licenceYears: 30, residenceCountry: 'US' } },
    { driver: { age: 35, licenceYears: 5, residenceCountry: 'ZZ' } },
    { filters: { unlimitedMileage: 'false' } },
    { filters: { maxTotal: { currency: 'GBP', minor: 5000 } } },
    { pickupAt: { date: '2026-08-01', time: '11:00' } },
    { dropoffAt: { date: '2026-10-14', time: '11:00' } },
  ])('rejects invalid rental criteria %j', (invalid) => {
    expect(() => validateCarSearch({ ...request(), ...invalid }, now)).toThrow();
  });
  it('requires a selected protection product for each enabled provider', () => {
    expect(() => validateCarSearch({ ...request(), extras: { protection: [{ source: 'discovercars', productId: 'full-coverage' }] } }, now)).toThrow(/every selected provider/);
  });
});

describe('requested extras and tracking options', () => {
  it('retains seat categories, quantities and each additional driver eligibility context', () => {
    const extras = { childSeats: [{ category: 'infant', quantity: 1 }, { category: 'booster', quantity: 2 }], additionalDrivers: [{ age: 23, licenceYears: 2, residenceCountry: 'GB' }], protection: [{ source: 'discovercars', productId: 'full-coverage' }] };
    expect(validateCarExtras(extras)).toEqual(extras);
  });
  it.each([
    { childSeats: [{ category: 'infant', quantity: 1 }, { category: 'infant', quantity: 2 }] },
    { childSeats: [{ category: 'child', quantity: 5 }] },
    { childSeats: [{ category: 'child', quantity: 2.5 }] },
    { childSeats: [{ category: 'unknown', quantity: 1 }] },
    { additionalDrivers: [{ age: 23, residenceCountry: 'GB' }] },
    { protection: [{ source: 'discovercars', productId: 'a' }, { source: 'discovercars', productId: 'b' }] },
  ])('rejects incomplete, duplicate or impossible extras %j', (extras) => {
    expect(() => validateCarExtras(extras)).toThrow();
  });
  it('keeps car alert targets currency-specific and checks intervals independently', () => {
    expect(validateCarOptions({ target: { currency: 'JPY', minor: 15000 }, scrapeInterval: 6 }, 'JPY')).toEqual({ target: { currency: 'JPY', minor: 15000 }, scrapeInterval: 6, mode: 'best', notifyLows: true });
    expect(() => validateCarOptions({ target: { currency: 'USD', minor: 15000 } }, 'JPY')).toThrow(/currencies/);
    expect(() => validateCarOptions({ scrapeInterval: 0 }, 'USD')).toThrow(/interval/);
  });
});

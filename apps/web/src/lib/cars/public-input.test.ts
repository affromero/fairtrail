import { describe, expect, it } from 'vitest';
import { normalizeCarSearchInput } from './public-input';

const input = () => ({
  pickup: { id: 'ourairports:1', version: 'a'.repeat(64) }, dropoff: { id: 'geonames:2', version: 'a'.repeat(64) },
  pickupAt: { date: '2026-10-25', time: '01:30' }, dropoffAt: { date: '2026-10-25', time: '01:00' },
  driver: { age: 30, licenceYears: 10, residenceCountry: 'us' }, currency: 'usd', sources: ['autoeurope', 'discovercars'],
});
describe('public rental input shared by HTTP and durable CLI requests', () => {
  it('normalizes preferences and budgets without inventing location geography or comparing local clocks', () => {
    const result = normalizeCarSearchInput({ ...input(), filters: { maxTotal: { currency: 'USD', minor: 20000 } } });
    expect(result).toEqual({ ...input(), driver: { age: 30, licenceYears: 10, residenceCountry: 'US' }, currency: 'USD',
      extras: { childSeats: [], additionalDrivers: [], protection: [] },
      filters: { transmission: 'any', minSeats: 4, unlimitedMileage: false, freeCancellation: false, maxTotal: { currency: 'USD', minor: 20000 } },
    });
  });
  it.each([
    { currency: 'ZZZ' }, { sources: ['discovercars', 'discovercars'] },
    { pickup: { id: 'untrusted:1', version: 'a'.repeat(64) } },
    { pickupAt: { date: '2026-02-30', time: '10:00' } },
    { dropoffAt: { date: '2026-10-25', time: '24:00' } },
    { driver: { age: 30, licenceYears: 40, residenceCountry: 'US' } },
    { driver: { age: 30, licenceYears: 10, residenceCountry: 'US', cookie: 'secret' } },
    { filters: { maxTotal: { currency: 'GBP', minor: 200 } } },
    { filters: { maxTotal: { currency: 'USD', minor: 200, cookie: 'secret' } } },
    { extras: { additionalDrivers: [{ age: 30, licenceYears: 10, residenceCountry: 'US', cookie: 'secret' }] } },
  ])('rejects malformed or credential-bearing rental input %j', invalid => {
    expect(() => normalizeCarSearchInput({ ...input(), ...invalid })).toThrow();
  });
});

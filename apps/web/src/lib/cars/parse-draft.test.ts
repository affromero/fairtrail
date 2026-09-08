import { describe, expect, it } from 'vitest';
import { validateCarParseDraft } from './parse-draft';

describe('editable car draft validation', () => {
  it('keeps missing driver facts and additional driver rows unknown', () => {
    const draft = validateCarParseDraft({ pickupQuery: 'London', additionalDrivers: [{}, null] });
    expect(draft.pickupQuery).toBe('London');
    expect(draft.driver).toEqual({ age: null, licenceYears: null, residenceCountry: null });
    expect(draft.additionalDrivers).toEqual([draft.driver, draft.driver]);
    expect(draft.sameLocation).toBeNull();
    expect(draft.currency).toBeNull();
    expect(draft.sources).toBeNull();
    expect(draft.pickupAt).toEqual({ date: null, time: null });
  });

  it('preserves explicit false filters, zero licence tenure, budgets and warnings', () => {
    const draft = validateCarParseDraft({
      sameLocation: false, currency: 'JPY', driver: { age: 18, licenceYears: 0, residenceCountry: 'GB' },
      pickupAt: { date: '2028-02-29', time: '23:30' },
      filters: { freeCancellation: false, maxTotal: { currency: 'JPY', minor: 5000 } },
      warnings: ['Confirm cross-border permission with the supplier.'],
    });
    expect(draft.sameLocation).toBe(false);
    expect(draft.driver.licenceYears).toBe(0);
    expect(draft.pickupAt).toEqual({ date: '2028-02-29', time: '23:30' });
    expect(draft.filters.freeCancellation).toBe(false);
    expect(draft.filters.maxTotal).toEqual({ currency: 'JPY', minor: 5000 });
    expect(draft.warnings[0]).toContain('cross-border');
  });

  it.each([
    { pickupAt: { date: '2027-02-29' } },
    { pickupAt: { time: '12:15' } },
    { driver: { age: 18, licenceYears: 10 } },
    { driver: { residenceCountry: 'XX' } },
    { pickupQuery: { id: 'provider-invented' } },
    { timezone: 'Europe/London' },
    { driver: { nationality: 'GB' } },
    { sources: ['untrusted-provider'] },
    { additionalDrivers: [{}, {}, {}, {}, {}] },
    { currency: 'GBP', filters: { maxTotal: { currency: 'EUR', minor: 10000 } } },
    { filters: { unlimitedMileage: 'false' } },
  ])('rejects invalid or unsupported draft facts: %j', raw => {
    expect(() => validateCarParseDraft(raw)).toThrow();
  });
});

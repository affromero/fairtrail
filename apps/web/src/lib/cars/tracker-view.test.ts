import { describe, expect, it } from 'vitest';
import { carTrackerViewFixture } from '@/test/car-fixtures';
import { validateCarTrackerView } from './tracker-view';
import { validateCarSelection } from './identity';
import { CarError } from './types';

describe('serialized rental tracker validation', () => {
  it('preserves safe integer prices and station-local search settings', () => {
    const row = carTrackerViewFixture(); row.latestPriceMinor = Number.MAX_SAFE_INTEGER;
    expect(validateCarTrackerView(row)).toMatchObject({ latestPriceMinor: Number.MAX_SAFE_INTEGER, options: { mode: 'best', scrapeInterval: 3 }, search: { pickup: { timeZone: 'Europe/London' } } });
  });
  it('accepts an unsampled tracker with a future scheduled check without inventing a price', () => {
    const row = { ...carTrackerViewFixture(), latestPriceMinor: null, historicalLowMinor: null, lastCheckedAt: null, nextCheckAt: new Date(Date.now() + 86_400_000).toISOString() };
    expect(validateCarTrackerView(row)).toMatchObject({ latestPriceMinor: null, historicalLowMinor: null, lastCheckedAt: null });
  });
  it('preserves generated labels containing both maximum-length location names', () => {
    const row = carTrackerViewFixture(); row.label = `${'A'.repeat(250)} → ${'B'.repeat(250)}`;
    expect(validateCarTrackerView(row).label).toBe(row.label);
  });
  it.each([
    { latestPriceMinor: Number.MAX_SAFE_INTEGER + 1 }, { latestPriceMinor: -1 }, { latestPriceMinor: '10000' },
    { historicalLowMinor: 1.5 }, { revision: -1 }, { active: 'false' }, { currency: 'USD' },
    { createdAt: '2026-02-30T00:00:00Z' }, { updatedAt: '2020-01-01T00:00:00.000Z' },
    { lastCheckedAt: '2099-01-01T00:00:00.000Z' }, { nextCheckAt: 'tomorrow' },
    { options: {} },
  ])('rejects malformed tracker state: %j', change => {
    expect(() => validateCarTrackerView({ ...carTrackerViewFixture(), ...change })).toThrow(CarError);
  });
  it('requires exact tracking to name a selected provider and a complete contract hash', () => {
    const row = carTrackerViewFixture(), options = { ...row.options, mode: 'contract' };
    expect(() => validateCarTrackerView({ ...row, options })).toThrow(CarError);
    const selection = { source: 'discovercars', contractHash: 'a'.repeat(64) };
    expect(validateCarTrackerView({ ...row, options, selection }).selection).toEqual(selection);
    expect(() => validateCarTrackerView({ ...row, selection })).toThrow(CarError);
    expect(() => validateCarTrackerView({ ...row, options, selection, search: { ...row.search, sources: ['autoeurope'] } })).toThrow(CarError);
    expect(() => validateCarSelection({ ...selection, contractHash: `${selection.contractHash}junk` })).toThrow(CarError);
  });
});

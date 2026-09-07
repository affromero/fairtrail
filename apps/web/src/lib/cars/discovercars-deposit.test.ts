import { describe, expect, it } from 'vitest';
import { discoverCarsFixedDeposit } from './discovercars-deposit';

describe('supplier deposit disclosure', () => {
  it.each([[], undefined, null, {}, { type: 'fixed', amount: 950 }, { type: 'range', amount: 950, currency: 'USD' }, { type: 'fixed', amount: -1, currency: 'USD' }])('keeps missing or malformed deposits unknown: %j', raw => {
    expect(discoverCarsFixedDeposit(raw)).toBeNull();
  });
  it.each([0, 950])('preserves an explicitly disclosed fixed deposit of %s', amount => {
    expect(discoverCarsFixedDeposit({ type: 'fixed', amount, currency: 'USD' })).toEqual({ minor: amount * 100, currency: 'USD' });
  });
});

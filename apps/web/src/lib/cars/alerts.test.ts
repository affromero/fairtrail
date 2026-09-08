import { describe, expect, it } from 'vitest';
import { carOfferFixture } from '@/test/car-fixtures';
import { carAlertMessage, evaluateCarAlerts } from './alerts';
import { formatCarMoney } from './money';

const money = (minor: number) => ({ currency: 'GBP', minor });
describe('verified rental alert transitions', () => {
  it('establishes the first low without an alert but notifies an initially reached target', () => {
    expect(evaluateCarAlerts({ targetArmed: true, historicalLowMinor: null }, money(10000), true, money(10000), true)).toEqual({ target: true, low: false, state: { targetArmed: false, historicalLowMinor: 10000 } });
  });
  it('emits both flags on one observation crossing the target and historical low', () => {
    expect(evaluateCarAlerts({ targetArmed: true, historicalLowMinor: 12000 }, money(10000), true, money(9000), true)).toMatchObject({ target: true, low: true });
  });
  it('does not rearm a target after an incomplete or absent observation', () => {
    const state = { targetArmed: false, historicalLowMinor: 9000 };
    expect(evaluateCarAlerts(state, money(10000), true, null, false).state).toEqual(state);
    expect(evaluateCarAlerts(state, money(10000), true, money(11000), false).state).toEqual(state);
    const rearmed = evaluateCarAlerts(state, money(10000), true, money(11000), true);
    expect(rearmed.state.targetArmed).toBe(true);
    expect(evaluateCarAlerts(rearmed.state, money(10000), true, money(10000), true).target).toBe(true);
  });
  it('retains the baseline when new-low notifications are disabled and never repeats equal-price alerts', () => {
    const first = evaluateCarAlerts({ targetArmed: false, historicalLowMinor: 10000 }, null, false, money(9000), true);
    expect(first).toMatchObject({ low: false, state: { historicalLowMinor: 9000 } });
    expect(evaluateCarAlerts(first.state, null, true, money(9000), true)).toMatchObject({ target: false, low: false });
  });
  it('rejects mixed currencies and fractional minor units before changing alert state', () => {
    const state = { targetArmed: true, historicalLowMinor: null };
    expect(() => evaluateCarAlerts(state, { currency: 'USD', minor: 10000 }, true, money(9000), true)).toThrow(/currencies/);
    expect(() => evaluateCarAlerts(state, null, true, money(0.5), true)).toThrow(/minor/);
  });
  it('describes a combined alert with its verified total, bounded coverage and immutable recipient', () => {
    const offer = carOfferFixture();
    const outcome = evaluateCarAlerts({ targetArmed: true, historicalLowMinor: 12000 }, money(10000), true, money(9000), true);
    const message = carAlertMessage({ id: 'tracker', label: 'London trip', revision: 7, userId: 'owner' }, offer, money(9000), outcome);
    expect(message.title).toContain('target reached and new low');
    expect(message.title).toContain('London trip');
    expect(message.body).toContain('£90.00');
    expect(message.body).toContain('station-local times');
    expect(message.body).toContain('among checked offers, not the entire market');
    expect(message.body).toContain('Review supplier requirements');
    expect(message.url).toBe(offer.bookingUrl);
    expect(message.data).toMatchObject({ trackerId: 'tracker', trackerRevision: 7, userId: 'owner', totalMinor: 9000, currency: 'GBP', target: true, newLow: true });
  });
});

describe('exact rental amount presentation', () => {
  it('preserves the final penny at the supported integer limit', () => {
    expect(formatCarMoney({ currency: 'USD', minor: Number.MAX_SAFE_INTEGER }, 'en-US')).toBe('$90,071,992,547,409.91');
  });
  it('uses currency precision and locale without multiplying or rounding totals', () => {
    expect(formatCarMoney({ currency: 'JPY', minor: 12345 }, 'en-US')).toBe('¥12,345');
    expect(formatCarMoney({ currency: 'KWD', minor: 12345 }, 'en-US')).toContain('12.345');
    expect(formatCarMoney({ currency: 'EUR', minor: 12345 }, 'de-DE')).toContain('123,45');
  });
});

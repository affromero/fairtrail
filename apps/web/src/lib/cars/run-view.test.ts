import { describe, expect, it } from 'vitest';
import { carReportFixture, carSearchFixture } from '@/test/car-fixtures';
import { validateCarRunView } from './run-view';
import { CarError } from './types';

function completed() {
  const now = new Date().toISOString();
  return { id: 'search-one', trackerId: null, trackingClosed: false, status: 'success', createdAt: now, completedAt: now, search: carSearchFixture(), result: carReportFixture(), error: null };
}
describe('rental status validation', () => {
  it('retains the permanent creation fence without hiding verified offers', () => {
    expect(validateCarRunView({ ...completed(), trackingClosed: true }, 'search-one')).toMatchObject({ trackingClosed: true, result: { offers: [{ id: 'verified-quote' }] } });
  });
  it.each([undefined, null, 'false', 0])('rejects unverified tracking closure state %j', trackingClosed => {
    expect(() => validateCarRunView({ ...completed(), trackingClosed }, 'search-one')).toThrow(CarError);
  });
  it('returns verified completed results with station-local search identity intact', () => {
    const value = completed();
    expect(validateCarRunView(value, value.id, true)).toMatchObject({ status: 'success', search: { pickup: { timeZone: 'Europe/London' } }, result: { offers: [{ id: 'verified-quote' }] } });
  });
  it('accepts a queued search before any provider has returned a result', () => {
    expect(validateCarRunView({ ...completed(), status: 'queued', completedAt: null, result: null }, 'search-one')).toMatchObject({ status: 'queued', result: null });
  });
  it.each([
    { id: 'someone-else' }, { status: 'invented' }, { completedAt: null },
    { status: 'running' }, { result: null }, { createdAt: '2026-02-30T00:00:00.000Z' },
    { completedAt: '2020-01-01T00:00:00.000Z' },
  ])('rejects inconsistent search identity or lifecycle: %j', change => {
    expect(() => validateCarRunView({ ...completed(), ...change }, 'search-one')).toThrow(CarError);
  });
  it('does not expose tracker history through the standalone result surface', () => {
    const value = { ...completed(), trackerId: 'tracker-one' };
    expect(() => validateCarRunView(value, value.id, true)).toThrow(CarError);
    expect(validateCarRunView(value, value.id).trackerId).toBe('tracker-one');
  });
  it('rejects malformed provider evidence instead of dropping it from a successful result', () => {
    const value = completed(); value.result.offers[0]!.bookingUrl = 'https://attacker.example/';
    expect(() => validateCarRunView(value, value.id)).toThrow(CarError);
  });
  it.each(['success', 'partial'])('rejects unfinished provider accounting in a %s search', status => {
    const value = completed(); value.status = status;
    value.result.providers[1]!.status = 'running'; value.result.completed = 1; value.result.successfulProviders = 1;
    expect(() => validateCarRunView(value, value.id)).toThrow(CarError);
    expect(validateCarRunView({ ...value, status: 'cancelled' }, value.id).status).toBe('cancelled');
  });
});

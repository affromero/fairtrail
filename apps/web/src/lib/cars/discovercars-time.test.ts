import { describe, expect, it } from 'vitest';
import { resolveCarLocalTime } from './validation';
import { verifyDiscoverCarsLocalTime } from './discovercars-time';

describe('independent visible rental time verification', () => {
  it('uses London daylight-saving rules despite a conflicting provider serialization offset', () => {
    const expected = resolveCarLocalTime({ date: '2026-10-15', time: '11:00', timeZone: 'Europe/London' });
    expect(expected.instant).toBe('2026-10-15T10:00:00Z');
    expect(() => verifyDiscoverCarsLocalTime('Pick-up Thursday, Oct 15, 2026, 11:00 AM', '2026-10-15T11:00:00+03:00', expected)).not.toThrow();
  });
  it('rejects a wrong displayed time even if the serialized request matches', () => {
    const expected = resolveCarLocalTime({ date: '2026-10-15', time: '11:00', timeZone: 'Europe/London' });
    expect(() => verifyDiscoverCarsLocalTime('Thursday, Oct 15, 2026, 10:00 AM', '2026-10-15T11:00:00+03:00', expected)).toThrow(/Visible/);
  });
  it('checks the winter date and wall time without inheriting the provider offset', () => {
    const expected = resolveCarLocalTime({ date: '2026-11-15', time: '11:00', timeZone: 'Europe/London' });
    expect(expected.instant).toBe('2026-11-15T11:00:00Z');
    expect(() => verifyDiscoverCarsLocalTime('Sunday, Nov 15, 2026, 11:00 AM', '2026-11-15T11:00:00+03:00', expected)).not.toThrow();
    expect(() => verifyDiscoverCarsLocalTime('Sunday, Nov 15, 2026, 11:00 AM', '2026-11-16T11:00:00+03:00', expected)).toThrow(/Rendered/);
  });
});

import { describe, it, expect } from 'vitest';
import { getAirlineUrl, isKnownAirline, getKnownAirlines } from './airline-urls';

const baseParams = {
  origin: 'JFK',
  destination: 'LAX',
  dateFrom: new Date('2026-06-15'),
  dateTo: new Date('2026-06-22'),
};

describe('getAirlineUrl', () => {
  it('returns url for known airline', () => {
    const url = getAirlineUrl('delta', baseParams);
    expect(url).not.toBeNull();
    expect(url).toContain('delta.com');
    expect(url).toContain('JFK');
    expect(url).toContain('LAX');
  });

  it('resolves IATA alias', () => {
    const url = getAirlineUrl('DL', baseParams);
    expect(url).toContain('delta.com');
  });

  it('resolves full name alias', () => {
    const url = getAirlineUrl('American Airlines', baseParams);
    expect(url).toContain('aa.com');
  });

  it('returns null for unknown airline', () => {
    expect(getAirlineUrl('FlyByNight', baseParams)).toBeNull();
  });

  it('normalizes case and whitespace', () => {
    const url = getAirlineUrl('  DELTA  ', baseParams);
    expect(url).toContain('delta.com');
  });

  it('includes cabin class mapping', () => {
    const url = getAirlineUrl('delta', { ...baseParams, cabinClass: 'business' });
    expect(url).toContain('BUSINESS');
  });

  it('formats dates as yyyy-mm-dd', () => {
    const url = getAirlineUrl('delta', baseParams)!;
    expect(url).toContain('2026-06-15');
    expect(url).toContain('2026-06-22');
  });
});

describe('isKnownAirline', () => {
  it('returns true for known airline', () => {
    expect(isKnownAirline('southwest')).toBe(true);
  });

  it('returns true for alias', () => {
    expect(isKnownAirline('BA')).toBe(true);
  });

  it('returns false for unknown', () => {
    expect(isKnownAirline('FlyByNight')).toBe(false);
  });
});

describe('getKnownAirlines', () => {
  it('returns all airlines', () => {
    const airlines = getKnownAirlines();
    expect(airlines.length).toBeGreaterThanOrEqual(25);
    expect(airlines).toContain('delta');
    expect(airlines).toContain('ryanair');
    expect(airlines).toContain('emirates');
  });

  it('returns canonical names not aliases', () => {
    const airlines = getKnownAirlines();
    expect(airlines).not.toContain('DL');
    expect(airlines).not.toContain('AA');
  });
});

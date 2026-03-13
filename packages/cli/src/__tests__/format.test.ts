import { describe, it, expect } from 'vitest';
import { formatCurrency, currencySymbol, formatDate, formatDateShort, formatTimeAgo, formatStops } from '../lib/format.js';

describe('currencySymbol', () => {
  it('returns $ for USD', () => {
    expect(currencySymbol('USD')).toBe('$');
  });

  it('returns € for EUR', () => {
    expect(currencySymbol('EUR')).toBe('€');
  });

  it('returns code for unknown currency', () => {
    expect(currencySymbol('XYZ')).toBe('XYZ');
  });
});

describe('formatCurrency', () => {
  it('formats USD amount', () => {
    expect(formatCurrency(623.5, 'USD')).toBe('$624');
  });

  it('formats EUR amount', () => {
    expect(formatCurrency(450, 'EUR')).toBe('€450');
  });

  it('rounds to nearest integer', () => {
    expect(formatCurrency(99.4, 'USD')).toBe('$99');
    expect(formatCurrency(99.5, 'USD')).toBe('$100');
  });
});

describe('formatDate', () => {
  it('formats ISO date string', () => {
    const result = formatDate('2026-03-15');
    expect(result).toBe('Mar 15');
  });

  it('formats Date object', () => {
    const result = formatDate(new Date('2026-12-25T00:00:00Z'));
    expect(result).toBe('Dec 25');
  });
});

describe('formatDateShort', () => {
  it('includes short year', () => {
    const result = formatDateShort('2026-03-15');
    expect(result).toContain('Mar');
    expect(result).toContain('15');
    expect(result).toContain('26');
  });
});

describe('formatTimeAgo', () => {
  it('returns "just now" for recent times', () => {
    expect(formatTimeAgo(new Date())).toBe('just now');
  });

  it('returns minutes for < 1 hour', () => {
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);
    expect(formatTimeAgo(thirtyMinsAgo)).toBe('30m ago');
  });

  it('returns hours for < 1 day', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000);
    expect(formatTimeAgo(fiveHoursAgo)).toBe('5h ago');
  });

  it('returns days for >= 1 day', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(formatTimeAgo(threeDaysAgo)).toBe('3d ago');
  });
});

describe('formatStops', () => {
  it('returns "Nonstop" for 0', () => {
    expect(formatStops(0)).toBe('Nonstop');
  });

  it('returns "1 stop" for 1', () => {
    expect(formatStops(1)).toBe('1 stop');
  });

  it('returns "2 stops" for 2', () => {
    expect(formatStops(2)).toBe('2 stops');
  });
});

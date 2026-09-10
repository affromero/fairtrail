import { describe, expect, it } from 'vitest';
import { isLegacySplitFare } from './flight-pricing';

describe('legacy split fare identification', () => {
  it('recognizes the synthetic label written by older previews', () => {
    expect(isLegacySplitFare('Air Canada + Air Canada (approx OW+OW)')).toBe(true);
  });

  it('preserves real fares including multi-airline itineraries', () => {
    for (const airline of ['Air Canada', 'Air Canada + ANA', 'United', '', null, undefined]) {
      expect(isLegacySplitFare(airline)).toBe(false);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { verifyDiscoverCarsConditionsUrl } from './discovercars-conditions-url';

const id = '11111111-2222-4333-8444-555555555555-RATE';
const url = 'https://www.discovercars.com/en/car-offer/rental-conditions/11111111-2222-4333-8444-555555555555/RATE';
describe('quote-bound rental conditions', () => {
  it('accepts the exact provider terms document for the selected quote', () => {
    expect(verifyDiscoverCarsConditionsUrl(url, id)).toBe(url);
  });
  it.each([url.replace('11111111', '99999999'), url.replace('/RATE', '/OTHER'), url.replace('www.discovercars.com', 'attacker.example'), 'about:blank', url.replace('https:', 'http:'), url.replace('.com/', '.com:8443/'), url.replace('https://', 'https://user:password@')])('rejects unrelated or unsafe terms documents: %s', invalid => {
    expect(() => verifyDiscoverCarsConditionsUrl(invalid, id)).toThrow();
  });
});

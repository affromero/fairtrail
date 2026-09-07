import { describe, expect, it } from 'vitest';
import { discoverCarsOfferFromScripts, discoverCarsRenderedOffer } from './discovercars-rendered';

const quote = { offerId: 'fresh-rate', vehicle: { model: { name: 'Example car' } }, priceObject: { total: 125 }, supplier: { id: 54 }, dataLayer: { tracking: 'excluded' } };
const rendered = (value: unknown) => `65:${JSON.stringify(['$', '$component', null, { offer: value }])}\n`;

describe('provider-rendered DiscoverCars quote capture', () => {
  it('reads fragmented JSON records and excludes analytics from captured rental data', () => {
    const data = rendered(quote);
    const result = discoverCarsRenderedOffer([[0], [1, data.slice(0, 30)], [1, data.slice(30)]], 'fresh-rate');
    expect(result).toMatchObject({ offerId: 'fresh-rate', vehicle: quote.vehicle, supplier: quote.supplier });
    expect(result).not.toHaveProperty('dataLayer');
  });
  it('reads persistent script elements after hydration consumes the provider stream', () => {
    const script = `self.__next_f.push(${JSON.stringify([1, rendered(quote)])})`;
    expect(discoverCarsOfferFromScripts(['unrelatedScript()', script], 'fresh-rate')).toMatchObject({ offerId: 'fresh-rate' });
    expect(() => discoverCarsOfferFromScripts([`${script};globalThis.process.exit(1)`], 'fresh-rate')).toThrow(/selected/);
  });
  it('does not substitute another session or execute a script-like record', () => {
    expect(() => discoverCarsRenderedOffer([[1, rendered(quote)]], 'different-rate')).toThrow(/selected/);
    expect(() => discoverCarsRenderedOffer([[1, '65:globalThis.process.exit(1)\n']], 'fresh-rate')).toThrow(/selected/);
  });
  it('rejects conflicting rendered quotes instead of choosing a convenient price', () => {
    expect(() => discoverCarsRenderedOffer([[1, rendered(quote) + rendered({ ...quote, priceObject: { total: 250 } })]], 'fresh-rate')).toThrow(/conflicting/);
  });
  it('rejects oversized or absent rendered data', () => {
    expect(() => discoverCarsRenderedOffer(undefined, 'fresh-rate')).toThrow(/Missing/);
    expect(() => discoverCarsRenderedOffer([[1, 'x'.repeat(4_000_001)]], 'fresh-rate')).toThrow(/limit/);
  });
});

import { describe, expect, it } from 'vitest';
import { discoverCarsOfferFromScripts, discoverCarsRenderedOffer } from './discovercars-rendered';
import { CarError } from './types';

const quote = { offerId: 'fresh-rate', vehicle: { model: { name: 'Example car' } }, priceObject: { total: 125 }, supplier: { id: 54 }, dataLayer: { tracking: 'excluded' } };
const rendered = (value: unknown) => `65:${JSON.stringify(['$', '$component', null, { offer: value }])}\n`;
const textRow = (id: string, text: string) => `${id}:T${Buffer.byteLength(text, 'utf8').toString(16)},${text}`;

describe('provider-rendered DiscoverCars quote capture', () => {
  it('resolves referenced office instructions across fragmented UTF-8 text records', () => {
    const instructions = 'Collect at café departures 🚗\nReturn to the same office.\nA £200 charge applies to terminal parking.';
    const data = textRow('72', instructions) + rendered({ ...quote, pickup: { instructions: '$72' }, dropoff: '$73' })
      + `73:${JSON.stringify({ instructions: '$72', address: '79 New Road' })}\n`;
    const split = data.indexOf('🚗') + 1;
    const result = discoverCarsRenderedOffer([[1, data.slice(0, split)], [1, data.slice(split)]], 'fresh-rate');
    expect(result).toMatchObject({ pickup: { instructions }, dropoff: { instructions, address: '79 New Road' } });
  });
  it('keeps JSON-looking text inside its declared text record instead of selecting a fake quote', () => {
    const data = textRow('72', `Office instructions\n${rendered(quote)}\nMore conditions`);
    expect(() => discoverCarsRenderedOffer([[1, data]], 'fresh-rate')).toThrow(/selected/);
  });
  it('preserves escaped dollar amounts and literal text without reinterpreting them as references', () => {
    const data = rendered({ ...quote, pickup: { instructions: '$$200 parking charge' }, dropoff: { instructions: '$72' } }) + textRow('72', '$73 is the parking fee');
    expect(discoverCarsRenderedOffer([[1, data]], 'fresh-rate')).toMatchObject({ pickup: { instructions: '$200 parking charge' }, dropoff: { instructions: '$73 is the parking fee' } });
  });
  it.each([
    { label: 'missing', reference: '$72', rows: '' },
    { label: 'cycle', reference: '$72', rows: '72:"$73"\n73:"$72"\n' },
    { label: 'module', reference: '$72', rows: '72:I[123,[],"default"]\n' },
    { label: 'lazy', reference: '$L72', rows: '' },
    { label: 'function', reference: '$F72', rows: '' },
    { label: 'property path', reference: '$72:__proto__', rows: '72:{}\n' },
  ])('rejects a $label reference required by the selected quote', ({ reference, rows }) => {
    expect(() => discoverCarsRenderedOffer([[1, rendered({ ...quote, pickup: { instructions: reference } }) + rows]], 'fresh-rate')).toThrow(/reference/);
  });
  it.each(['72:Tff,short', '72:Tz,text', '72:Y10,unverified\n', '72:T1,é'])('rejects malformed, unsupported or truncated text framing: %s', data => {
    expect(() => discoverCarsRenderedOffer([[1, data + rendered(quote)]], 'fresh-rate')).toThrow();
  });
  it('rejects repeated record identities even when a convenient quote is present', () => {
    expect(() => discoverCarsRenderedOffer([[1, textRow('72', 'one') + textRow('72', 'two') + rendered(quote)]], 'fresh-rate')).toThrow(/duplicate/);
  });
  it.each(['72:A1,x', '72:I[123,[],"default"]\n', '72:X\n', '72:{invalid}\n'])('rejects plain data that replaces an unsupported identity: %s', prefix => {
    expect(() => discoverCarsRenderedOffer([[1, prefix + '72:"replacement"\n' + rendered(quote)]], 'fresh-rate')).toThrow(/duplicate/);
  });
  it('allows repeated resource hints and a stream closing without treating them as quote data', () => {
    const data = ':HL["/font.woff2"]\n:HL["/style.css"]\n1c:X\n1c:C\n' + rendered(quote);
    expect(discoverCarsRenderedOffer([[1, data]], 'fresh-rate')).toMatchObject({ offerId: 'fresh-rate' });
  });
  it('bounds expanded shared text instead of allocating an amplified quote', () => {
    const data = textRow('72', 'x'.repeat(12000)) + rendered({ ...quote, extras: Array.from({ length: 90 }, () => '$72') });
    expect(() => discoverCarsRenderedOffer([[1, data]], 'fresh-rate')).toThrow(/limit/);
  });
  it('bounds expanded nodes and reference depth even when text stays small', () => {
    const wide = `72:${JSON.stringify(Array.from({ length: 1000 }, () => null))}\n` + rendered({ ...quote, extras: Array.from({ length: 60 }, () => '$72') });
    expect(() => discoverCarsRenderedOffer([[1, wide]], 'fresh-rate')).toThrow(/limit/);
    const deep = Array.from({ length: 35 }, (_, index) => `${(index + 200).toString(16)}:"$${(index + 201).toString(16)}"\n`).join('');
    expect(() => discoverCarsRenderedOffer([[1, rendered({ ...quote, pickup: '$c8' }) + deep]], 'fresh-rate')).toThrow(/limit/);
  });
  it('does not interpret length-framed binary data as another rental quote', () => {
    const fake = rendered(quote), data = `72:A${Buffer.byteLength(fake).toString(16)},${fake}`;
    expect(() => discoverCarsRenderedOffer([[1, data]], 'fresh-rate')).toThrow(/selected/);
  });
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
    expect(() => discoverCarsRenderedOffer([[1, '65:globalThis.process.exit(1)\n']], 'fresh-rate')).toThrow(CarError);
  });
  it('rejects conflicting rendered quotes instead of choosing a convenient price', () => {
    expect(() => discoverCarsRenderedOffer([[1, rendered(quote) + rendered({ ...quote, priceObject: { total: 250 } })]], 'fresh-rate')).toThrow(/conflicting/);
  });
  it('rejects oversized or absent rendered data', () => {
    expect(() => discoverCarsRenderedOffer(undefined, 'fresh-rate')).toThrow(/Missing/);
    expect(() => discoverCarsRenderedOffer([[1, 'x'.repeat(4_000_001)]], 'fresh-rate')).toThrow(/limit/);
  });
});

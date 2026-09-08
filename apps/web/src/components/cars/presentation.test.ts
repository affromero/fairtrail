import { describe, expect, it } from 'vitest';
import { carOptionsFromDraft, carOptionsToDraft, defaultCarOptionsDraft, safeCarLink } from './presentation';

describe('rental alert input', () => {
  it.each(['en', 'es', 'fr', 'de', 'pt'])('edits the largest supported monetary target without losing a minor unit in %s', locale => {
    const options = { mode: 'best' as const, target: { currency: 'USD', minor: Number.MAX_SAFE_INTEGER }, scrapeInterval: 3, notifyLows: true };
    const draft = carOptionsToDraft(options, locale);
    expect(draft.target).toMatch(/^90071992547409[.,]91$/);
    expect(carOptionsFromDraft(draft, 'USD', locale)).toEqual(options);
  });
  it.each([['JPY', 1234, '1234'], ['KWD', 12345, '12,345']] as const)('keeps the stored %s currency precision in editable targets', (currency, minor, target) => {
    expect(carOptionsToDraft({ mode: 'best', target: { currency, minor }, scrapeInterval: 24, notifyLows: false }, 'de')).toMatchObject({ target, interval: '24', notifyLows: false });
  });
  it.each([
    ['en', 'GBP', '1234.56', 123456], ['de', 'EUR', '1234,56', 123456], ['es', 'EUR', '0,01', 1],
    ['fr', 'KWD', '12,345', 12345], ['pt', 'JPY', '1234', 1234], ['en', 'USD', '90071992547409.91', Number.MAX_SAFE_INTEGER],
  ] as const)('parses %s %s amounts without rounding: %s', (locale, currency, target, minor) => {
    expect(carOptionsFromDraft({ ...defaultCarOptionsDraft, target }, currency, locale).target).toEqual({ currency, minor });
  });
  it.each([
    ['en', 'USD', '1,234.56'], ['de', 'EUR', '1.234,56'], ['fr', 'EUR', '1 234,56'], ['de', 'EUR', '12.50'],
    ['en', 'JPY', '1.5'], ['en', 'KWD', '1.2345'], ['en', 'USD', '0'], ['en', 'USD', '-10'], ['en', 'USD', '1e3'],
  ])('rejects ambiguous or unrepresentable %s %s targets: %s', (locale, currency, target) => {
    expect(() => carOptionsFromDraft({ ...defaultCarOptionsDraft, target }, currency, locale)).toThrow();
  });
  it.each(['', '0', '25', '3.5', '1e1'])('rejects an invalid interval: %s', interval => {
    expect(() => carOptionsFromDraft({ ...defaultCarOptionsDraft, interval }, 'GBP', 'en')).toThrow();
  });
  it('leaves the optional target unset and preserves the selected tracking behavior', () => {
    expect(carOptionsFromDraft({ mode: 'contract', target: ' ', interval: '24', notifyLows: false }, 'JPY', 'en')).toEqual({ mode: 'contract', target: null, scrapeInterval: 24, notifyLows: false });
  });
  it('only permits canonical selected-provider links', () => {
    expect(safeCarLink('https://www.discovercars.com/offer/123', 'discovercars')).toBe('https://www.discovercars.com/offer/123');
    for (const url of ['javascript:alert(1)', 'http://www.discovercars.com', 'https://evil.example/', 'https://www.discovercars.com.evil.example', 'https://user:pass@www.discovercars.com/']) expect(safeCarLink(url, 'discovercars')).toBeUndefined();
    expect(safeCarLink('https://book.autoeurope.com/', 'discovercars')).toBeUndefined();
  });
});

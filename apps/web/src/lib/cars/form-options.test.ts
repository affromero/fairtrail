import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../i18n/locales';
import { carFormOptions } from './form-options';
import { validateCarCountry } from './validation';

describe('rental residence choices', () => {
  it.each(LOCALES)('offers each country once with localized labels in %s', locale => {
    const { countries } = carFormOptions(locale);
    const codes = countries.map(country => country.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(countries.map(country => country.name)).size).toBe(countries.length);
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    for (const code of ['GB', 'DE', 'FR', 'CW', 'BQ', 'AX', 'XK']) {
      expect(countries.filter(country => country.code === code)).toEqual([{ code, name: names.of(code) }]);
    }
    for (const code of ['UK', 'DD', 'FX', 'SU', 'AN', 'EU', 'AC', 'ZZ', 'XA']) expect(codes).not.toContain(code);
    for (const country of countries) expect(validateCarCountry(country.code)).toBe(country.code);
    expect(countries.map(country => country.name)).toEqual(countries.map(country => country.name).sort((a, b) => a.localeCompare(b, locale)));
  });
});

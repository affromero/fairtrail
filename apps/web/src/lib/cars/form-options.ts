import { CAR_COUNTRY_CODES } from './countries';

export interface CarFormOptions { countries: { code: string; name: string }[]; currencies: string[] }

/** Serialize once on the server: browser ICU versions can use different names. */
export function carFormOptions(locale: string): CarFormOptions {
  const names = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' }), countries: CarFormOptions['countries'] = [];
  for (const code of CAR_COUNTRY_CODES) {
    countries.push({ code, name: names.of(code) ?? code });
  }
  countries.sort((a, b) => a.name.localeCompare(b.name, locale));
  return { countries, currencies: Intl.supportedValuesOf('currency') };
}

export interface CarFormOptions { countries: { code: string; name: string }[]; currencies: string[] }

/** Serialize once on the server: browser ICU versions can use different names. */
export function carFormOptions(locale: string): CarFormOptions {
  const names = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' }), countries: CarFormOptions['countries'] = [];
  for (let first = 65; first <= 90; first++) for (let second = 65; second <= 90; second++) {
    const code = String.fromCharCode(first, second), name = names.of(code);
    if (name && !['ZZ', 'EU', 'EZ', 'UN', 'XA', 'XB'].includes(code)) countries.push({ code, name });
  }
  countries.sort((a, b) => a.name.localeCompare(b.name, locale));
  return { countries, currencies: Intl.supportedValuesOf('currency') };
}

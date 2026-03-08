const SYMBOLS: Record<string, string> = {
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CNY: '¥',
  KRW: '₩',
  INR: '₹',
  CHF: 'CHF',
  CAD: 'CA$',
  AUD: 'A$',
  NZD: 'NZ$',
  HKD: 'HK$',
  SGD: 'S$',
  SEK: 'kr',
  NOK: 'kr',
  DKK: 'kr',
  PLN: 'zł',
  BRL: 'R$',
  MXN: 'MX$',
  THB: '฿',
  TRY: '₺',
  ZAR: 'R',
  ILS: '₪',
  COP: 'COL$',
};

export function currencySymbol(code: string): string {
  return SYMBOLS[code] ?? code;
}

/** Detect a likely currency from the user's browser locale. Server-safe fallback to USD. */
export function detectLocaleCurrency(): string {
  if (typeof navigator === 'undefined') return 'USD';

  try {
    const locale = navigator.language || 'en-US';
    // Use Intl to resolve the locale's currency
    const parts = new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' })
      .resolvedOptions();

    // Map common locale regions to currencies
    const region = locale.split('-')[1]?.toUpperCase() ?? '';
    const REGION_CURRENCY: Record<string, string> = {
      US: 'USD', GB: 'GBP', DE: 'EUR', FR: 'EUR', ES: 'EUR', IT: 'EUR',
      NL: 'EUR', BE: 'EUR', AT: 'EUR', PT: 'EUR', IE: 'EUR', FI: 'EUR',
      GR: 'EUR', JP: 'JPY', CN: 'CNY', KR: 'KRW', IN: 'INR', CH: 'CHF',
      CA: 'CAD', AU: 'AUD', NZ: 'NZD', HK: 'HKD', SG: 'SGD', SE: 'SEK',
      NO: 'NOK', DK: 'DKK', PL: 'PLN', BR: 'BRL', MX: 'MXN', TH: 'THB',
      TR: 'TRY', ZA: 'ZAR', IL: 'ILS', CO: 'COP',
    };

    return REGION_CURRENCY[region] ?? parts.locale?.split('-')[1]?.toUpperCase() ?? 'USD';
  } catch {
    return 'USD';
  }
}

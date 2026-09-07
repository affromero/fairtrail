import { CarError, type CarMoney } from './types';

export function currencyPrecision(currency: string): number {
  if (!Intl.supportedValuesOf('currency').includes(currency)) throw new CarError('Unsupported currency');
  const precision = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits;
  if (precision === undefined) throw new CarError('Currency precision is unavailable');
  return precision;
}
export function validateCarMoney(raw: unknown, currency?: string): CarMoney {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CarError('Expected a monetary amount');
  const value = raw as Record<string, unknown>;
  if (typeof value.currency !== 'string') throw new CarError('Missing currency');
  currencyPrecision(value.currency);
  if (currency && value.currency !== currency) throw new CarError('Mixed currencies cannot be combined');
  if (typeof value.minor !== 'number' || !Number.isSafeInteger(value.minor) || value.minor < 0) throw new CarError('Amount must use non-negative safe integer minor units');
  return { currency: value.currency, minor: value.minor };
}
/** Input is a canonical decimal string, after provider-specific locale parsing. */
export function parseCarMoney(decimal: string, currency: string): CarMoney {
  const precision = currencyPrecision(currency);
  if (typeof decimal !== 'string' || !/^\d{1,16}(?:\.\d{1,6})?$/.test(decimal)) throw new CarError('Invalid decimal price');
  const [whole, fraction = ''] = decimal.split('.');
  if (fraction.length > precision && /[1-9]/.test(fraction.slice(precision))) throw new CarError('Price contains fractional minor units');
  const minor = BigInt(whole!) * 10n ** BigInt(precision) + BigInt(fraction.slice(0, precision).padEnd(precision, '0') || '0');
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new CarError('Price exceeds the supported amount');
  return { currency, minor: Number(minor) };
}
export function sumCarMoney(amounts: CarMoney[], currency: string): CarMoney {
  currencyPrecision(currency);
  const minor = amounts.reduce((sum, amount) => sum + BigInt(validateCarMoney(amount, currency).minor), 0n);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) throw new CarError('Total exceeds the supported amount');
  return { currency, minor: Number(minor) };
}

/** Keep fractional minor units exact even near Number.MAX_SAFE_INTEGER. */
export function formatCarMoney(raw: CarMoney, locale = 'en'): string {
  const amount = validateCarMoney(raw), precision = currencyPrecision(amount.currency);
  const scale = 10n ** BigInt(precision), minor = BigInt(amount.minor);
  const fraction = precision ? new Intl.NumberFormat(locale, { useGrouping: false, minimumIntegerDigits: precision }).format(Number(minor % scale)) : '';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: amount.currency }).formatToParts(minor / scale)
    .map(part => part.type === 'fraction' ? fraction : part.value).join('');
}

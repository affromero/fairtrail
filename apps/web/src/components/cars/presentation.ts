import { CarError, type CarLocalTime, type CarSource, type CarTrackingOptions } from '@/lib/cars/types';
import { carProviderUrl } from '@/lib/cars/offer-validation';
import { formatCarDecimal, parseCarMoney } from '@/lib/cars/money';
import { validateCarOptions } from '@/lib/cars/validation';

export interface CarOptionsDraft { mode: CarTrackingOptions['mode']; target: string; interval: string; notifyLows: boolean }
export const defaultCarOptionsDraft: CarOptionsDraft = { mode: 'best', target: '', interval: '3', notifyLows: true };
export function carOptionsToDraft(options: CarTrackingOptions, locale: string): CarOptionsDraft {
  return { mode: options.mode, target: options.target ? formatCarDecimal(options.target, locale) : '', interval: String(options.scrapeInterval), notifyLows: options.notifyLows };
}
export function carDecimalSeparator(locale: string): string {
  return new Intl.NumberFormat(locale).formatToParts(1.1).find(part => part.type === 'decimal')?.value ?? '.';
}
export function carMoneyFromDraft(value: string, currency: string, locale: string) {
  const text = value.trim(), decimal = carDecimalSeparator(locale);
  if (decimal !== '.' && text.includes('.')) throw new CarError('Use the local decimal separator without thousands separators');
  return text ? parseCarMoney(text.replace(decimal, '.'), currency) : null;
}
export function carOptionsFromDraft(draft: CarOptionsDraft, currency: string, locale: string): CarTrackingOptions {
  const target = carMoneyFromDraft(draft.target, currency, locale);
  if (target?.minor === 0) throw new CarError('Choose a positive target or leave it empty');
  if (!/^(?:[1-9]|1\d|2[0-4])$/.test(draft.interval)) throw new CarError('Check interval must be a whole number from 1 to 24');
  return validateCarOptions({ mode: draft.mode, target, scrapeInterval: Number(draft.interval), notifyLows: draft.notifyLows }, currency);
}
export function safeCarLink(value: string, source: CarSource): string | undefined {
  try { return carProviderUrl(value, source); } catch { return undefined; }
}
export function carLocalDate(value: CarLocalTime, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: value.timeZone }).format(new Date(value.instant));
}

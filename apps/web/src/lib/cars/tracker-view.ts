import { carInteger, carRecord, carText, validateCarOptions, validateCarSearch } from './validation';
import { carObservationTime } from './offer-validation';
import { validateCarMoney } from './money';
import { validateCarSelection } from './identity';
import { CarError } from './types';

export function carViewBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new CarError('Invalid rental view flag');
  return value;
}
export function carViewTime(value: unknown, future = false): string {
  return carObservationTime(value, future ? new Date('9999-12-31T23:59:59.999Z') : new Date());
}
export function validateCarTrackerView(raw: unknown) {
  const row = carRecord(raw), createdAt = carViewTime(row.createdAt), updatedAt = carViewTime(row.updatedAt);
  const search = validateCarSearch(row.search, new Date(createdAt), { allowUnresolvedProviders: true });
  if (search.currency !== row.currency) throw new CarError('Stored rental currency does not match its search');
  const rawOptions = carRecord(row.options);
  if (rawOptions.mode == null || rawOptions.target === undefined || rawOptions.notifyLows == null || rawOptions.scrapeInterval == null) throw new CarError('Stored rental settings are incomplete');
  const options = validateCarOptions(rawOptions, search.currency), selection = row.selection === null ? null : validateCarSelection(row.selection);
  if ((options.mode === 'contract') !== Boolean(selection) || (selection && !search.sources.includes(selection.source))) throw new CarError('Stored rental selection does not match its tracking mode');
  const money = (value: unknown) => value === null ? null : validateCarMoney({ currency: search.currency, minor: value }).minor;
  if (updatedAt < createdAt) throw new CarError('Tracker update predates its creation');
  return {
    id: carText(row.id, 200, 'tracker identity'), userId: row.userId === null ? null : carText(row.userId, 200, 'owner'),
    label: carText(row.label, 503, 'tracker label'), search, selection, options, active: carViewBoolean(row.active), revision: carInteger(row.revision, 0, 2147483647, 'Tracker revision'),
    latestPriceMinor: money(row.latestPriceMinor), historicalLowMinor: money(row.historicalLowMinor), currency: search.currency,
    createdAt, updatedAt, lastCheckedAt: row.lastCheckedAt === null ? null : carViewTime(row.lastCheckedAt),
    nextCheckAt: carViewTime(row.nextCheckAt, true), lastError: row.lastError === null ? null : carText(row.lastError, 16000, 'tracker error'),
  };
}
export type CarTrackerView = ReturnType<typeof validateCarTrackerView>;

import { CarError } from './types';
import { carRecord, carText, validateCarSearch } from './validation';
import { carObservationTime } from './offer-validation';
import { validateCarReport } from './report';

export function validateCarRunSummary(raw: unknown, expectedId?: string, now = new Date()) {
  const value = carRecord(raw), id = carText(value.id, 200, 'search identity');
  if (expectedId !== undefined && id !== expectedId) throw new CarError('Rental status belongs to another search');
  const trackerId = value.trackerId === null ? null : carText(value.trackerId, 200, 'tracker identity');
  const status = (['queued', 'running', 'success', 'partial', 'unavailable', 'failed', 'cancelled'] as const).find(status => status === value.status);
  if (!status) throw new CarError('Unknown rental search status');
  const createdAt = carObservationTime(value.createdAt, now), completedAt = value.completedAt === null ? null : carObservationTime(value.completedAt, now);
  if ((status === 'queued' || status === 'running') !== (completedAt === null) || (completedAt !== null && completedAt < createdAt)) throw new CarError('Rental search timestamps do not match its status');
  return { id, trackerId, status, createdAt, completedAt, error: value.error === null ? null : carText(value.error, 16000, 'search error') };
}
export function validateCarRunView(raw: unknown, expectedId: string, standalone = false, now = new Date()) {
  const value = carRecord(raw), summary = validateCarRunSummary(value, expectedId, now), { trackerId, createdAt, completedAt, status } = summary;
  if (standalone && trackerId !== null) throw new CarError('Open tracker checks from their rental history', 404);
  const search = validateCarSearch(value.search, new Date(createdAt));
  const result = value.result === null ? null : validateCarReport(value.result, search.sources, completedAt === null ? now : new Date(completedAt));
  if ((status === 'success' || status === 'partial') && !result) throw new CarError('Completed rental search has no result');
  if ((status === 'success' || status === 'partial') && result && (result.completed !== result.total || result.providers.some(provider => provider.status === 'running'))) throw new CarError('Completed rental search has unfinished providers');
  return { ...summary, search, result };
}
export type CarRunView = ReturnType<typeof validateCarRunView>;
export const carRunIsActive = (run: Pick<CarRunView, 'status'>) => run.status === 'queued' || run.status === 'running';

import type { TravelAlertDelivery } from '@/generated/prisma/client';
import { carInteger, carRecord, carText } from './validation';
import { carViewTime } from './tracker-view';
import { CarError } from './types';

const STATUSES = ['waiting', 'claimed', 'retrying', 'accepted', 'stopped'] as const;
type DeliveryRow = Pick<TravelAlertDelivery, 'id' | 'carTrackerId' | 'createdAt' | 'pending' | 'deliveredIds' | 'lastError' | 'nextAttemptAt' | 'claimExpiresAt'>;

export function validateCarDeliveryView(raw: unknown, trackerId: string) {
  const row = carRecord(raw);
  if (row.trackerId !== trackerId) throw new CarError('Notification belongs to another rental tracker');
  const status = STATUSES.find(status => status === row.status);
  if (!status) throw new CarError('Unknown rental notification state');
  const acknowledgedChannels = carInteger(row.acknowledgedChannels, 0, Number.MAX_SAFE_INTEGER, 'Acknowledged channel count');
  const nextAttemptAt = row.nextAttemptAt === null ? null : carViewTime(row.nextAttemptAt, true);
  const pending = !['accepted', 'stopped'].includes(status);
  if (pending !== (nextAttemptAt !== null) || (status === 'accepted' && acknowledgedChannels === 0)) throw new CarError('Rental notification acknowledgement state is inconsistent');
  return { id: carText(row.id, 200, 'notification identity'), trackerId, status, acknowledgedChannels, createdAt: carViewTime(row.createdAt), nextAttemptAt };
}

/** Only transport acknowledgement counts leave the server, never channel identities or payloads. */
export function carDeliveryView(row: DeliveryRow, trackerId: string, now: Date) {
  const status = row.pending
    ? row.claimExpiresAt && row.claimExpiresAt > now ? 'claimed' : row.lastError ? 'retrying' : 'waiting'
    : row.lastError ? 'stopped' : 'accepted';
  return validateCarDeliveryView({
    id: row.id, trackerId: row.carTrackerId, status,
    acknowledgedChannels: new Set(row.deliveredIds).size,
    createdAt: row.createdAt.toISOString(), nextAttemptAt: row.pending ? row.nextAttemptAt.toISOString() : null,
  }, trackerId);
}
export type CarDeliveryView = ReturnType<typeof validateCarDeliveryView>;

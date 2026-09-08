import { createHash } from 'node:crypto';
import type { CarActor } from './access';
import { carCreationInput, validateCarCreationKey } from './creation-input';
import { carInteger, carText } from './validation';

/** Receipts outlive their tracker so a delayed retry cannot recreate a deletion. */
export function carCreationIntent(raw: unknown, actor: CarActor, requestKey: unknown) {
  const key = validateCarCreationKey(requestKey), input = carCreationInput(raw);
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    id: hash(['car-creation-v1', actor.userId, key]), requestHash: hash(input), ...input,
  };
}

export function carRefreshIntent(trackerId: string, revision: number, actor: CarActor, requestKey: unknown) {
  const key = validateCarCreationKey(requestKey);
  carText(trackerId, 200, 'tracker identity');
  carInteger(revision, 0, 2147483647, 'Tracker revision');
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return { id: hash(['car-refresh-v1', actor.userId, key]), requestHash: hash([trackerId, revision]), trackerId, revision };
}

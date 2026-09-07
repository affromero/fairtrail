import { createHash } from 'node:crypto';
import type { CarActor } from './access';
import { carCreationInput, validateCarCreationKey } from './creation-input';

/** Receipts outlive their tracker so a delayed retry cannot recreate a deletion. */
export function carCreationIntent(raw: unknown, actor: CarActor, requestKey: unknown) {
  const key = validateCarCreationKey(requestKey), input = carCreationInput(raw);
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    id: hash(['car-creation-v1', actor.userId, key]), requestHash: hash(input), ...input,
  };
}

import { createHash } from 'node:crypto';
import type { CarActor } from './access';
import { CarError } from './types';
import { carRecord, carText, validateCarOptions } from './validation';

/** Receipts outlive their tracker so a delayed retry cannot recreate a deletion. */
export function carCreationIntent(raw: unknown, actor: CarActor, requestKey: unknown) {
  if (typeof requestKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestKey)) {
    throw new CarError('Supply a UUID v4 Idempotency-Key and reuse it when retrying this creation');
  }
  const input = carRecord(raw);
  const searchId = carText(input.searchId, 200, 'completed search'), offerId = carText(input.offerId, 200, 'selected offer');
  const label = input.label === undefined ? null : carText(input.label, 250, 'tracker label');
  const options = validateCarOptions(input);
  const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return {
    id: hash(['car-creation-v1', actor.userId, requestKey.toLowerCase()]),
    requestHash: hash({ searchId, offerId, label, options }),
    searchId, offerId, label, options,
  };
}

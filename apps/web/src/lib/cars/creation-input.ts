import { CarError } from './types';
import { carRecord, carText, validateCarOptions } from './validation';

export function validateCarCreationKey(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)) {
    throw new CarError('Supply a UUID v4 Idempotency-Key and reuse it when retrying this creation');
  }
  return raw.toLowerCase();
}

export function carCreationInput(raw: unknown) {
  const input = carRecord(raw);
  return {
    searchId: carText(input.searchId, 200, 'completed search'),
    offerId: carText(input.offerId, 200, 'selected offer'),
    label: input.label === undefined ? null : carText(input.label, 250, 'tracker label'),
    options: validateCarOptions(input),
  };
}

export function carProtectionInput(raw: unknown) {
  const input = carRecord(raw);
  if (Object.keys(input).some(key => !['offerId', 'choiceId'].includes(key))) throw new CarError('Choose a saved protection option without extra fields');
  let choiceId: string;
  try { choiceId = validateCarCreationKey(input.choiceId); }
  catch { throw new CarError('Choose a valid saved protection option'); }
  return { offerId: carText(input.offerId, 200, 'rental offer'), choiceId };
}

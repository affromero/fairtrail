import { carProviderUrl } from './offer-validation';
import { validateCarProtectionChoice, type CarProtectionChoice } from './protection-choice';
import { carRecord, carText } from './validation';
import { CarError, type CarOffer, type CarSource } from './types';

export interface CarProtectionDiscovery {
  offerId: string;
  status: 'complete' | 'failed';
  choices: (CarProtectionChoice & { id: string })[];
  error: string | null;
}

/** Session identity binds optional products to a quote, not just its search dates. */
export function carProtectionQuoteIdentity(raw: unknown, source: CarSource): string {
  const url = new URL(carProviderUrl(raw, source));
  if (source === 'discovercars') {
    const id = url.pathname.match(/^\/offer\/(?:coverage\/)?([^/]+)$/)?.[1];
    if (!id) throw new CarError('Protection evidence does not identify a rental quote');
    return JSON.stringify([source, id]);
  }
  const reference = url.searchParams.get('rate_reference');
  if (!['/en-us/options', '/en-us/checkout'].includes(url.pathname) || !reference) throw new CarError('Protection evidence does not identify a rental quote');
  for (const key of ['rate_reference', 'unique_id']) {
    if (url.searchParams.getAll(key).length > 1) throw new CarError('Protection quote identity is ambiguous');
  }
  return JSON.stringify([source, reference, url.searchParams.get('unique_id')]);
}

export function validateCarProtectionDiscovery(raw: unknown, offers: CarOffer[], now: Date): CarProtectionDiscovery[] {
  if (!Array.isArray(raw) || raw.length > offers.length || raw.length > 16) throw new CarError('Invalid protection discovery list');
  const seenOffers = new Set<string>(), seenChoices = new Set<string>();
  return raw.map(item => {
    const value = carRecord(item), offerId = carText(value.offerId, 200, 'protection offer identity');
    const matches = offers.filter(offer => offer.id === offerId);
    if (matches.length !== 1 || seenOffers.has(offerId)) throw new CarError('Protection discovery does not identify a unique returned offer');
    seenOffers.add(offerId);
    const offer = matches[0]!;
    if (value.status !== 'complete' && value.status !== 'failed') throw new CarError('Invalid protection discovery status');
    if (!Array.isArray(value.choices) || value.choices.length > 8) throw new CarError('Invalid protection choices');
    if (value.status === 'failed') {
      if (value.choices.length) throw new CarError('Failed protection discovery cannot offer choices');
      return { offerId, status: 'failed', choices: [], error: carText(value.error, 1000, 'protection discovery error') };
    }
    if (value.error !== null) throw new CarError('Complete protection discovery cannot contain an error');
    const products = new Set<string>();
    const choices = value.choices.map(rawChoice => {
      const choice = validateCarProtectionChoice(rawChoice, now), id = carText(carRecord(rawChoice).id, 36, 'protection choice identity');
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id) || seenChoices.has(id) || products.has(choice.productId)) throw new CarError('Duplicate or invalid protection choice identity');
      seenChoices.add(id); products.add(choice.productId);
      const age = Date.parse(choice.observedAt) - Date.parse(offer.observedAt);
      if (choice.source !== offer.contract.source || age < 0 || age > 300_000
        || carProtectionQuoteIdentity(choice.sourceUrl, choice.source) !== carProtectionQuoteIdentity(offer.bookingUrl, offer.contract.source)) {
        throw new CarError('Protection choice belongs to another rental observation');
      }
      return { ...choice, id };
    });
    return { offerId, status: 'complete', choices, error: null };
  });
}

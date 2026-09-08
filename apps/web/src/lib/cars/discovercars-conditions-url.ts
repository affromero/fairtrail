import { carProviderUrl } from './offer-validation';
import { CarError } from './types';

export function verifyDiscoverCarsConditionsUrl(raw: string, offerId: string): string {
  const url = new URL(carProviderUrl(raw, 'discovercars'));
  const match = url.pathname.match(/^\/en\/car-offer\/rental-conditions\/([0-9a-f-]{36})\/([A-Za-z0-9]+)$/i);
  if (!match || `${match[1]}-${match[2]}` !== offerId) throw new CarError('Rental conditions belong to a different quote');
  return url.href;
}

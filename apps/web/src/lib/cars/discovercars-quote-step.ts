import type { Page } from 'playwright';
import { carProviderUrl } from './offer-validation';
import { discoverCarsOfferFromScripts } from './discovercars-rendered';
import { CarError } from './types';

/** Later steps may omit sq; their exact quote identity and original rendered contract must survive. */
export async function verifyDiscoverCarsQuoteStep(page: Page, quoteUrl: string, step: 'coverage' | 'extras', offer: Record<string, unknown>): Promise<void> {
  const original = new URL(carProviderUrl(quoteUrl, 'discovercars'));
  const offerId = original.pathname.match(/^\/offer\/([^/]+)$/)?.[1];
  const current = new URL(carProviderUrl(page.url(), 'discovercars'));
  if (!offerId || offer.offerId !== offerId || current.pathname !== `/offer/${step}/${offerId}` || (current.searchParams.has('sq') && current.searchParams.get('sq') !== original.searchParams.get('sq'))) throw new CarError('Provider changed the rental quote during option selection');
  const rendered = discoverCarsOfferFromScripts(await page.locator('script:not([src])').allTextContents(), offerId);
  if (page.url() !== current.href) throw new CarError('Provider changed the rental quote during option capture');
  if (JSON.stringify(rendered) !== JSON.stringify(offer)) throw new CarError('Provider changed the rental contract during option selection');
}

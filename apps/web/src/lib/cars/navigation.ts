import type { Page } from 'playwright';
import { guardTravelNavigation } from '../travel/navigation';
import { carProviderUrl } from './offer-validation';
import type { CarSource } from './types';

export async function prepareCarPage(page: Page, source: CarSource) {
  page.setDefaultTimeout(20_000);
  page.setDefaultNavigationTimeout(45_000);
  return guardTravelNavigation(page, `car:${source}`, url => {
    try { carProviderUrl(url.href, source); return true; } catch { return false; }
  });
}

export async function navigateCarPage(page: Page, url: string, source: CarSource): Promise<void> {
  const guard = await prepareCarPage(page, source);
  guard.reset();
  const response = await page.goto(carProviderUrl(url, source), { waitUntil: 'domcontentloaded' });
  if (!response) throw new Error('Provider did not return a page');
  await guard.settle();
  carProviderUrl(page.url(), source);
}

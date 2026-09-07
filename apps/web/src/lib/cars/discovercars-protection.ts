import type { Page } from 'playwright';
import { carRecord, carText } from './validation';
import { navigateCarPage, prepareCarPage } from './navigation';
import { discoverCarsOfferFromScripts } from './discovercars-rendered';
import { CarError } from './types';
import { captureDiscoverCarsPriceLines, type DiscoverCarsPriceLine } from './discovercars-price-lines';

export interface DiscoverCarsProtection {
  offerId: string;
  productId: string;
  name: string;
  price: unknown;
  selected: boolean;
  terms: string;
  visibleTotal: string;
  priceLines: DiscoverCarsPriceLine[];
  observedAt: string;
}

/** Selects a priced option only; never continues to driver details or payment. */
export async function captureDiscoverCarsProtection(page: Page, quoteUrl: string, productId: string): Promise<DiscoverCarsProtection> {
  await navigateCarPage(page, quoteUrl, 'discovercars');
  const offerId = new URL(page.url()).pathname.split('/').at(-1)!;
  const guard = await prepareCarPage(page, 'discovercars');
  const next = page.locator('.OfferPriceBreakdown-BookNow:not(.Button_isDisabled):visible, .OfferDetails-BookNow:not(.Button_isDisabled):visible').first();
  await next.waitFor();
  guard.reset();
  await next.click();
  await page.waitForURL(url => url.pathname === `/offer/coverage/${offerId}`);
  await guard.settle();
  const raw = discoverCarsOfferFromScripts(await page.locator('script:not([src])').allTextContents(), offerId);
  const coverage = carRecord(raw.coverage);
  if (String(coverage.id) !== productId) throw new CarError('Requested protection product is not offered for this rental');
  const choice = page.getByRole('button', { name: /^Book with coverage .+/ });
  await choice.click();
  await page.waitForFunction(() => document.querySelector('.CoverageOptions-Card_isSelected')?.textContent?.includes('Book with coverage'));
  const name = carText(coverage.name, 200, 'protection product name');
  const summary = page.locator('.OfferPriceBreakdown:visible').first();
  await summary.locator('.OfferPriceBreakdown-Extra').filter({ hasText: name }).waitFor();
  const visibleTotal = await summary.locator('.OfferPriceBreakdown-AmountPriceBlock').innerText();
  const priceLines = await captureDiscoverCarsPriceLines(summary);
  await page.locator('.CoverageHero-LearnMore:visible').click();
  const modal = page.locator('.CoverageLearnMoreModal-Modal:visible');
  await modal.waitFor();
  await modal.locator('.CoverageLearnMoreModal-NotCoveredSection').waitFor({ state: 'visible' });
  const parts = await modal.locator('.CoverageLearnMoreModal-CoveredSection, .CoverageLearnMoreModal-NotCoveredSection, .CoverageLearnMoreModal-AdditionalInfoSection, .CoverageLearnMoreModal-ProviderSection, .CoverageLearnMoreModal-Disclaimer').allInnerTexts();
  const links = await page.locator('.CoverageLearnMoreModal-Modal:visible a[href], .CoverageBreakdownDisclaimer a[href]').evaluateAll(elements => elements.map(element => (element as HTMLAnchorElement).href));
  const policyLinks = links.filter(link => {
    const url = new URL(link);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && ['www.sincerainsurance.com', 'www.discovercars.com'].includes(url.hostname);
  }).sort();
  const terms = [...parts, ...policyLinks].join(' ').replace(/\s+/g, ' ').trim();
  if (new URL(page.url()).pathname !== `/offer/coverage/${offerId}`) throw new CarError('Protection page changed to another quote');
  return { offerId, productId, name, price: coverage.price, selected: await choice.getAttribute('aria-pressed') === 'true', terms, visibleTotal, priceLines, observedAt: new Date().toISOString() };
}

import type { Page } from 'playwright';
import { carRecord, carText } from './validation';
import { navigateCarPage, prepareCarPage } from './navigation';
import { discoverCarsOfferFromScripts } from './discovercars-rendered';
import { CarError } from './types';
import { captureDiscoverCarsPriceLines, verifyDiscoverCarsPriceSnapshot, type DiscoverCarsPriceLine } from './discovercars-price-lines';
import { parseCarMoney } from './money';
import { validateCarProtectionChoice, type CarProtectionChoice } from './protection-choice';
import { carProviderUrl } from './offer-validation';
import { verifyDiscoverCarsExtraSelection, type DiscoverCarsExtrasCapture } from './discovercars-extras';

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

async function openProtection(page: Page, quoteUrl: string, localExtras?: DiscoverCarsExtrasCapture) {
  const requested = new URL(carProviderUrl(quoteUrl, 'discovercars'));
  const offerId = requested.pathname.match(/^\/offer\/([^/]+)$/)?.[1];
  if (!offerId) throw new CarError('Expected the requested rental quote');
  if (!localExtras) await navigateCarPage(page, quoteUrl, 'discovercars');
  const current = new URL(carProviderUrl(page.url(), 'discovercars'));
  if (current.pathname !== requested.pathname || current.searchParams.get('sq') !== requested.searchParams.get('sq')) {
    throw new CarError('Protection page changed to another quote');
  }
  if (localExtras) {
    if (localExtras.offerId !== offerId) throw new CarError('Local extras belong to another protection quote');
    await verifyDiscoverCarsExtraSelection(page, localExtras.selections);
  }
  const state = await openDiscoverCarsCoverage(page, quoteUrl);
  if (localExtras) await verifyDiscoverCarsPriceSnapshot(page.locator('.OfferPriceBreakdown:visible').first(), localExtras);
  return state;
}

/** Continues from the current quote without reloading or discarding selected options. */
export async function openDiscoverCarsCoverage(page: Page, quoteUrl: string) {
  const requested = new URL(carProviderUrl(quoteUrl, 'discovercars'));
  const offerId = requested.pathname.match(/^\/offer\/([^/]+)$/)?.[1];
  const current = new URL(carProviderUrl(page.url(), 'discovercars'));
  if (!offerId || current.pathname !== requested.pathname || current.searchParams.get('sq') !== requested.searchParams.get('sq')) throw new CarError('Protection page changed to another quote');
  const guard = await prepareCarPage(page, 'discovercars');
  const next = page.locator('.OfferPriceBreakdown-BookNow:not(.Button_isDisabled):visible, .OfferDetails-BookNow:not(.Button_isDisabled):visible').first();
  await next.waitFor();
  guard.reset();
  await next.click();
  await page.waitForURL(url => url.pathname === `/offer/coverage/${offerId}`);
  await guard.settle();
  return readCurrentProtection(page, quoteUrl);
}

async function readCurrentProtection(page: Page, quoteUrl: string) {
  const requested = new URL(carProviderUrl(quoteUrl, 'discovercars'));
  const offerId = requested.pathname.match(/^\/offer\/([^/]+)$/)?.[1];
  const current = new URL(carProviderUrl(page.url(), 'discovercars'));
  if (!offerId || current.pathname !== `/offer/coverage/${offerId}` || (current.searchParams.has('sq') && current.searchParams.get('sq') !== requested.searchParams.get('sq'))) throw new CarError('Protection page changed to another quote');
  const raw = discoverCarsOfferFromScripts(await page.locator('script:not([src])').allTextContents(), offerId);
  const coverage = carRecord(raw.coverage);
  const choice = page.getByRole('button', { name: /^Book with coverage .+/ });
  await choice.waitFor({ state: 'visible' });
  if (!(await choice.isEnabled())) throw new CarError('Protection cannot be selected for this rental');
  return { offerId, coverage, choice };
}

async function protectionTerms(page: Page, offerId: string) {
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
  return { terms, policyLinks: [...new Set(policyLinks)] };
}

/** Reads the offered product and exclusions without selecting protection. */
export async function discoverDiscoverCarsProtection(page: Page, quoteUrl: string): Promise<CarProtectionChoice> {
  const { offerId, coverage, choice } = await openProtection(page, quoteUrl);
  if (await choice.getAttribute('aria-pressed') !== 'false') throw new CarError('Protection was not unselected before discovery');
  const rate = carRecord(coverage.price);
  if (typeof rate.period !== 'number' && typeof rate.period !== 'string') throw new CarError('Protection rental-period price is missing');
  const { terms, policyLinks } = await protectionTerms(page, offerId);
  if (await choice.getAttribute('aria-pressed') !== 'false') throw new CarError('Protection selection changed during discovery');
  return validateCarProtectionChoice({ source: 'discovercars', productId: String(coverage.id), name: coverage.name,
    termsSummary: terms, policyLinks, observedExtraPrice: parseCarMoney(String(rate.period), carText(rate.currency, 3, 'protection currency')),
    sourceUrl: page.url(), observedAt: new Date().toISOString() });
}

/** Selects a priced option only; never continues to driver details or payment. */
export async function captureDiscoverCarsProtection(page: Page, quoteUrl: string, productId: string, localExtras?: DiscoverCarsExtrasCapture): Promise<DiscoverCarsProtection> {
  await openProtection(page, quoteUrl, localExtras);
  return captureDiscoverCarsCurrentProtection(page, quoteUrl, productId);
}

export async function captureDiscoverCarsCurrentProtection(page: Page, quoteUrl: string, productId: string): Promise<DiscoverCarsProtection> {
  const { offerId, coverage, choice } = await readCurrentProtection(page, quoteUrl);
  if (String(coverage.id) !== productId) throw new CarError('Requested protection product is not offered for this rental');
  await choice.click();
  await page.waitForFunction(() => document.querySelector('.CoverageOptions-Card_isSelected')?.textContent?.includes('Book with coverage'));
  const name = carText(coverage.name, 200, 'protection product name');
  const summary = page.locator('.OfferPriceBreakdown:visible').first();
  await summary.locator('.OfferPriceBreakdown-Extra').filter({ hasText: name }).waitFor();
  const visibleTotal = await summary.locator('.OfferPriceBreakdown-AmountPriceBlock').innerText();
  const priceLines = await captureDiscoverCarsPriceLines(summary);
  const { terms } = await protectionTerms(page, offerId);
  return { offerId, productId, name, price: coverage.price, selected: await choice.getAttribute('aria-pressed') === 'true', terms, visibleTotal, priceLines, observedAt: new Date().toISOString() };
}

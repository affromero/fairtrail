import type { Page } from 'playwright';
import { carProviderUrl } from './offer-validation';
import { navigateCarPage, prepareCarPage } from './navigation';
import { verifyCarProviderContext } from './provider-context';
import { discoverCarsOfferFromScripts } from './discovercars-rendered';
import { CarError, type CarEvidence, type CarSearch } from './types';
import { verifyDiscoverCarsConditionsUrl } from './discovercars-conditions-url';
import { captureDiscoverCarsProtection, type DiscoverCarsProtection } from './discovercars-protection';
import { captureDiscoverCarsPriceLines, type DiscoverCarsPriceLine } from './discovercars-price-lines';
import { captureDiscoverCarsExtras, type DiscoverCarsExtrasCapture } from './discovercars-extras';

const guardedPages = new WeakSet<Page>();

export async function prepareDiscoverCarsPage(page: Page): Promise<void> {
  await prepareCarPage(page, 'discovercars');
  if (guardedPages.has(page)) return;
  await page.route('**/*', async route => {
    const request = route.request();
    if (!request.isNavigationRequest() || request.frame() === page.mainFrame()) return route.fallback();
    const element = await request.frame().frameElement().catch(() => null);
    if (!element) return route.abort('blockedbyclient');
    const rentalConditions = await element.evaluate(node => node instanceof Element && Boolean(node.closest('.IframeRentalConditions-Iframe')));
    if (!rentalConditions) return route.fallback();
    const offerId = new URL(page.url()).pathname.split('/').at(-1)!;
    try { verifyDiscoverCarsConditionsUrl(request.url(), offerId); }
    catch { return route.abort('blockedbyclient'); }
    if (request.method() !== 'GET') return route.abort('blockedbyclient');
    const response = await route.fetch({ maxRedirects: 0, timeout: 20_000 }).catch(() => null);
    if (!response || response.status() < 200 || response.status() >= 300) return route.abort('blockedbyclient');
    return route.fulfill({ response });
  });
  guardedPages.add(page);
}

export interface DiscoverCarsCapture {
  url: string;
  observedAt: string;
  offer: Record<string, unknown>;
  selectable: boolean;
  currencyContext: CarEvidence<string>;
  visibleModel: string;
  visibleModelBasis: string;
  visibleInclusions: string[];
  visibleSupplier: string;
  visibleTotal: string;
  priceLines: DiscoverCarsPriceLine[];
  visiblePickup: string;
  visibleDropoff: string;
  sections: { title: string; text: string }[];
  protection: DiscoverCarsProtection | null;
  localExtras?: DiscoverCarsExtrasCapture | { error: string } | null;
}

/** Inspects the quote and supplier conditions without supplying any booking details. */
export async function captureDiscoverCarsDetail(page: Page, url: string, search: CarSearch, searchPage: Page): Promise<DiscoverCarsCapture> {
  verifyCarProviderContext(searchPage.url(), 'discovercars', search);
  const currency = (await searchPage.getByRole('button', { name: search.currency, exact: true }).innerText()).trim();
  const currencyContext: CarEvidence<string> = { value: currency, status: 'confirmed', text: `Selected search currency: ${currency}`, sourceUrl: searchPage.url(), observedAt: new Date().toISOString() };
  await prepareDiscoverCarsPage(page);
  await navigateCarPage(page, url, 'discovercars');
  verifyCarProviderContext(page.url(), 'discovercars', search);
  const conditionsButton = page.getByRole('button', { name: 'See all rental conditions', exact: true });
  await conditionsButton.waitFor();
  const continuation = page.locator('.OfferPriceBreakdown-BookNow:not(.Button_isDisabled):visible, .OfferDetails-BookNow:not(.Button_isDisabled):visible').first();
  await continuation.waitFor({ state: 'visible' });
  const selectable = await continuation.isEnabled();
  const scripts = await page.locator('script:not([src])').allTextContents();
  const offer = discoverCarsOfferFromScripts(scripts, new URL(page.url()).pathname.split('/').at(-1)!);
  const summary = page.locator('.OfferPriceBreakdown:visible').first();
  const stops = page.locator('.OfferDetails-PickUpDropOffBlock > div');
  const visibleModel = (await page.locator('.CarTitle-Name:visible').first().innerText()).trim();
  const visibleModelBasis = await page.locator('.CarTitle:visible').first().innerText();
  const visibleInclusions = await page.locator('.OfferDetails-IncludedInOfferOptions:visible > div > p').allInnerTexts();
  const visibleSupplier = await page.locator('.OfferDetails-SupplierLogo:visible').first().getAttribute('alt') ?? '';
  const visibleTotal = await summary.locator('.OfferPriceBreakdown-AmountPriceBlock').innerText();
  const priceLines = await captureDiscoverCarsPriceLines(summary);
  const visiblePickup = await stops.nth(0).innerText(), visibleDropoff = await stops.nth(1).innerText();
  await conditionsButton.click();
  const iframe = page.locator('.IframeRentalConditions-Iframe iframe');
  await iframe.waitFor();
  const frame = page.frameLocator('.IframeRentalConditions-Iframe iframe');
  await frame.locator('[data-section="document"]').waitFor();
  const element = await iframe.elementHandle();
  const actualFrame = await element?.contentFrame();
  verifyDiscoverCarsConditionsUrl(actualFrame?.url() ?? '', String(offer.offerId));
  const expand = frame.getByText('Show more information', { exact: true });
  if (await expand.isVisible()) await expand.click();
  const headers = frame.locator('.car-detail-terms > [data-section]');
  const count = await headers.count();
  if (count > 30) throw new Error('Provider returned too many rental condition sections');
  const sections: DiscoverCarsCapture['sections'] = [];
  for (let index = 0; index < count; index++) {
    const header = headers.nth(index);
    const body = header.locator('..').locator(':scope > .car-detail-terms-body-v2').first();
    if (!(await header.count()) || !(await body.count())) continue;
    if (!(await body.isVisible())) await header.click();
    await body.waitFor({ state: 'visible' });
    sections.push({ title: await header.getAttribute('data-section') ?? '', text: (await body.innerText()).replace(/\s+/g, ' ').trim() });
  }
  verifyDiscoverCarsConditionsUrl(actualFrame?.url() ?? '', String(offer.offerId));
  carProviderUrl(page.url(), 'discovercars');
  const quoteUrl = page.url();
  let localExtras: DiscoverCarsCapture['localExtras'] = null;
  if (search.extras.childSeats.length || search.extras.additionalDrivers.length) {
    try {
      await navigateCarPage(page, quoteUrl, 'discovercars');
      await conditionsButton.waitFor();
      const currentOffer = discoverCarsOfferFromScripts(await page.locator('script:not([src])').allTextContents(), String(offer.offerId));
      if (JSON.stringify(currentOffer) !== JSON.stringify(offer)) throw new CarError('Rental quote changed before local-extra selection; refresh the search');
      localExtras = await captureDiscoverCarsExtras(page, quoteUrl, search, offer.extras);
    } catch (error) {
      if (!(error instanceof CarError)) throw error;
      localExtras = { error: error.message };
    }
  }
  const selectedProtection = search.extras.protection.find(item => item.source === 'discovercars');
  const protection = selectedProtection && !(localExtras && 'error' in localExtras) ? await captureDiscoverCarsProtection(page, quoteUrl, selectedProtection.productId, localExtras && 'selections' in localExtras ? localExtras : undefined) : null;
  return { url: quoteUrl, observedAt: new Date().toISOString(), offer, selectable, currencyContext, visibleModel, visibleModelBasis, visibleInclusions, visibleSupplier, visibleTotal, priceLines, visiblePickup, visibleDropoff, sections, protection, localExtras };
}

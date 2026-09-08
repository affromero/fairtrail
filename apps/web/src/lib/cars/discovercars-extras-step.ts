import type { Page, Route } from 'playwright';
import { CarError, type CarSearch } from './types';
import { openDiscoverCarsCoverage, captureDiscoverCarsCurrentProtection } from './discovercars-protection';
import { captureDiscoverCarsExtrasStep } from './discovercars-extras';
import { verifyDiscoverCarsQuoteStep } from './discovercars-quote-step';
import { verifyDiscoverCarsPriceSnapshot, type DiscoverCarsPriceLine } from './discovercars-price-lines';
import { prepareCarPage } from './navigation';

/** Follows the observed coverage → extras flow and stops before driver details. */
export async function captureDiscoverCarsSeparateExtras(page: Page, quoteUrl: string, search: CarSearch, offer: Record<string, unknown>, baseline: { visibleTotal: string; priceLines: DiscoverCarsPriceLine[] }) {
  const original = new URL(quoteUrl), id = original.pathname.match(/^\/offer\/([^/]+)$/)?.[1];
  if (!id) throw new CarError('Expected the original rental quote');
  let blocked = false;
  const guardRoute = async (route: Route) => {
    const request = route.request(), target = new URL(request.url());
    const mainNavigation = request.isNavigationRequest() && request.frame() === page.mainFrame();
    const offerRequest = target.origin === original.origin && target.pathname.startsWith('/offer/');
    if (!mainNavigation && !offerRequest) return route.fallback();
    const sameContext = !target.searchParams.has('sq') || target.searchParams.get('sq') === original.searchParams.get('sq');
    if (target.origin !== original.origin || request.method() !== 'GET' || ![`/offer/coverage/${id}`, `/offer/extras/${id}`].includes(target.pathname) || !sameContext) {
      const driverPrefetch = !request.isNavigationRequest() && request.resourceType() === 'fetch' && request.method() === 'GET'
        && target.origin === original.origin && target.pathname === `/offer/driver/${id}` && sameContext && request.headers()['next-router-prefetch'] === '1';
      // The provider speculatively loads its driver link. Block it without mistaking it for a user transition.
      if (!driverPrefetch) blocked = true;
      await route.abort('blockedbyclient');
      return;
    }
    await route.fallback();
  };
  const pattern = '**/*';
  await page.route(pattern, guardRoute);
  try {
    const result = await captureSeparateExtras(page, quoteUrl, search, offer, baseline, () => blocked);
    if (blocked) throw new CarError('Provider attempted an unexpected booking step');
    return result;
  } catch (error) {
    if (blocked) throw new CarError('Provider attempted an unexpected booking step');
    throw error;
  } finally {
    await page.unroute(pattern, guardRoute);
  }
}

async function waitForExtrasTransition(page: Page, offerId: string, blocked: () => boolean, allowDecline: boolean): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (blocked()) throw new CarError('Provider attempted an unexpected booking step');
    if (page.isClosed()) throw new CarError('Rental option review was cancelled');
    if (new URL(page.url()).pathname === `/offer/extras/${offerId}`) return;
    if (allowDecline && await page.locator('.CoverageCta-Button_isInPopup:visible').filter({ hasText: /^No, I'll take the risk$/ }).isVisible()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new CarError('Provider did not finish opening the requested extras step');
}

async function captureSeparateExtras(page: Page, quoteUrl: string, search: CarSearch, offer: Record<string, unknown>, baseline: { visibleTotal: string; priceLines: DiscoverCarsPriceLine[] }, blocked: () => boolean) {
  const { offerId, choice } = await openDiscoverCarsCoverage(page, quoteUrl);
  await verifyDiscoverCarsQuoteStep(page, quoteUrl, 'coverage', offer);
  const nextStep = page.locator('.Steps-Next:visible');
  if (await nextStep.count() !== 1 || (await nextStep.innerText()).trim() !== 'Next: Extras') throw new CarError('Provider did not offer the verified separate extras sequence');
  if (await choice.getAttribute('aria-pressed') !== 'false') throw new CarError('Provider added protection before selection');
  const summary = page.locator('.OfferPriceBreakdown:visible').first();
  await verifyDiscoverCarsPriceSnapshot(summary, baseline);
  const selected = search.extras.protection.find(item => item.source === 'discovercars');
  const protection = selected ? await captureDiscoverCarsCurrentProtection(page, quoteUrl, selected.productId) : null;
  if (protection) {
    await page.locator('.CoverageLearnMoreModal-Modal:visible .Modal-CloseBtn').click();
    await page.locator('.CoverageLearnMoreModal-Modal').waitFor({ state: 'hidden' });
  } else {
    const without = page.getByRole('button', { name: /^Book without coverage/ });
    await without.click();
    if (await without.getAttribute('aria-pressed') !== 'true') throw new CarError('Provider did not retain the declined coverage selection');
  }
  await verifyDiscoverCarsQuoteStep(page, quoteUrl, 'coverage', offer);
  await verifyDiscoverCarsPriceSnapshot(summary, protection ?? baseline);
  if ((await nextStep.innerText()).trim() !== 'Next: Extras' || await choice.getAttribute('aria-pressed') !== String(Boolean(protection))) throw new CarError('Provider changed the coverage selection or next step');
  const guard = await prepareCarPage(page, 'discovercars');
  guard.reset();
  const continuation = page.locator('.OfferPriceBreakdown-BookNow:visible').first();
  if ((await continuation.innerText()).trim() !== 'Continue') throw new CarError('Provider changed the extras continuation control');
  await continuation.click();
  if (!protection) {
    const decline = page.locator('.CoverageCta-Button_isInPopup:visible').filter({ hasText: /^No, I'll take the risk$/ });
    await waitForExtrasTransition(page, offerId, blocked, true);
    if (await decline.isVisible()) {
      await verifyDiscoverCarsQuoteStep(page, quoteUrl, 'coverage', offer);
      await decline.click();
    }
  }
  await waitForExtrasTransition(page, offerId, blocked, false);
  await guard.settle();
  await page.locator('.OfferDetailsExtras-Extras_StepMode:visible').waitFor();
  await verifyDiscoverCarsQuoteStep(page, quoteUrl, 'extras', offer);
  await verifyDiscoverCarsPriceSnapshot(summary, protection ?? baseline);
  const localExtras = await captureDiscoverCarsExtrasStep(page, quoteUrl, search, offer);
  return { protection, localExtras };
}

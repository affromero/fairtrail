import type { Browser, BrowserContext, BrowserContextOptions, Page } from 'playwright';
import { closeTravelBrowser, currentTravelExecution, TravelCleanupError } from '../travel/execution';
import { CarError, type CarSearch } from './types';
import { CarQuoteFailure, providerFailure } from './provider-failure';

export function createCarBrowserContext(browser: Browser, search: CarSearch, storageState?: BrowserContextOptions['storageState']) {
  return browser.newContext({ locale: 'en-US', timezoneId: search.pickup.timeZone, viewport: { width: 1440, height: 1000 }, storageState });
}

/** Recheck from the pre-selection state without inheriting or clearing another quote's choices. */
export async function withCarQuoteContext<T>(original: Page, search: CarSearch, storageState: Awaited<ReturnType<BrowserContext['storageState']>>, work: (page: Page) => Promise<T>): Promise<T> {
  const browser = original.context().browser();
  if (!browser) throw new CarError('Rental quote review requires its owned browser');
  const context = await createCarBrowserContext(browser, search, storageState);
  let primaryError: unknown;
  let page: Page | undefined;
  try { page = await context.newPage(); return await work(page); }
  catch (error) {
    primaryError = error;
    currentTravelExecution()?.check();
    if (error instanceof TravelCleanupError) throw error;
    throw new CarQuoteFailure(await providerFailure(error, page, 'discovercars'), error);
  }
  finally { await closeTravelBrowser(context, primaryError); }
}

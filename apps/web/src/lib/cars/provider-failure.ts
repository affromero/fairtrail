import type { Page } from 'playwright';
import { prepareCarPage } from './navigation';
import { CarError, type CarSource } from './types';

interface CarProviderFailure { message: string; terminal: boolean; blocked: boolean }

export class CarQuoteFailure extends Error {
  constructor(readonly failure: CarProviderFailure, cause: unknown) {
    super(failure.message, { cause });
    this.name = 'CarQuoteFailure';
  }
}

export async function providerFailure(error: unknown, page: Page | undefined, source: CarSource): Promise<CarProviderFailure> {
  if (error instanceof CarQuoteFailure) return error.failure;
  const status = page && !page.isClosed() ? (await prepareCarPage(page, source)).status() : 0;
  const text = page && !page.isClosed() ? await page.locator('body').innerText({ timeout: 1000 }).catch(() => '') : '';
  const blocked = status === 403 || status === 429 || /verify (?:that )?you are human|unusual traffic|complete the captcha|access denied/i.test(text);
  if (blocked) return { message: 'Provider blocked automated access or rate-limited this search; no further offers were requested', terminal: true, blocked: true };
  if (status >= 500) return { message: `Provider returned HTTP ${status}; this check could not finish`, terminal: true, blocked: false };
  return { message: error instanceof CarError ? error.message : 'The provider quote could not be verified; no estimated price was substituted', terminal: false, blocked: false };
}

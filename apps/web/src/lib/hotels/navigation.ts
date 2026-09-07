import type { Page } from 'playwright';
import type { HotelSource } from './types';
import { guardTravelNavigation } from '../travel/navigation';

export async function navigateHotelPage(page: Page, url: string, source: HotelSource) {
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(45000);
  const providerHost = source === 'booking' ? 'www.booking.com' : 'www.google.com';
  const allowed = (destination: URL) => destination.protocol === 'https:' && !destination.port && !destination.username && !destination.password
    && (destination.hostname === providerHost || (source === 'google_hotels' && destination.hostname === 'consent.google.com'));
  const guard = await guardTravelNavigation(page, `hotel:${source}`, allowed);
  guard.reset();
  const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (!response || response.status() >= 400) throw new Error(`${source} returned HTTP ${response?.status() ?? 'unknown'}`);
  await page.locator('body').waitFor({ state: 'visible' });
  await page.waitForTimeout(5000);
  await guard.settle();
  const consentPage = source === 'google_hotels' && new URL(page.url()).hostname === 'consent.google.com';
  const reject = page.getByRole('button', { name: /^Reject all$/i }).first();
  const accept = page.getByRole('button', { name: /^(Accept all|Accept)$/i }).first();
  const consent = await reject.isVisible() ? reject : accept;
  if (consentPage) {
    if (!(await consent.isVisible())) throw new Error('Google Hotels consent could not be completed');
    try {
      await Promise.all([
        page.waitForURL(next => next.protocol === 'https:' && next.hostname === providerHost && next.pathname.startsWith('/travel/'), { timeout: 15000, waitUntil: 'domcontentloaded' }),
        consent.click(),
      ]);
    } catch { throw new Error('Google Hotels consent did not return to hotel results'); }
  } else if (await consent.isVisible()) await consent.click();
  await guard.settle();
  const final = new URL(page.url());
  if (guard.status() >= 400) throw new Error(`${source} returned HTTP ${guard.status()}`);
  if (final.protocol !== 'https:' || final.hostname !== providerHost || final.port || (source === 'google_hotels' && !final.pathname.startsWith('/travel/'))) throw new Error(`${source} did not return to an allowed hotel page`);
}

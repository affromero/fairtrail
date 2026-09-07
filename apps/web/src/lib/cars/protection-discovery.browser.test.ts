import { afterEach, describe, expect, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import { launchBrowser } from '../scraper/browser';
import { prepareCarPage } from './navigation';
import { captureAutoEuropeProtectionChoices, extractAutoEuropeProtectionChoices } from './autoeurope-protection';
import { captureDiscoverCarsProtection, discoverDiscoverCarsProtection } from './discovercars-protection';
import { validateCarSearch } from './validation';
import type { CarSource } from './types';

let browser: Browser | undefined;
afterEach(async () => { await browser?.close(); browser = undefined; });
const location = { name: 'London Heathrow', country: 'GB', timeZone: 'Europe/London', providerIds: { autoeurope: '547' } };
const search = validateCarSearch({ pickup: location, dropoff: location,
  pickupAt: { date: '2026-10-15', time: '12:00' }, dropoffAt: { date: '2026-10-18', time: '12:00' },
  driver: { age: 35, licenceYears: 2, residenceCountry: 'GB' }, currency: 'GBP', sources: ['autoeurope'],
}, new Date('2026-09-01'));
const context = { pickup_location: '547', dropoff_location: '547', pickup_date: '2026-10-15', dropoff_date: '2026-10-18',
  pickup_time: '12:00', dropoff_time: '12:00', drivers_age: '35', residence_country: 'gb', currency: 'GBP', rate_reference: 'original' };
const autoUrl = `https://book.autoeurope.com/en-us/options?${new URLSearchParams(context)}`;

async function guardedPage(source: CarSource): Promise<Page> {
  browser = await launchBrowser();
  const page = await browser.newPage();
  await prepareCarPage(page, source);
  return page;
}

describe.skipIf(process.env.TRAVEL_BROWSER_TESTS !== '1')('headless protection discovery before selection', () => {
  it('reads only option evidence and leaves the provider selection unchanged', async () => {
    const page = await guardedPage('autoeurope');
    const data = {
      csrf_token: 'private-csrf-sentinel', booking: { email: 'private-email-sentinel' }, geo_location: 'private-location-sentinel',
      rate_rules: { search: context }, available_packages: { packages: [{ isMain: false, product: {
        code: 'ZC.GBP', name: 'Damage protection', description: 'Reimbursement subject to exclusions.',
        mandatory: false, maximum_quantity: 1, default_quantity: 0, included_in_vehicle_price: false,
        payment_type: 'Now', rental_price: { payment: { amount: 18, currency: 'GBP' } },
        unrelated_customer: 'private-product-sentinel',
      } }] },
    };
    const attribute = JSON.stringify(data).replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<div id="checkoutOptions" data-data="${attribute}"></div>
      <p id="state">No protection selected</p>
      <button data-cy="go_to_checkout_button_basic">Go To Book With Basic Plus</button>
      <button data-cy="go_to_checkout_button_ZC.GBP" onclick="document.getElementById('state').textContent='Protection selected'">Go To Book With Damage protection</button>` }));
    const capture = await captureAutoEuropeProtectionChoices(page, autoUrl, search);
    expect(extractAutoEuropeProtectionChoices(capture, search)).toMatchObject([{ productId: 'ZC.GBP', observedExtraPrice: { currency: 'GBP', minor: 1800 } }]);
    expect(await page.locator('#state').innerText()).toBe('No protection selected');
    expect(page.url()).toBe(autoUrl);
    expect(JSON.stringify(capture)).not.toMatch(/private-.*-sentinel/);
  });
  it('rejects an Auto Europe redirect to another quote with identical rental criteria', async () => {
    const page = await guardedPage('autoeurope');
    const target = autoUrl.replace('rate_reference=original', 'rate_reference=substitute');
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: route.request().url() === autoUrl
      ? `<html data-travel-redirect="pending"><script>location.replace(${JSON.stringify(target)})</script></html>`
      : '<p>Substitute rental</p>' }));
    await expect(captureAutoEuropeProtectionChoices(page, autoUrl, search)).rejects.toThrow(/another quote/);
    expect(page.url()).toBe(target);
  });
  it.each(['discover', 'select'] as const)('rejects a DiscoverCars quote redirect before %s protection', async operation => {
    const page = await guardedPage('discovercars');
    const original = 'https://www.discovercars.com/offer/original?sq=unchanged', target = original.replace('/original?', '/substitute?');
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: route.request().url() === original
      ? `<html data-travel-redirect="pending"><script>location.replace(${JSON.stringify(target)})</script></html>`
      : '<p>Substitute rental</p>' }));
    const result = operation === 'discover' ? discoverDiscoverCarsProtection(page, original) : captureDiscoverCarsProtection(page, original, '35');
    await expect(result).rejects.toThrow(/another quote/);
    expect(page.url()).toBe(target);
  });
});

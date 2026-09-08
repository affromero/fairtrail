import type { Page } from 'playwright';
import { carProviderUrl } from './offer-validation';
import { verifyCarProviderContext } from './provider-context';
import { CarError, type CarDiscovery, type CarLocation, type CarSearch } from './types';
import { navigateCarPage, prepareCarPage } from './navigation';
import { openCarControl } from './controls';

export async function navigateAutoEuropeLocation(page: Page, location: CarLocation, field: 'pickup' | 'dropoff'): Promise<void> {
  const id = location.providerIds.autoeurope;
  const name = location.providerNames?.autoeurope ?? location.name;
  if (!id) throw new CarError('Select an Auto Europe location before searching');
  const input = page.locator(`#${field}_location`);
  if (await page.locator(`form [name="${field}_location"]`).inputValue() === id) return;
  await input.fill('');
  await input.fill(name);
  const suggestions = page.locator('.list-group-item-action[data-cy]:visible');
  await suggestions.first().waitFor();
  const names = await suggestions.evaluateAll(elements => elements.map(e => e.getAttribute('data-cy')).filter((name): name is string => Boolean(name)));
  for (const suggestion of names.slice(0, 8)) {
    await page.locator('.list-group-item-action[data-cy]:visible').filter({ hasText: suggestion }).first().click();
    if (await page.locator(`form [name="${field}_location"]`).inputValue() === id) return;
    await input.fill(name);
    await suggestions.first().waitFor();
  }
  throw new CarError(`Auto Europe could not resolve the selected ${field} location`);
}

async function selectDay(page: Page, date: string): Promise<void> {
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).replace(',', '');
  for (let month = 0; month < 25; month++) {
    const day = page.getByLabel(label, { exact: true });
    if (await day.isVisible()) { await day.click(); return; }
    await page.getByLabel('Next Month', { exact: true }).click();
  }
  throw new CarError('Auto Europe did not offer the requested rental date');
}

async function selectTime(page: Page, field: 'pickup' | 'dropoff', time: string): Promise<void> {
  await page.locator(`[name="${field}_time_input"]`).click();
  const option = page.locator(`[data-cy="${field}_time_field_option"]:visible`).filter({ hasText: new RegExp(`^${time}$`) });
  if (!(await option.count())) throw new CarError('Auto Europe requires a time offered in its half-hour pickup/return selector');
  await option.click();
}

export async function navigateAutoEuropeSearch(page: Page, search: CarSearch): Promise<CarDiscovery> {
  await navigateCarPage(page, 'https://book.autoeurope.com/en-us/', 'autoeurope');
  carProviderUrl(page.url(), 'autoeurope');
  const reject = page.getByRole('button', { name: 'Reject', exact: true });
  await reject.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
  if (await reject.isVisible()) await reject.click();
  if ((await page.locator('form [name="residence_country"]').inputValue()).toUpperCase() !== search.driver.residenceCountry) {
    await openCarControl(page.locator('[data-cy="country_dropdown_toggle"]:visible'), page.locator('[data-cy="country_option"]:visible').first());
    await page.locator(`[data-cy="country_option"][data-country-code="${search.driver.residenceCountry}"]:visible`).click();
    await page.waitForFunction(country => (document.querySelector('form [name="residence_country"]') as HTMLInputElement | null)?.value === country, search.driver.residenceCountry);
    // Residence choice may change language. The explicit English page preserves
    // the selected residence cookie while keeping extraction terminology stable.
    await navigateCarPage(page, 'https://book.autoeurope.com/en-us/', 'autoeurope');
  }
  if (await page.locator('form [name="currency"]').inputValue() !== search.currency) {
    await openCarControl(page.locator('[data-cy="currency_dropdown_toggle"]:visible'), page.locator('[data-cy="currency_option"]:visible').first());
    await page.locator(`[data-cy="currency_option"][data-currency-code="${search.currency}"]:visible`).first().click();
    await page.waitForFunction(currency => (document.querySelector('form [name="currency"]') as HTMLInputElement | null)?.value === currency, search.currency);
  }
  if ((await page.locator('form [name="residence_country"]').inputValue()).toUpperCase() !== search.driver.residenceCountry) {
    throw new CarError('Auto Europe residence selection did not match the requested driver; no substitute quote was used');
  }
  // The conditional age input verifies that form event handlers are hydrated
  // before autocomplete input is entered, including repeat visits.
  if (await page.locator('#drivers_age_checkbox').isChecked()) await page.locator('label[for="drivers_age_checkbox"]').click();
  await page.locator('#drivers_age').fill(String(search.driver.age));
  await navigateAutoEuropeLocation(page, search.pickup, 'pickup');
  await navigateAutoEuropeLocation(page, search.dropoff, 'dropoff');
  await page.getByLabel('Pickup date', { exact: true }).click();
  await selectDay(page, search.pickupAt.date);
  await selectDay(page, search.dropoffAt.date);
  await selectTime(page, 'pickup', search.pickupAt.time);
  await selectTime(page, 'dropoff', search.dropoffAt.time);
  const guard = await prepareCarPage(page, 'autoeurope');
  guard.reset();
  await page.getByRole('button', { name: 'Find Your Car', exact: true }).click();
  await page.waitForURL(url => url.pathname === '/en-us/results');
  await guard.settle();
  return collectAutoEuropeOffers(page, search);
}

export async function collectAutoEuropeOffers(page: Page, search: CarSearch): Promise<CarDiscovery> {
  verifyCarProviderContext(page.url(), 'autoeurope', search);
  const offers = page.locator('a[href*="/options?rate_reference="]:visible');
  const empty = page.locator('#main [role="alert"]').getByText("Sorry, we couldn't find any available cars matching your search.", { exact: true }).filter({ visible: true });
  await offers.or(empty).first().waitFor({ timeout: 90_000 });
  verifyCarProviderContext(page.url(), 'autoeurope', search);
  if (await empty.count()) {
    if (await offers.count()) throw new CarError('Auto Europe returned conflicting availability information; no quote was substituted');
    return { links: [], discoveredVisible: 0, limit: 8, truncated: false };
  }
  const hrefs = await offers.evaluateAll(elements => elements.map(e => (e as HTMLAnchorElement).href));
  if (!hrefs.length) throw new CarError('Auto Europe offers disappeared before they could be verified');
  const unique = [...new Set(hrefs)];
  const links = unique.slice(0, 8).map(url => {
    verifyCarProviderContext(url, 'autoeurope', search);
    return carProviderUrl(url, 'autoeurope');
  });
  return { links, discoveredVisible: unique.length, limit: 8, truncated: unique.length > 8 };
}

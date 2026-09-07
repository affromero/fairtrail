import type { Locator, Page } from 'playwright';
import { CarError, type CarLocation, type CarSearch } from './types';
import { navigateCarPage, prepareCarPage } from './navigation';
import { carProviderUrl } from './offer-validation';
import { verifyCarProviderContext } from './provider-context';

/** Wait for an observable interaction, not a delay after server-rendered markup. */
async function openControl(trigger: Locator, content: Locator): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await content.isVisible()) return;
    await trigger.click();
    try { await content.waitFor({ state: 'visible', timeout: 1000 }); return; }
    catch { /* A pre-hydration click has no effect; only retry while closed. */ }
  }
  throw new CarError('DiscoverCars search controls did not become interactive');
}

async function selectOption(control: Locator, label: string): Promise<void> {
  await openControl(control.locator('.CustomSelect-SelectHandler'), control.locator('.CustomSelect-SelectOption:visible').first());
  const option = control.locator('.CustomSelect-SelectOption:visible').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) });
  if (await option.count() !== 1) throw new CarError(`DiscoverCars does not offer the requested option: ${label}`);
  await option.click();
}

function residenceName(code: string): string {
  const names: Record<string, string> = { US: 'United States of America (USA)', CZ: 'Czech Republic', RU: 'Russian Federation', TR: 'Turkey', SZ: 'Swaziland', VA: 'Vatican', VN: 'Vietnam', LA: "Lao People's Democratic Republic", KR: 'South Korea', KP: 'North Korea', CD: 'Congo, Democratic Republic of', PS: 'Palestine, State of' };
  return names[code] ?? new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
}

async function selectLocation(page: Page, location: CarLocation, field: 'PickupLocation' | 'DropoffLocation'): Promise<void> {
  if (!location.providerIds.discovercars) throw new CarError('Select a DiscoverCars location before searching');
  const input = page.locator(`input[name="${field}"]`);
  await input.fill('');
  await input.fill(location.name);
  const control = input.locator('xpath=ancestor::div[contains(@class,"SearchModifier-LocationAutocomplete")][1]');
  const options = control.locator('.Autocomplete-AutocompleteItem:visible');
  await options.first().waitFor();
  const exact = options.filter({ has: page.locator('.Autocomplete-AutocompletePlace', { hasText: new RegExp(`^${location.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
  if (await exact.count() !== 1) throw new CarError(`DiscoverCars could not unambiguously select ${location.name}`);
  await exact.click();
}

async function selectDay(page: Page, iso: string): Promise<void> {
  const date = new Date(`${iso}T12:00:00Z`);
  const monthLabel = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
  const month = page.locator('.rdrMonth').filter({ has: page.locator('.rdrMonthName', { hasText: new RegExp(`^${monthLabel}$`) }) });
  for (let step = 0; step < 25; step++) {
    if (await month.isVisible()) {
      const day = month.locator('button.rdrDay:not(.rdrDayPassive):not(.rdrDayDisabled)').filter({ hasText: new RegExp(`^${date.getUTCDate()}$`) });
      if (await day.count() !== 1) throw new CarError('DiscoverCars does not offer the requested rental date');
      await day.click();
      return;
    }
    const displayed = await page.locator('.Calendar-ThisMonth').innerText();
    const first = new Date(`1 ${displayed} 12:00:00 GMT`);
    if (!Number.isFinite(first.getTime())) throw new CarError('DiscoverCars calendar month could not be verified');
    const direction = date < first ? 'Prev' : 'Next';
    const arrow = page.locator(`.Calendar-To${direction}Month`);
    if (/Disabled/.test(await arrow.getAttribute('class') ?? '')) throw new CarError('DiscoverCars calendar does not allow the requested date');
    await arrow.click();
    await page.waitForFunction(previous => document.querySelector('.Calendar-ThisMonth')?.textContent !== previous, displayed);
  }
  throw new CarError('DiscoverCars rental date exceeds the supported calendar range');
}

/** Fills the real provider form; the submitted request is independently verified. */
export async function fillDiscoverCarsSearch(page: Page, search: CarSearch): Promise<void> {
  const age = search.driver.age;
  if ((age >= 30 && age <= 65 && age !== 35) || age > 80) {
    throw new CarError('DiscoverCars groups this age rather than preserving the exact driver age; use Auto Europe for an exact-age quote');
  }
  const currencyTrigger = page.getByRole('button', { name: /^[A-Z]{3}$/ }).filter({ visible: true }).first();
  if ((await currencyTrigger.innerText()).trim() !== search.currency) {
    const currencies = page.locator('[data-testid="currency-switcher"]:visible');
    await openControl(currencyTrigger, currencies.first());
    const currency = currencies.filter({ has: page.getByText(search.currency, { exact: true }) });
    if (!(await currency.count())) throw new CarError('DiscoverCars does not offer the requested currency');
    // Currency selection reloads the form, so set it before any rental fields.
    // Popular currencies repeat in the complete list with the same ISO code.
    const guard = await prepareCarPage(page, 'discovercars');
    guard.reset();
    await Promise.all([page.waitForEvent('domcontentloaded'), currency.first().click()]);
    await guard.settle();
    if ((await currencyTrigger.innerText()).trim() !== search.currency) throw new CarError('DiscoverCars changed the requested currency');
  }
  await selectOption(page.locator('#sb-country'), residenceName(search.driver.residenceCountry));
  await selectOption(page.locator('#sb-age'), age === 35 ? '30-65' : age === 80 ? '80+' : String(age));
  const sameLocation = search.pickup.providerIds.discovercars === search.dropoff.providerIds.discovercars;
  const same = page.locator('input[name="IsSameLocation"]');
  if (await same.isChecked() !== sameLocation) await page.getByText('Return car in same location', { exact: true }).click();
  await selectLocation(page, search.pickup, 'PickupLocation');
  if (!sameLocation) await selectLocation(page, search.dropoff, 'DropoffLocation');
  await openControl(page.locator('.DatePicker-CalendarField').first(), page.locator('.Calendar-ThisMonth'));
  await selectDay(page, search.pickupAt.date);
  await selectDay(page, search.dropoffAt.date);
  for (const [index, time] of [search.pickupAt.time, search.dropoffAt.time].entries()) {
    const label = new Date(`2000-01-01T${time}:00Z`).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).toLowerCase();
    await selectOption(page.locator('.SearchModifier-TimeSelect').nth(index), label);
  }
}

export async function submitDiscoverCarsSearch(page: Page, search: CarSearch): Promise<string[]> {
  const guard = await prepareCarPage(page, 'discovercars');
  guard.reset();
  const previousPath = new URL(page.url()).pathname;
  await page.locator('button[type="submit"]').filter({ hasText: /^Search(?: now)?$/ }).click();
  await page.waitForURL(url => url.pathname.startsWith('/search/') && url.pathname !== previousPath);
  await guard.settle();
  return collectDiscoverCarsOffers(page, search);
}

export async function collectDiscoverCarsOffers(page: Page, search: CarSearch): Promise<string[]> {
  verifyCarProviderContext(page.url(), 'discovercars', search);
  await page.getByRole('button', { name: search.currency, exact: true }).waitFor();
  const offers = page.locator('a.SearchCar-CtaBtn:visible');
  await offers.first().waitFor({ timeout: 90_000 });
  const links = await offers.evaluateAll(elements => elements.map(element => (element as HTMLAnchorElement).href));
  return [...new Set(links)].slice(0, 8).map(raw => {
    const url = new URL(carProviderUrl(raw, 'discovercars'));
    if (!/^\/offer\/[0-9a-f-]{36}-[A-Za-z0-9]+$/i.test(url.pathname)) throw new CarError('DiscoverCars returned an unexpected offer link');
    verifyCarProviderContext(url.href, 'discovercars', search);
    return url.href;
  });
}

export async function navigateDiscoverCarsSearch(page: Page, search: CarSearch): Promise<string[]> {
  await navigateCarPage(page, 'https://www.discovercars.com/', 'discovercars');
  await fillDiscoverCarsSearch(page, search);
  return submitDiscoverCarsSearch(page, search);
}

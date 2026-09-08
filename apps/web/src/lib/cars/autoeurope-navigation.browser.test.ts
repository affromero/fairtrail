import { afterEach, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { launchBrowser } from '../scraper/browser';
import { collectAutoEuropeOffers, navigateAutoEuropeLocation } from './autoeurope-navigation';
import { validateCarSearch } from './validation';

let browser: Browser | undefined;
afterEach(async () => { await browser?.close(); browser = undefined; });
const location = { name: 'Example Airport', country: 'GB', timeZone: 'Europe/London', providerIds: { autoeurope: '547' } };
const search = validateCarSearch({ pickup: location, dropoff: location, pickupAt: { date: '2026-12-30', time: '14:30' }, dropoffAt: { date: '2027-01-03', time: '09:00' }, driver: { age: 35, licenceYears: 5, residenceCountry: 'GB' }, currency: 'GBP', sources: ['autoeurope'] }, new Date('2026-09-01'));
const query = new URLSearchParams({ pickup_location: '547', dropoff_location: '547', pickup_date: '2026-12-30', pickup_time: '14:30', dropoff_date: '2027-01-03', dropoff_time: '09:00', drivers_age: '35', residence_country: 'GB', currency: 'GBP' });
const resultsUrl = `https://book.autoeurope.com/en-us/results?${query}`;
const offerUrl = `https://book.autoeurope.com/en-us/options?rate_reference=example&${query}`;
const emptyMarkup = `<div role="alert"><h4>Sorry, we couldn't find any available cars matching your search.</h4></div>`;

describe.skipIf(process.env.TRAVEL_BROWSER_TESTS !== '1')('Auto Europe result availability in Chromium', () => {
  async function results(markup: string) {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: markup }));
    await page.goto(resultsUrl);
    return page;
  }
  it('returns an empty checked result only for the visible provider availability alert', async () => {
    const page = await results(`<main id="main">${emptyMarkup}</main>`);
    expect(await collectAutoEuropeOffers(page, search)).toEqual({ links: [], discoveredVisible: 0, limit: 8, truncated: false });
  });
  it('ignores hidden and unrelated empty text while waiting for delayed offers', async () => {
    const page = await results(`${emptyMarkup}<main id="main"><div hidden>${emptyMarkup}</div></main>`);
    const pending = collectAutoEuropeOffers(page, search);
    await page.evaluate(url => setTimeout(() => {
      const link = document.createElement('a'); link.href = url; link.textContent = 'View deal'; document.querySelector('#main')!.append(link);
    }, 150), offerUrl);
    expect(await pending).toEqual({ links: [offerUrl], discoveredVisible: 1, limit: 8, truncated: false });
  });
  it('rejects contradictory empty and available results', async () => {
    const page = await results(`<main id="main">${emptyMarkup}<a href="${offerUrl}">View deal</a></main>`);
    await expect(collectAutoEuropeOffers(page, search)).rejects.toThrow(/conflicting availability/);
  });
  it('rejects a changed location when the empty response arrives', async () => {
    const page = await results('<main id="main">Loading</main>');
    const pending = expect(collectAutoEuropeOffers(page, search)).rejects.toThrow(/pickup/);
    await page.evaluate(markup => setTimeout(() => {
      const url = new URL(window.location.href); url.searchParams.set('pickup_location', '999'); history.replaceState(null, '', url);
      document.querySelector('#main')!.innerHTML = markup;
    }, 150), emptyMarkup);
    await pending;
  });
  it('does not convert an interrupted unexpected page into empty availability', async () => {
    const page = await results('<main id="main">Please verify your browser</main>');
    const pending = expect(collectAutoEuropeOffers(page, search)).rejects.toThrow();
    await page.close();
    await pending;
  });
});

describe.skipIf(process.env.TRAVEL_BROWSER_TESTS !== '1')('Auto Europe restored form selections in Chromium', () => {
  async function pageWithSelection(field: 'pickup' | 'dropoff', selectedId: string) {
    browser = await launchBrowser();
    const page = await browser.newPage();
    page.setDefaultTimeout(2000);
    await page.setContent(`<form>
      <input id="${field}_location" value="Example Airport">
      <input type="hidden" name="${field}_location" value="${selectedId}">
      <div id="suggestions"></div>
    </form><script>
      const input = document.querySelector('input:not([type=hidden])');
      const selected = document.querySelector('input[type=hidden]');
      const suggestions = document.getElementById('suggestions');
      input.addEventListener('input', () => {
        selected.value = ''; suggestions.replaceChildren();
        if (!input.value) return;
        const option = document.createElement('button'); option.type = 'button';
        option.className = 'list-group-item-action'; option.dataset.cy = 'Example Airport';
        option.textContent = 'Example Airport';
        option.addEventListener('click', () => { selected.value = '547'; input.value = 'Example Airport'; suggestions.replaceChildren(); });
        suggestions.append(option);
      });
    </script>`);
    return page;
  }
  it('accepts a restored matching location without requiring an autocomplete dropdown', async () => {
    const page = await pageWithSelection('pickup', '547');
    await navigateAutoEuropeLocation(page, location, 'pickup');
    expect(await page.locator('input[name=pickup_location]').inputValue()).toBe('547');
    expect(await page.locator('#pickup_location').inputValue()).toBe('Example Airport');
  });
  it('reselects an identically named location when the restored provider ID differs', async () => {
    const page = await pageWithSelection('pickup', '999');
    await navigateAutoEuropeLocation(page, location, 'pickup');
    expect(await page.locator('input[name=pickup_location]').inputValue()).toBe('547');
  });
  it('replaces a restored one-way dropoff with the requested same-airport return', async () => {
    const page = await pageWithSelection('dropoff', '548');
    await navigateAutoEuropeLocation(page, location, 'dropoff');
    expect(await page.locator('input[name=dropoff_location]').inputValue()).toBe('547');
  });
});

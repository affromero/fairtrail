import { afterEach, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { launchBrowser } from '../scraper/browser';
import { navigateAutoEuropeLocation } from './autoeurope-navigation';

let browser: Browser | undefined;
afterEach(async () => { await browser?.close(); browser = undefined; });
const location = { name: 'Example Airport', country: 'GB', timeZone: 'Europe/London', providerIds: { autoeurope: '547' } };

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

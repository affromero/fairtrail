import { describe, expect, it } from 'vitest';
import { launchBrowser } from '../scraper/browser';
import { openCarControl } from './controls';

describe.skipIf(process.env.TRAVEL_BROWSER_TESTS !== '1')('provider controls becoming interactive', () => {
  it('opens a currency menu whose handler appears after its markup', async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent(`<button id="toggle">Currency</button><div id="menu" hidden><button id="usd">US Dollar USD</button></div><output id="selected">GBP</output>
        <script>setTimeout(() => {
          document.getElementById('toggle').onclick = () => { document.getElementById('menu').hidden = !document.getElementById('menu').hidden; };
          document.getElementById('usd').onclick = () => { document.getElementById('selected').textContent = 'USD'; };
        }, 150);</script>`);
      await openCarControl(page.locator('#toggle'), page.locator('#usd'));
      await page.locator('#usd').click();
      expect(await page.locator('#selected').textContent()).toBe('USD');
    } finally { await browser.close(); }
  });

  it('preserves an already open control instead of toggling it closed', async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent('<button id="toggle" onclick="document.getElementById(\'menu\').hidden=true">Currency</button><div id="menu">USD</div>');
      await openCarControl(page.locator('#toggle'), page.locator('#menu'));
      expect(await page.locator('#menu').isVisible()).toBe(true);
    } finally { await browser.close(); }
  });
});

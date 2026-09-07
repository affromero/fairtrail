import { createServer } from 'node:http';
import { describe, expect, it } from 'vitest';
import { launchBrowser } from '../scraper/browser';
import { prepareDiscoverCarsPage } from './discovercars-capture';

describe.skipIf(process.env.TRAVEL_BROWSER_TESTS !== '1')('rental conditions frame isolation', () => {
  it('allows injected local terms but prevents the terms frame from requesting a remote document', async () => {
    let remoteRequests = 0;
    const server = createServer((request, response) => { remoteRequests++; response.end(request.url); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await prepareDiscoverCarsPage(page);
      await page.setContent('<div class="IframeRentalConditions-Iframe"><iframe></iframe></div>');
      await page.locator('iframe').evaluate((element: HTMLIFrameElement) => { element.contentDocument!.body.innerHTML = '<h1>Driver requirements</h1>'; });
      expect(await page.frameLocator('iframe').locator('h1').innerText()).toBe('Driver requirements');
      const refused = page.waitForEvent('requestfailed', request => request.url().includes('/forbidden'));
      await page.locator('iframe').evaluate((element: HTMLIFrameElement, url) => { element.src = url; }, `http://127.0.0.1:${address.port}/forbidden`);
      expect((await refused).failure()?.errorText).toMatch(/BLOCKED_BY_CLIENT/);
      expect(remoteRequests).toBe(0);
    } finally {
      await browser.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});

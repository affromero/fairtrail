import { createServer } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Page } from 'playwright';
import { launchBrowser } from '../scraper/browser';
import { TravelExecution, withTravelExecution } from '../travel/execution';
import { createCarBrowserContext, withCarQuoteContext } from './browser-context';
import { validateCarSearch } from './validation';
import { providerFailure } from './provider-failure';
import { navigateCarPage } from './navigation';

const location = { name: 'London Heathrow Airport', country: 'GB', timeZone: 'Europe/London', providerIds: { discovercars: '1712' } };
const search = validateCarSearch({ pickup: location, dropoff: location, pickupAt: { date: '2026-10-15', time: '11:00' }, dropoffAt: { date: '2026-10-18', time: '11:00' }, driver: { age: 35, licenceYears: 2, residenceCountry: 'GB' }, sources: ['discovercars'], currency: 'GBP' }, new Date('2026-09-01'));
const url = 'https://www.discovercars.com/offer/quote-for-isolation';
const execution = () => new TravelExecution({ jobId: crypto.randomUUID(), generation: 1, resource: 'browser' });

async function openQuote(page: Page) {
  await page.route('https://www.discovercars.com/**', route => route.fulfill({ contentType: 'text/html', body: `<button>Select seats</button><output></output><script>
    function render() { document.querySelector('output').textContent = localStorage.getItem('seats') === '2' ? 'GBP 158.41, two seats' : 'GBP 44.47, no seats'; }
    document.querySelector('button').onclick = () => { localStorage.setItem('seats', '2'); render(); }; render();
  </script>` }));
  await page.goto(url);
}

describe.skipIf(process.env.TRAVEL_BROWSER_TESTS !== '1')('isolated rental quote inspection', () => {
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url!, 'http://localhost');
    response.writeHead(Number(requestUrl.searchParams.get('status')), { 'content-type': 'text/html' });
    response.end(requestUrl.searchParams.get('body'));
  });
  let origin: string;
  beforeAll(async () => {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture server unavailable');
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  it('rechecks the unselected quote without erasing original extras or losing currency and session identity', async () => {
    await withTravelExecution(execution(), async () => {
      const browser = await launchBrowser(), context = await createCarBrowserContext(browser, search);
      const original = await context.newPage();
      await openQuote(original);
      await context.addCookies([{ name: 'currency', value: 'GBP', url }, { name: 'session', value: 'fixture-session', url, httpOnly: true }]);
      await original.evaluate(() => localStorage.setItem('residence', 'GB'));
      const snapshot = await context.storageState();
      await original.getByRole('button', { name: 'Select seats' }).click();
      await original.reload();
      expect(await original.locator('output').textContent()).toContain('two seats');
      let fork: Page | undefined;
      const result = await withCarQuoteContext(original, search, snapshot, async page => {
        fork = page;
        await openQuote(page);
        expect(await page.locator('output').textContent()).toContain('no seats');
        expect(await page.context().cookies(url)).toEqual(expect.arrayContaining([
          expect.objectContaining({ name: 'currency', value: 'GBP' }), expect.objectContaining({ name: 'session', value: 'fixture-session', httpOnly: true }),
        ]));
        expect(await page.evaluate(() => ({ residence: localStorage.getItem('residence'), locale: navigator.language, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, width: innerWidth, height: innerHeight }))).toEqual({ residence: 'GB', locale: 'en-US', timeZone: 'Europe/London', width: 1440, height: 1000 });
        return 'checked quote';
      });
      expect(result).toBe('checked quote');
      expect(fork?.isClosed()).toBe(true);
      expect(await original.locator('output').textContent()).toContain('two seats');
    });
  });

  it('preserves a provider rejection and closes its isolated page while the original remains usable', async () => {
    await withTravelExecution(execution(), async () => {
      const browser = await launchBrowser(), context = await createCarBrowserContext(browser, search);
      const original = await context.newPage();
      await openQuote(original);
      const rejection = new Error('Provider rejected quote');
      let fork: Page | undefined;
      await expect(withCarQuoteContext(original, search, await context.storageState(), async page => {
        fork = page; await openQuote(page); throw rejection;
      })).rejects.toMatchObject({ cause: rejection });
      expect(fork?.isClosed()).toBe(true);
      expect(await original.locator('output').textContent()).toContain('no seats');
    });
  });

  it.each([
    { status: 429, body: 'Too many requests', blocked: true },
    { status: 403, body: 'Forbidden', blocked: true },
    { status: 200, body: 'Verify that you are human', blocked: true },
    { status: 503, body: 'Service unavailable', blocked: false },
  ])('retains terminal provider evidence after closing a fork with HTTP $status and $body', async ({ status, body, blocked }) => {
    await withTravelExecution(execution(), async () => {
      const browser = await launchBrowser(), context = await createCarBrowserContext(browser, search);
      const original = await context.newPage();
      await openQuote(original);
      let fork: Page | undefined;
      const capture = withCarQuoteContext(original, search, await context.storageState(), async page => {
        fork = page;
        const register = page.route.bind(page);
        vi.spyOn(page, 'route').mockImplementation((pattern, handler, options) => register(pattern, async (route, request) => {
          route.fetch = () => page.request.get(`${origin}/?${new URLSearchParams({ status: String(status), body })}`);
          await handler(route, request);
        }, options));
        await navigateCarPage(page, url, 'discovercars');
        throw new Error('Quote controls unavailable');
      });
      await expect(capture).rejects.toMatchObject({ name: 'CarQuoteFailure', failure: { terminal: true, blocked } });
      const failure = await capture.catch(error => providerFailure(error, original, 'discovercars'));
      expect(failure).toMatchObject({ terminal: true, blocked });
      expect(fork?.isClosed()).toBe(true);
      expect(await original.locator('output').textContent()).toContain('no seats');
    });
  });

  it('cancels both quote contexts under the same browser ownership', async () => {
    const scope = execution(), cancellation = new Error('Owner cancelled quote');
    await expect(withTravelExecution(scope, async () => {
      const browser = await launchBrowser(), context = await createCarBrowserContext(browser, search);
      const original = await context.newPage();
      await openQuote(original);
      await withCarQuoteContext(original, search, await context.storageState(), async page => {
        await openQuote(page);
        scope.abort(cancellation);
        await scope.dispose();
        expect(page.isClosed()).toBe(true);
        expect(original.isClosed()).toBe(true);
        expect(browser.isConnected()).toBe(false);
        scope.check();
      });
    })).rejects.toBe(cancellation);
  });

  it('retains provider and context cleanup failures and prevents further browser work', async () => {
    const scope = execution(), providerError = new Error('Provider rejected quote'), cleanupError = new Error('Context close acknowledgement lost');
    await expect(withTravelExecution(scope, async () => {
      const browser = await launchBrowser(), context = await createCarBrowserContext(browser, search);
      const original = await context.newPage();
      await openQuote(original);
      await expect(withCarQuoteContext(original, search, await context.storageState(), async page => {
        const close = page.context().close.bind(page.context());
        vi.spyOn(page.context(), 'close').mockImplementationOnce(async () => { await close(); throw cleanupError; });
        throw providerError;
      })).rejects.toMatchObject({ name: 'TravelCleanupError', errors: expect.arrayContaining([providerError, cleanupError]) });
      await expect(launchBrowser()).rejects.toMatchObject({ name: 'TravelCleanupError' });
    })).rejects.toMatchObject({ name: 'TravelCleanupError' });
  });
});

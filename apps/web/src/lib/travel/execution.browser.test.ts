import { describe, expect, it, vi } from 'vitest';
import { chromium } from 'playwright';
import { launchBrowser } from '@/lib/scraper/browser';
import { closeTravelBrowser, TravelExecution, withTravelExecution } from './execution';
import { navigateFlightDetail } from '../scraper/navigate';
import { captureHotelSource } from '../hotels/providers';
import { DEFAULT_HOTEL_FILTERS } from '../hotels/types';

const execution = () => new TravelExecution({ jobId: crypto.randomUUID(), generation: 1, resource: 'browser' });

describe.skipIf(process.env.TRAVEL_BROWSER_TESTS !== '1')('travel execution with real Chromium', () => {
  it.each(['flight', 'hotel'] as const)('propagates %s provider and browser cleanup failures together', async provider => {
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
    const close = browser.close.bind(browser);
    const launcher = vi.spyOn(chromium, 'launch').mockResolvedValueOnce(browser);
    vi.spyOn(browser, 'newContext').mockRejectedValueOnce(new Error('provider context unavailable'));
    vi.spyOn(browser, 'close').mockImplementationOnce(async () => { await close(); throw new Error('provider close acknowledgement lost'); });
    try {
      await expect(withTravelExecution(execution(), async () => {
        if (provider === 'flight') return navigateFlightDetail({ origin: 'LHR', destination: 'JFK', dateFrom: new Date('2027-05-01'), dateTo: new Date('2027-05-10') }, 0);
        const search = { destination: 'London', dateMode: 'fixed' as const, checkIn: '2027-05-01', checkOut: '2027-05-04', flexibility: 0, minNights: 3, maxNights: 3, rooms: [{ adults: 2, children: [] }], currency: 'GBP', sources: ['booking' as const], filters: DEFAULT_HOTEL_FILTERS };
        return captureHotelSource(search, { checkIn: search.checkIn, checkOut: search.checkOut }, 'booking');
      })).rejects.toMatchObject({ name: 'TravelCleanupError' });
      expect(browser.isConnected()).toBe(false);
    } finally { launcher.mockRestore(); await close(); }
  });
  it.each([false, true])('retains rejected cleanup and blocks later browser work even if its immediate exception is caught (primary error: %s)', async primary => {
    const scope = execution();
    await expect(withTravelExecution(scope, async () => {
      const browser = await launchBrowser(), close = browser.close.bind(browser);
      vi.spyOn(browser, 'close').mockImplementationOnce(async () => { await close(); throw new Error('lost close acknowledgement'); });
      try {
        await closeTravelBrowser(browser, primary ? new Error('provider rejected request') : undefined);
      } catch (error) {
        expect(error).toMatchObject({ name: 'TravelCleanupError', errors: expect.arrayContaining([expect.objectContaining({ message: 'lost close acknowledgement' })]) });
        if (primary) expect(error).toMatchObject({ errors: expect.arrayContaining([expect.objectContaining({ message: 'provider rejected request' })]) });
      }
      await expect(launchBrowser()).rejects.toMatchObject({ name: 'TravelCleanupError' });
      expect(browser.isConnected()).toBe(false);
    })).rejects.toMatchObject({ name: 'TravelCleanupError' });
  });
  it('closes a live browser and prevents further page work on cancellation', async () => {
    const scope = execution();
    await expect(withTravelExecution(scope, async () => {
      const browser = await launchBrowser();
      const page = await browser.newPage();
      await page.setContent('<h1>Rental search</h1>');
      expect(await page.locator('h1').textContent()).toBe('Rental search');
      scope.abort(new Error('Cancelled by owner'));
      await scope.dispose();
      expect(browser.isConnected()).toBe(false);
      await expect(page.title()).rejects.toThrow(/closed/);
      await expect(launchBrowser()).rejects.toThrow(/Cancelled/);
    })).rejects.toThrow(/Cancelled/);
  });
  it('closes a browser whose launch completes after cancellation', async () => {
    const scope = execution();
    const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined, args: ['--no-sandbox'] });
    let finishLaunch!: () => void;
    const delayedLaunch = new Promise<void>(resolve => { finishLaunch = resolve; });
    const launching = scope.launch(async () => { await delayedLaunch; return browser; });
    scope.abort(new Error('Lease lost during launch'));
    const disposing = scope.dispose();
    finishLaunch();
    await expect(launching).rejects.toThrow(/Lease/);
    await disposing;
    expect(browser.isConnected()).toBe(false);
  });
  it('cleans up on provider failure and permits normal explicit browser closure', async () => {
    let browser;
    await expect(withTravelExecution(execution(), async () => {
      browser = await launchBrowser();
      throw new Error('Provider rejected search');
    })).rejects.toThrow(/Provider/);
    expect(browser!.isConnected()).toBe(false);
    await withTravelExecution(execution(), async () => {
      const normal = await launchBrowser();
      await normal.close();
      expect(normal.isConnected()).toBe(false);
    });
  });
});

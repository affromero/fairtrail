import { describe, expect, it } from 'vitest';
import { chromium } from 'playwright';
import { launchBrowser } from '@/lib/scraper/browser';
import { TravelExecution, withTravelExecution } from './execution';

const execution = () => new TravelExecution({ jobId: crypto.randomUUID(), generation: 1, resource: 'browser' });

describe.skipIf(process.env.TRAVEL_BROWSER_TESTS !== '1')('travel execution with real Chromium', () => {
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

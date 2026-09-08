import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

// Real public-mode local server, without provider or API response fixtures.
const server = process.env.CAR_MARKETING_URL ?? 'http://127.0.0.1:3028';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(server).hostname), 'Use a disposable local server');
const root = resolve(process.env.CAR_MARKETING_OUTPUT ?? '/tmp/flight-finder-car-marketing');
await mkdir(root, { recursive: true });
const output = await mkdtemp(resolve(root, 'run-'));
console.log(`Browser evidence: ${output}`);
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const passed = [];
async function readableNotice(page) {
  const contrast = await page.locator('[aria-labelledby="travel-title"] > p:last-child').evaluate(element => {
    const luminance = color => {
      const channels = color.match(/[\d.]+/g).slice(0, 3).map(value => {
        const channel = Number(value) / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    };
    const foreground = luminance(getComputedStyle(element).color), background = luminance(getComputedStyle(document.body).backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  assert.ok(contrast >= 4.5, `Installation notice requires readable contrast; got ${contrast}`);
}
try {
  for (const locale of ['en', 'es', 'fr', 'de', 'pt']) {
    const { Landing: copy } = JSON.parse(await readFile(new URL(`../apps/web/messages/${locale}/pages.json`, import.meta.url), 'utf8'));
    const context = await browser.newContext({ locale, serviceWorkers: 'block' });
    await context.addInitScript(() => { if (!localStorage.getItem('ft-theme')) localStorage.setItem('ft-theme', 'altitude-dark'); });
    await context.addCookies([{ name: 'ft-locale', value: locale, url: server }]);
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    try {
      for (const width of [320, 390, 1280]) {
        await page.setViewportSize({ width, height: 1000 });
        const response = await page.goto(server);
        await page.evaluate(() => document.fonts.ready);
        assert.equal(response.status(), 200);
        const overview = page.getByRole('region', { name: copy.travelTitle });
        await overview.getByRole('heading', { name: copy.carsTitle, exact: true }).waitFor();
        for (const text of [copy.carsText, copy.travelIntro, copy.travelHousehold, copy.travelAvailability]) assert.ok((await overview.innerText()).includes(text));
        assert.equal(await page.getByRole('heading', { level: 1 }).count(), 1);
        assert.equal(await page.locator('input, textarea, select').count(), 0, 'Public landing does not expose search or tracker controls');
        assert.equal(await page.locator('a[href="/cars"], a[href="/hotels"], a[href="/account"]').count(), 0, 'Public visitors are not sent to private dashboards');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `${locale} ${width}: no horizontal overflow`);
        assert.match(await page.title(), /rental car/);
        for (const selector of ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]']) assert.match(await page.locator(selector).getAttribute('content'), /rental car/);
        const structured = JSON.parse(await page.locator('script[type="application/ld+json"]').textContent());
        assert.match(structured.description, /rental car/);
        await readableNotice(page);
        await overview.screenshot({ path: resolve(output, `${locale}-${width}-dark.png`), animations: 'disabled' });
        if (locale === 'en') {
          const dark = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
          await page.evaluate(() => localStorage.setItem('ft-theme', 'altitude-light'));
          await page.reload();
          await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'altitude-light');
          assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), dark, 'Light theme changes the rendered palette');
          await readableNotice(page);
          await overview.screenshot({ path: resolve(output, `${locale}-${width}-light.png`), animations: 'disabled' });
          await page.evaluate(() => localStorage.setItem('ft-theme', 'altitude-dark'));
        }
        passed.push(`${locale}-${width}`);
        console.log(`PASS ${locale} ${width}: independent travel copy, metadata and public boundaries`);
      }
      assert.deepEqual(errors, [], 'No browser exceptions');
      for (const path of ['/api/cars', '/api/cars/session', '/api/cars/search', '/cars']) {
        const response = await context.request.get(`${server}${path}`);
        assert.equal(response.status(), 404, `Public ${path} remains unavailable`);
      }
      const manifest = await (await context.request.get(`${server}/manifest.json`)).json();
      assert.match(manifest.description, /rental car/);
    } finally { await context.close(); }
  }
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ passed, fixtures: false, checkedAt: new Date().toISOString() }, null, 2));
} finally { await browser.close(); }

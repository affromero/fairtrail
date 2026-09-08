import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const server = process.env.CLI_BROWSER_URL ?? 'http://localhost:3012';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(server).hostname), 'Use an isolated local server');
const output = resolve(process.env.CLI_BROWSER_OUTPUT ?? '/tmp/flight-finder-cli-browser');
await mkdir(output, { recursive: true });
const catalog = { version: '0.137.0', source: 'live', models: [{ id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', isDefault: false, defaultReasoningEffort: 'medium', reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'] }] };
const config = { id: 'singleton', provider: 'codex', model: 'gpt-5.6-luna', reasoningEffort: 'default', scrapeInterval: 3,
  theme: 'dark', defaultCurrency: 'GBP', defaultCountry: 'GB', defaultSearchMethod: 'ai', vpnProvider: 'none', vpnCountries: [], isSelfHosted: true, multiUserMode: false };
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, width, mode] of [['desktop-models', 1440, 'settings'], ['mobile-models', 390, 'settings'], ['update-confirmation', 1440, 'update'], ['model-unavailable', 1440, 'unavailable'], ['test-failure', 1440, 'failure'], ['wizard-ready-cli-first', 1440, 'wizard']]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'en-GB', serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [], mutations = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (request.method() !== 'GET') mutations.push({ path, body: request.postDataJSON() });
      if (path === '/api/setup/status') return route.fulfill({ json: { setupComplete: false, isSelfHosted: true, detectedProviders: ['openai', 'codex', 'claude-code'] } });
      let data = {};
      if (path === '/api/admin/config') data = { ...config, ...(mode === 'unavailable' ? { model: 'saved-unavailable-model' } : {}) };
      if (path === '/api/admin/providers') data = { openai: { status: 'ready' }, codex: { status: 'ready' }, 'claude-code': { status: 'ready' } };
      if (path.endsWith('/cli-models')) {
        if (request.method() === 'POST' && mode === 'failure') return route.fulfill({ status: 502, json: { ok: false, error: 'This model requires a newer CLI. Update it and recheck models.' } });
        data = request.method() === 'POST' ? { durationMs: 1200, verified: true } : catalog;
      }
      if (path.endsWith('/cli-models/update')) data = { targetVersion: '0.153.4', managedUpdate: true };
      if (path === '/api/vpn/status') data = { configured: false, sidecarRunning: false, ready: false };
      return route.fulfill({ json: { ok: true, data } });
    });
    try {
      await page.goto(`${server}/${mode === 'wizard' ? 'setup' : 'settings'}`);
      if (mode === 'wizard') {
        const providers = page.locator('button').filter({ has: page.locator('[class*="providerName"]') });
        await providers.first().waitFor();
        assert.match(await providers.nth(0).innerText(), /Claude Code/);
        assert.match(await providers.nth(1).innerText(), /Codex/);
        await page.getByRole('button', { name: /Codex/ }).click();
      }
      const picker = page.getByRole('region', { name: 'CLI model and reasoning' });
      await picker.getByRole('option', { name: 'GPT-5.6 Luna' }).waitFor({ state: 'attached' });
      if (mode === 'wizard') await picker.getByLabel('Model', { exact: true }).selectOption('gpt-5.6-luna');
      if (mode === 'unavailable') {
        await picker.getByRole('alert').waitFor();
        assert.equal(await picker.getByLabel('Model', { exact: true }).inputValue(), 'saved-unavailable-model');
        assert.equal(await picker.getByRole('button', { name: 'Test selection' }).isDisabled(), true);
      } else assert.equal(await picker.getByLabel('Model', { exact: true }).inputValue(), 'gpt-5.6-luna');
      if (mode === 'update') {
        await picker.getByRole('button', { name: 'Update CLI to 0.153.4' }).click();
        await picker.getByRole('button', { name: 'Install update' }).waitFor();
        assert.equal(mutations.length, 0, 'Opening confirmation does not update the CLI');
      }
      if (mode === 'failure') {
        await picker.getByRole('button', { name: 'Test selection' }).click();
        await picker.getByText('This model requires a newer CLI. Update it and recheck models.').waitFor();
        assert.deepEqual(mutations.map(entry => entry.path), ['/api/admin/cli-models']);
        assert.equal(mutations[0].body.reasoningEffort, 'default');
      }
      await picker.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal overflow');
      assert.deepEqual(errors, [], 'No browser exceptions');
      await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled' });
      console.log(`PASS ${name}`);
    } catch (error) {
      await page.screenshot({ path: resolve(output, `${name}-failure.png`), fullPage: true });
      console.error(JSON.stringify({ url: page.url(), errors, text: await page.locator('body').innerText() }));
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }

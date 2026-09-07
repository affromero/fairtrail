import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Browser, type BrowserContext } from 'playwright';
import pg from 'pg';
import { carOfferFixture, carReportFixture, carSearchFixture } from '../apps/web/src/test/car-fixtures';
import { carContractHash } from '../apps/web/src/lib/cars/selection';

// Disposable stored observations exercise real pages and authentication. No
// provider browser is started and all scheduled background work is disabled.
const database = new URL(process.env.DATABASE_URL ?? 'http://invalid');
assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '55440');
assert.equal(database.pathname, '/car_results_browser', 'Use the dedicated disposable browser database');
const output = resolve(process.env.CAR_BROWSER_OUTPUT ?? '/tmp/flight-finder-car-results-browser');
await mkdir(output, { recursive: true });
const db = new pg.Client({ connectionString: database.href, connectionTimeoutMillis: 3000, statement_timeout: 5000 });
let connected = false, seeded = false, browser: Browser | undefined;
const servers: { child: ReturnType<typeof spawn>; log: ReturnType<typeof createWriteStream> }[] = [];
const contexts: BrowserContext[] = [], passed: string[] = [], errors: string[] = [];
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const search = carSearchFixture(), report = carReportFixture(), now = new Date().toISOString();
async function start(name: string, port: number, selfHosted: boolean) {
  const log = createWriteStream(resolve(output, `${name}.log`));
  const child = spawn(process.execPath, [resolve('node_modules/next/dist/bin/next'), 'start', '-p', String(port), '-H', '127.0.0.1'], {
    cwd: resolve('apps/web'), env: { ...process.env, SELF_HOSTED: String(selfHosted), CRON_ENABLED: 'false', REDIS_URL: '', FF_ACCESS_PASSWORD: '', FF_MACHINE_TOKEN: '', ADMIN_SESSION_SECRET: 'car-results-disposable-test-secret', NEXT_TELEMETRY_DISABLED: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.pipe(log); child.stderr?.pipe(log); servers.push({ child, log });
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 60; attempt++) {
    assert.equal(child.exitCode, null, `${name} exited; inspect ${output}/${name}.log`);
    if ((await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(1000) }).catch(() => null))?.ok) return url;
    await delay(500);
  }
  throw new Error(`${name} did not start`);
}
async function context(url: string, locale = 'en') {
  assert.ok(browser);
  const ctx = await browser.newContext({ baseURL: url, viewport: { width: 1280, height: 1000 }, locale: 'en-US' });
  ctx.setDefaultTimeout(15_000); ctx.setDefaultNavigationTimeout(20_000);
  contexts.push(ctx); await ctx.addCookies([{ name: 'ft-locale', value: locale, url }]);
  await ctx.route('**/*', route => {
    const target = new URL(route.request().url());
    return target.hostname === '127.0.0.1' ? route.continue() : route.abort();
  });
  ctx.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  return ctx;
}
async function login(ctx: BrowserContext, username: string) {
  const response = await ctx.request.post('/api/auth/login', { data: { username } });
  assert.equal(response.status(), 200, await response.text());
}
try {
  await db.connect(); connected = true;
  for (const table of ['User', 'Query', 'HotelTracker', 'CarTracker', 'CarSearchRun', 'ExtractionConfig']) {
    assert.equal(Number((await db.query(`SELECT count(*) FROM "${table}"`)).rows[0].count), 0, `Start with an empty ${table}`);
  }
  browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  seeded = true;
  await db.query(`INSERT INTO "ExtractionConfig" (id,"adminPasswordHash",enabled,"multiUserMode","updatedAt") VALUES ('singleton','self-hosted',false,true,now())`);
  for (const name of ['alice', 'bob']) await db.query(`INSERT INTO "User" (id,username,"updatedAt") VALUES ($1,$1,now())`, [`car-browser-${name}`]);
  await db.query(`INSERT INTO "CarSearchRun" (id,"userId",request,result,status,"createdAt","completedAt") VALUES ('car-browser-search','car-browser-alice',$1,$2,'success',$3,$3)`, [search, report, now]);
  const privateUrl = await start('private', 3017, true), publicUrl = await start('public', 3018, false);
  const alice = await context(privateUrl); await login(alice, 'car-browser-alice');
  const page = await alice.newPage(); await page.goto('/cars/search/car-browser-search');
  await page.getByRole('button', { name: 'Track this rental' }).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Track this rental' }).isEnabled());
  assert.equal(await page.locator('h1').count(), 1);
  assert.match(await page.locator('meta[name="robots"]').getAttribute('content') ?? '', /noindex/);
  await page.getByText('Charges, extras and rental conditions', { exact: true }).focus();
  await page.keyboard.press('Enter');
  assert.ok(await page.getByRole('heading', { name: 'Itemized charges' }).isVisible());
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `No overflow at ${width}`);
    const brand = await page.locator('a[aria-label="Flight Finder home"]').boundingBox(), heading = await page.locator('h1').boundingBox();
    assert.ok(brand && heading && brand.y + brand.height <= heading.y, 'Home link does not overlap the result heading');
    await page.screenshot({ path: resolve(output, `verified-${width}.png`), fullPage: true });
  }
  passed.push('Owned verified results, evidence, desktop/mobile layout and noindex');
  for (const locale of ['es', 'fr', 'de', 'pt']) {
    const copy = JSON.parse(await readFile(resolve(`apps/web/messages/${locale}/cars.json`), 'utf8')).Cars;
    const localized = await context(privateUrl, locale); await login(localized, 'car-browser-alice');
    const localizedPage = await localized.newPage(); await localizedPage.goto('/cars/search/car-browser-search');
    await localizedPage.getByRole('heading', { level: 1, name: copy.searchTitle }).waitFor();
    assert.ok(await localizedPage.getByRole('button', { name: copy.track, exact: true }).isEnabled());
    await localizedPage.setViewportSize({ width: 390, height: 1000 });
    assert.ok(await localizedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await localizedPage.screenshot({ path: resolve(output, `verified-${locale}-390.png`), fullPage: true });
  }
  passed.push('Five locale result controls and keyboard evidence disclosure');
  await page.route('**/api/cars/search/car-browser-search', route => route.abort());
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await page.getByRole('alert').filter({ hasText: 'Status updates interrupted' }).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Track this rental' }).isDisabled());
  await page.screenshot({ path: resolve(output, 'interrupted-390.png'), fullPage: true });
  await page.unroute('**/api/cars/search/car-browser-search');
  await page.getByRole('button', { name: 'Retry status updates' }).click();
  await page.waitForFunction(() => !document.querySelector('fieldset')?.disabled);
  passed.push('Real browser transport interruption makes results read-only and explicit retry restores them');
  const bob = await context(privateUrl); await login(bob, 'car-browser-bob');
  assert.equal((await bob.request.get('/cars/search/car-browser-search')).status(), 404);
  assert.equal((await bob.request.get('/api/cars/search/car-browser-search')).status(), 404);
  const publicCtx = await context(publicUrl);
  assert.equal((await publicCtx.request.get('/cars/search/car-browser-search')).status(), 404);
  assert.equal((await publicCtx.request.get('/api/cars/search/car-browser-search')).status(), 404);
  const anonymous = await context(privateUrl), anonymousPage = await anonymous.newPage();
  await anonymousPage.goto('/cars/search/car-browser-search'); assert.equal(new URL(anonymousPage.url()).pathname, '/login');
  passed.push('Foreign account and public instance return 404; anonymous private visitor signs in');
  await alice.clearCookies(); await page.getByRole('button', { name: 'Refresh status' }).click();
  await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: /Example car/ }).count(), 0);
  await page.screenshot({ path: resolve(output, 'session-expired-390.png'), fullPage: true });
  passed.push('Expired browser session hides private results');
  await login(alice, 'car-browser-alice');
  await db.query(`INSERT INTO "CarSearchRun" (id,"userId",request,status,"createdAt") VALUES ('car-browser-progress','car-browser-alice',$1,'running',$2)`, [search, now]);
  await page.goto('/cars/search/car-browser-progress');
  await page.getByRole('button', { name: 'Cancel search' }).waitFor();
  await db.query(`UPDATE "CarSearchRun" SET status='success', result=$1,"completedAt"=$2 WHERE id='car-browser-progress'`, [report, now]);
  await page.getByRole('button', { name: 'Track this rental' }).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Track this rental' }).isEnabled());
  await db.query(`INSERT INTO "CarSearchRun" (id,"userId",request,status,"createdAt") VALUES ('car-browser-cancel','car-browser-alice',$1,'running',$2)`, [search, now]);
  await page.goto('/cars/search/car-browser-cancel');
  await page.getByRole('button', { name: 'Cancel search' }).click();
  await page.getByRole('status').filter({ hasText: 'Cancelled' }).waitFor();
  assert.equal((await db.query(`SELECT status FROM "CarSearchRun" WHERE id='car-browser-cancel'`)).rows[0].status, 'cancelled');
  await page.screenshot({ path: resolve(output, 'cancelled-390.png'), fullPage: true });
  passed.push('Progressive result polling and real cancellation persist terminal state');
  const historicalAt = new Date(Date.now() - 86_400_000).toISOString(), historicalOffer = carOfferFixture(historicalAt);
  await db.query(`INSERT INTO "CarTracker" (id,"userId",label,search,currency,"latestPriceMinor","historicalLowMinor","lastCheckedAt","lastError","createdAt","updatedAt") VALUES ('car-browser-tracker','car-browser-alice','London weekend',$1,'GBP',10000,9000,$2,'Provider could not verify this check',$3,$2)`, [search, now, historicalAt]);
  await db.query(`INSERT INTO "CarSearchRun" (id,"userId","trackerId","trackerRevision",request,status,"createdAt","completedAt") VALUES ('car-browser-history','car-browser-alice','car-browser-tracker',0,$1,'success',$2,$2)`, [search, historicalAt]);
  await db.query(`INSERT INTO "CarSnapshot" (id,"trackerId","runId",source,offer,currency,"totalMinor",eligible,"contractHash","observedAt") VALUES ('car-browser-observation','car-browser-tracker','car-browser-history','discovercars',$1,'GBP',10000,true,$2,$3)`, [historicalOffer, carContractHash(historicalOffer.contract), historicalAt]);
  await page.goto('/cars/car-browser-tracker');
  await page.getByRole('heading', { name: 'London weekend' }).waitFor();
  assert.equal(await page.locator('h1').count(), 1);
  assert.match(await page.locator('meta[name="robots"]').getAttribute('content') ?? '', /noindex/);
  assert.match(await page.getByRole('region', { name: 'London weekend', exact: true }).getByRole('alert').innerText(), /needs attention/);
  assert.equal(await page.getByText('Latest evidence for this total', { exact: true }).locator('..').locator('time').getAttribute('datetime'), historicalAt);
  assert.equal(await page.getByText('Last check attempted', { exact: true }).locator('..').locator('time').getAttribute('datetime'), now);
  const evidence = page.getByText('Evidence for the retained price', { exact: true });
  await evidence.focus(); await page.keyboard.press('Enter');
  assert.ok(await evidence.locator('..').getByText('Charges, extras and rental conditions', { exact: true }).isVisible());
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: resolve(output, `tracker-history-${width}.png`), fullPage: true });
  }
  passed.push('Tracker history preserves evidence timestamps through failed checks and supports keyboard disclosure');
  for (const locale of ['es', 'fr', 'de', 'pt']) {
    const copy = JSON.parse(await readFile(resolve(`apps/web/messages/${locale}/cars.json`), 'utf8')).Cars;
    const localized = await context(privateUrl, locale); await login(localized, 'car-browser-alice');
    const localizedPage = await localized.newPage(); await localizedPage.setViewportSize({ width: 390, height: 1000 });
    await localizedPage.goto('/cars/car-browser-tracker');
    await localizedPage.getByRole('heading', { name: copy.trackerTitle, level: 1 }).waitFor();
    await localizedPage.getByRole('heading', { name: copy.verifiedHistory }).waitFor();
    assert.ok(await localizedPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Tracker ${locale} does not overflow`);
    await localizedPage.screenshot({ path: resolve(output, `tracker-history-${locale}-390.png`), fullPage: true });
  }
  assert.equal((await bob.request.get('/cars/car-browser-tracker')).status(), 404);
  assert.equal((await bob.request.get('/api/cars/car-browser-tracker')).status(), 404);
  assert.equal((await publicCtx.request.get('/cars/car-browser-tracker')).status(), 404);
  await anonymousPage.goto('/cars/car-browser-tracker'); assert.equal(new URL(anonymousPage.url()).pathname, '/login');
  await db.query(`UPDATE "User" SET "isAdmin"=true WHERE id='car-browser-bob'`);
  assert.equal((await bob.request.get('/cars/car-browser-tracker')).status(), 200);
  passed.push('Five locale tracker layouts and owner, administrator, foreign and anonymous page access');
  await page.route('**/api/cars/car-browser-tracker', route => route.abort());
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await page.getByRole('alert').filter({ hasText: 'History updates interrupted' }).waitFor();
  assert.ok(await page.getByRole('heading', { name: 'London weekend' }).isVisible());
  await page.screenshot({ path: resolve(output, 'tracker-interrupted-390.png'), fullPage: true });
  await page.unroute('**/api/cars/car-browser-tracker');
  await page.getByRole('button', { name: 'Retry status updates' }).click();
  await page.getByRole('button', { name: 'Refresh status' }).waitFor();
  await alice.clearCookies(); await page.getByRole('button', { name: 'Refresh status' }).click();
  await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'London weekend' }).count(), 0);
  await page.screenshot({ path: resolve(output, 'tracker-session-expired-390.png'), fullPage: true });
  await login(alice, 'car-browser-alice');
  await page.getByRole('button', { name: 'Retry status updates' }).click();
  await page.getByRole('heading', { name: 'London weekend' }).waitFor();
  passed.push('Tracker history survives transport failure and remains private after session expiry');
  await db.query(`INSERT INTO "CarSearchRun" (id,"userId","trackerId","trackerRevision",request,status,"createdAt") VALUES ('car-browser-tracker-queued','car-browser-alice','car-browser-tracker',0,$1,'queued',$2)`, [search, now]);
  await page.reload();
  await page.getByRole('region', { name: 'Recent checks' }).getByText('Waiting', { exact: true }).waitFor();
  await db.query(`UPDATE "CarSearchRun" SET status='failed',error='Provider check unavailable',"completedAt"=now() WHERE id='car-browser-tracker-queued'`);
  await page.getByRole('region', { name: 'Recent checks' }).getByText('Check failed', { exact: true }).waitFor();
  assert.equal(await page.getByText('Latest evidence for this total', { exact: true }).locator('..').locator('time').getAttribute('datetime'), historicalAt);
  passed.push('Queued tracker work polls to its terminal result without freshening historical prices');
  await db.query(`INSERT INTO "CarSearchRun" (id,"userId","trackerId","trackerRevision",request,status,"createdAt") VALUES ('car-browser-active-edit','car-browser-alice','car-browser-tracker',0,$1,'running',now())`, [search]);
  await page.reload();
  let loseEditAcknowledgement = true;
  await page.route('**/api/cars/car-browser-tracker', async route => {
    if (route.request().method() !== 'PATCH' || !loseEditAcknowledgement) return route.continue();
    loseEditAcknowledgement = false;
    assert.equal(route.request().headers()['x-car-revision'], '0');
    const result = await route.fetch(); assert.equal(result.status(), 200, await result.text());
    await route.abort();
  });
  await page.getByRole('button', { name: 'Pause tracking' }).click();
  await page.getByRole('button', { name: 'Recover this action' }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Recover this action' && !button.disabled));
  await page.screenshot({ path: resolve(output, 'tracker-edit-uncertain-390.png'), fullPage: true });
  assert.equal((await db.query(`SELECT status FROM "CarSearchRun" WHERE id='car-browser-active-edit'`)).rows[0].status, 'cancelled');
  await page.getByRole('button', { name: 'Recover this action' }).click();
  await page.getByText('The requested settings are currently saved.', { exact: true }).waitFor();
  assert.deepEqual((await db.query(`SELECT revision,active FROM "CarTracker" WHERE id='car-browser-tracker'`)).rows[0], { revision: 1, active: false });
  await page.unroute('**/api/cars/car-browser-tracker');
  passed.push('Lost pause acknowledgement recovers one revision and cancels active tracker work');
  await page.getByRole('button', { name: 'Load current settings' }).click();
  await page.getByLabel('Alert at or below total (GBP)', { exact: true }).fill('85.75');
  await page.getByLabel('Check every (hours)', { exact: true }).fill('6');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await page.getByText('Settings saved and confirmed.', { exact: true }).waitFor();
  assert.deepEqual((await db.query(`SELECT revision,"targetMinor","scrapeInterval" FROM "CarTracker" WHERE id='car-browser-tracker'`)).rows[0], { revision: 2, targetMinor: '8575', scrapeInterval: 6 });
  await page.getByRole('button', { name: 'Delete tracker', exact: true }).click();
  const externalEdit = await alice.request.patch('/api/cars/car-browser-tracker', { headers: { 'X-Car-Revision': '2' }, data: { label: 'Updated in another tab' } });
  assert.equal(externalEdit.status(), 200, await externalEdit.text());
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await page.getByRole('heading', { name: 'Updated in another tab' }).waitFor();
  assert.ok(await page.getByRole('button', { name: 'Yes, delete tracker' }).isDisabled());
  await page.screenshot({ path: resolve(output, 'tracker-delete-conflict-390.png'), fullPage: true });
  await page.getByRole('button', { name: 'Keep tracker' }).click();
  passed.push('Settings persist exact money and stale delete confirmation cannot delete a newer revision');
  await page.evaluate(() => sessionStorage.setItem('ff-car-management:car-browser-alice:car-browser-tracker', '{broken'));
  await page.reload();
  assert.ok(await page.getByRole('button', { name: 'Resume tracking' }).isDisabled());
  await page.getByRole('button', { name: 'Pause and recover controls' }).click();
  await page.getByText('Settings saved and confirmed.', { exact: true }).waitFor();
  const staleDelete = await alice.request.delete('/api/cars/car-browser-tracker', { headers: { 'X-Car-Revision': '3' } });
  assert.equal(staleDelete.status(), 412, await staleDelete.text());
  assert.deepEqual((await db.query(`SELECT revision,active FROM "CarTracker" WHERE id='car-browser-tracker'`)).rows[0], { revision: 4, active: false });
  passed.push('Explicit corrupt-record recovery pauses and fences an older pending deletion');
  const administratorDetail = await bob.request.get('/api/cars/car-browser-tracker');
  assert.equal(administratorDetail.status(), 200, await administratorDetail.text());
  assert.equal((await administratorDetail.json()).data.canReassign, true);
  const administratorPage = await bob.newPage(); await administratorPage.goto('/cars/car-browser-tracker');
  await administratorPage.getByRole('heading', { name: 'Updated in another tab' }).waitFor();
  await administratorPage.screenshot({ path: resolve(output, 'tracker-administrator.png'), fullPage: true });
  await administratorPage.getByRole('combobox', { name: 'New owner', exact: true }).selectOption('car-browser-bob');
  await administratorPage.getByRole('button', { name: 'Reassign tracker', exact: true }).click();
  await administratorPage.getByText('Settings saved and confirmed.', { exact: true }).waitFor();
  assert.equal((await db.query(`SELECT "userId" FROM "CarTracker" WHERE id='car-browser-tracker'`)).rows[0].userId, 'car-browser-bob');
  await page.getByRole('button', { name: 'Refresh status' }).click();
  await page.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Updated in another tab' }).count(), 0);
  let loseDeleteAcknowledgement = true;
  await administratorPage.route('**/api/cars/car-browser-tracker', async route => {
    if (route.request().method() !== 'DELETE' || !loseDeleteAcknowledgement) return route.continue();
    loseDeleteAcknowledgement = false;
    const result = await route.fetch(); assert.equal(result.status(), 200, await result.text());
    await route.abort();
  });
  await administratorPage.getByRole('button', { name: 'Delete tracker', exact: true }).click();
  await administratorPage.getByRole('button', { name: 'Yes, delete tracker' }).click();
  await administratorPage.getByRole('button', { name: 'Recover this action' }).waitFor();
  await administratorPage.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Recover this action' && !button.disabled));
  await administratorPage.getByRole('button', { name: 'Retry status updates' }).click();
  await administratorPage.getByRole('link', { name: 'Sign in', exact: true }).waitFor();
  assert.equal((await db.query(`SELECT count(*) FROM "CarTracker" WHERE id='car-browser-tracker'`)).rows[0].count, '0');
  assert.equal(await administratorPage.getByText('Rental tracker deleted. No booking was cancelled.', { exact: true }).count(), 0);
  passed.push('Administrator reassignment revokes old-owner access and lost deletion acknowledgement resolves without false attribution');
  assert.deepEqual(errors, []); await writeFile(resolve(output, 'results.json'), JSON.stringify({ passed, errors }, null, 2));
  for (const name of passed) console.log(`PASS ${name}`);
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ passed, errors, error: String(error) }, null, 2)); throw error;
} finally {
  for (const ctx of contexts) await ctx.close(); await browser?.close();
  for (const { child, log } of servers) {
    child.kill('SIGTERM'); await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(5000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); log.end();
  }
  if (connected && seeded) {
    await db.query(`DELETE FROM "User" WHERE id IN ('car-browser-alice','car-browser-bob')`);
    await db.query(`DELETE FROM "ExtractionConfig" WHERE id = 'singleton'`);
  }
  await db.end();
}

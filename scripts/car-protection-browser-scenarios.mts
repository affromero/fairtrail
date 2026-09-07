import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { BrowserContext } from 'playwright';
import type pg from 'pg';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { carOfferFixture, carReportFixture, carSearchFixture } from '../apps/web/src/test/car-fixtures';

async function cliProtectedTracking(context: BrowserContext, origin: string, searchId: string, offerId: string) {
  const session = (await context.cookies(origin)).find(cookie => cookie.name === 'ft-session');
  assert.ok(session, 'Disposable CLI test requires the browser account session');
  const directory = await mkdtemp(resolve(tmpdir(), 'car-protected-cli-browser-'));
  const run = async (args: string[]) => {
    const result = await promisify(execFile)(process.execPath, [resolve('packages/cli/dist/index.js'), 'cars', '--server', origin,
      '--receipt-dir', directory, '--json', ...args], { timeout: 30_000, maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, FLIGHT_FINDER_SESSION: session.value, FLIGHT_FINDER_TOKEN: '', FLIGHT_FINDER_CAR_REQUIRE_MOUNT: '0' } });
    return JSON.parse(result.stdout);
  };
  try {
    const review = await run(['protection', searchId, offerId]);
    assert.equal(review.canTrack, true); assert.match(review.trackingReview, /^[a-f0-9]{64}$/);
    assert.match(JSON.stringify(review.offer), /Fresh test policy/);
    await assert.rejects(run(['track', searchId, offerId]), /Review the current terms/);
    const tracked = await run(['track', searchId, offerId, '--review-protection', review.trackingReview]);
    assert.deepEqual(tracked.result.tracker.search.extras.protection, [{ source: 'discovercars', productId: '35' }]);
    assert.equal(tracked.result.tracker.search.protectionRecheck, undefined);
    const removed = await run(['delete', tracked.result.tracker.id, '--revision', String(tracked.result.tracker.revision)]);
    assert.equal(removed.result.deleted, true);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

/** Stored provider fixtures; authentication, creation, receipts and browser UI remain real. */
export async function carProtectionBrowserScenarios(db: pg.Client, context: BrowserContext, output: string) {
  const search = carSearchFixture(), offer = carOfferFixture(), now = new Date().toISOString(), choiceId = crypto.randomUUID();
  const report = { ...carReportFixture([offer]), protection: [{ offerId: offer.id, status: 'complete', error: null, choices: [{
    id: choiceId, source: 'discovercars', productId: '35', name: 'Full Coverage',
    termsSummary: 'Reimbursement after the supplier charges you. Keep the rental agreement and damage report. Tyres and unauthorised drivers are excluded from this test policy.',
    policyLinks: ['https://www.sincerainsurance.com/policy'], observedExtraPrice: { currency: 'GBP', minor: 1800 },
    observedAt: offer.observedAt, sourceUrl: 'https://www.discovercars.com/offer/coverage/example',
  }] }] };
  await db.query(`INSERT INTO "CarSearchRun" (id,"userId",request,result,status,"createdAt","completedAt") VALUES ('car-browser-protection','car-browser-alice',$1,$2,'success',$3,$3)`, [search, report, now]);
  const page = await context.newPage();
  try {
    await page.goto('/cars/search/car-browser-protection');
    await page.getByText('Optional protection', { exact: true }).focus(); await page.keyboard.press('Enter');
    assert.ok(!(await page.getByRole('radio').isChecked()));
    await page.getByRole('radio').check();
    assert.ok(await page.getByRole('button', { name: 'Recheck total with protection' }).isDisabled());
    const option = page.getByText('Optional protection', { exact: true }).locator('..');
    assert.match(await option.innerText(), /£18\.00/); assert.doesNotMatch(await option.innerText(), /£118\.00/);
    for (const theme of ['altitude-dark', 'altitude-light']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await option.screenshot({ path: resolve(output, `protection-options-fixture-${theme}-${width}.png`) });
      }
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = 'altitude-dark'; });
    await page.getByLabel('I have reviewed this option’s terms and exclusions.').check();
    let childId = '', requestKey = '';
    const endpoint = '**/api/cars/search/car-browser-protection/protection';
    await page.route(endpoint, async route => {
      requestKey = route.request().headers()['idempotency-key']!;
      const accepted = await route.fetch(); assert.equal(accepted.status(), 202, await accepted.text());
      childId = (await accepted.json()).data.id; await route.abort();
    });
    await page.getByRole('button', { name: 'Recheck total with protection' }).click();
    await page.getByRole('button', { name: 'Recover protected quote' }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Track this rental' }).isDisabled());
    await page.getByRole('button', { name: 'Recover protected quote' }).locator('..').screenshot({ path: resolve(output, 'protection-lost-ack-fixture-390.png') });
    await page.unroute(endpoint); await page.reload();
    await page.getByRole('button', { name: 'Recover protected quote' }).click();
    const open = page.getByRole('link', { name: 'Open protected quote', exact: true }); await open.waitFor();
    assert.equal(await open.getAttribute('href'), `/cars/search/${childId}`);
    assert.equal(Number((await db.query(`SELECT count(*) FROM "CarSearchCreation" WHERE "runId"=$1`, [childId])).rows[0].count), 1);
    assert.equal(Number((await db.query(`SELECT count(*) FROM "TravelJob" WHERE "carRunId"=$1`, [childId])).rows[0].count), 1);
    const protectedOffer = structuredClone(offer), extra = { kind: 'protection' as const, productId: '35', quantity: 1, category: null };
    const terms = 'Fresh test policy: reimbursement requires supplier receipts. Tyres and unauthorised drivers are excluded. Review these conditions before tracking.';
    protectedOffer.contract.extras.push(extra); protectedOffer.contract.coverageProductIds.push('35'); protectedOffer.contract.coverageTerms += ` ${terms}`;
    protectedOffer.extras.push({ ...extra, availability: { ...offer.available, text: 'Full Coverage' }, eligibility: { ...offer.driverEligible, text: terms }, included: { ...offer.available, value: false }, chargeId: 'protection' });
    protectedOffer.charges.push({ id: 'protection', label: 'Full Coverage', kind: 'extra', payment: 'now', amount: { ...offer.total, value: { currency: 'GBP', minor: 1800 } } });
    protectedOffer.total.value = { currency: 'GBP', minor: 11800 };
    await db.query(`UPDATE "CarSearchRun" SET status='success',result=$2,"completedAt"=$3 WHERE id=$1`, [childId, carReportFixture([protectedOffer], ['discovercars']), new Date().toISOString()]);
    await db.query(`UPDATE "TravelJob" SET status='succeeded',"activeKey"=NULL,"completedAt"=now() WHERE "carRunId"=$1`, [childId]);
    await open.click();
    await page.getByRole('region', { name: 'Fresh protection terms' }).waitFor();
    await cliProtectedTracking(context, new URL(page.url()).origin, childId, offer.id);
    assert.ok(await page.getByRole('button', { name: 'Track this rental' }).isDisabled());
    assert.match(await page.getByRole('region', { name: 'Fresh protection terms' }).innerText(), /Fresh test policy/);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await page.locator('article').first().screenshot({ path: resolve(output, `protection-fresh-fixture-${width}.png`) });
    }
    await page.getByLabel('I have reviewed the fresh protection terms and total.').check();
    await page.getByRole('button', { name: 'Track this rental' }).click();
    const tracker = page.getByRole('link', { name: 'Open rental tracker', exact: true }); await tracker.waitFor();
    const trackerId = (await tracker.getAttribute('href'))!.split('/').at(-1)!;
    const saved = (await db.query(`SELECT search FROM "CarTracker" WHERE id=$1`, [trackerId])).rows[0].search;
    assert.deepEqual(saved.extras.protection, [{ source: 'discovercars', productId: '35' }]); assert.equal(saved.protectionRecheck, undefined);
    assert.equal((await context.request.delete(`/api/cars/${trackerId}`, { headers: { 'X-Car-Revision': '0' } })).status(), 200);
    await page.goto('/cars/search/car-browser-protection');
    await page.evaluate(() => sessionStorage.setItem('ff-car-protection:car-browser-alice:car-browser-protection', '{broken'));
    await page.reload(); await page.getByText('Close tracking from this search', { exact: true }).click();
    await page.getByRole('button', { name: 'Confirm permanent closure' }).click();
    await page.getByRole('heading', { name: 'Tracking closed for this search' }).waitFor();
    assert.ok(await page.getByRole('button', { name: 'Track this rental' }).isDisabled());
    assert.equal((await context.request.get(`/api/cars/search/${childId}`)).status(), 200);
    const replay = await context.request.post('/api/cars/search/car-browser-protection/protection', { headers: { 'Idempotency-Key': requestKey }, data: { offerId: offer.id, choiceId } });
    assert.equal(replay.status(), 202, await replay.text()); assert.equal((await replay.json()).data.id, childId);
    await page.getByRole('heading', { name: 'Tracking closed for this search' }).locator('..').screenshot({ path: resolve(output, 'protection-closed-fixture-390.png') });
  } finally { await page.close(); }
}

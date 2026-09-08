import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { BrowserContext } from 'playwright';
import type pg from 'pg';

/** Injects one disposable quarantine incident; authorization and recovery execute against PostgreSQL. */
export async function travelRecoveryBrowserScenarios(db: pg.Client, admin: BrowserContext, member: BrowserContext, publicContext: BrowserContext, origin: string, output: string) {
  assert.equal(Number((await db.query('SELECT count(*) FROM "TravelAdmission"')).rows[0].count), 0);
  const leases = (await db.query('SELECT *, "expiresAt"::text AS "savedExpiry" FROM "TravelLease"')).rows;
  assert.ok(leases.length <= 1 && leases.every(lease => lease.id === 'browser' && lease.state === 'idle'), 'Only the idle migration fixture may precede recovery tests');
  const previousLease = leases[0];
  const snapshots = Number((await db.query('SELECT count(*) FROM "CarSnapshot"')).rows[0].count);
  const page = await admin.newPage();
  try {
    await db.query(`INSERT INTO "TravelAdmission" (id,"quarantinedAt","quarantineReason","recoveryGeneration") VALUES ('singleton',now(),'Fixture: previous browser cleanup could not be verified',1)`);
    await db.query(`INSERT INTO "TravelLease" (id,owner,"expiresAt",state) VALUES ('browser','private-fixture-owner',now(),'quarantined') ON CONFLICT (id) DO UPDATE SET owner='private-fixture-owner',"expiresAt"=now(),state='quarantined'`);
    assert.equal((await member.request.get('/api/admin/travel')).status(), 403);
    assert.equal((await publicContext.request.get('/api/admin/travel')).status(), 401);
    await page.goto(`${origin}/admin`);
    const panel = page.getByRole('region', { name: 'Travel worker recovery' });
    await panel.getByRole('heading', { name: 'Execution paused for recovery' }).waitFor();
    assert.ok(await panel.getByRole('button', { name: 'Confirm recovery' }).isDisabled());
    assert.doesNotMatch(await panel.innerText(), /private-fixture-owner/);
    for (const theme of ['altitude-dark', 'altitude-light']) {
      await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
      for (const width of [1280, 320, 390]) {
        await page.setViewportSize({ width, height: 1000 });
        const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('body *')).filter(element => element.getBoundingClientRect().right > innerWidth + 1).map(element => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right })).slice(0, 20));
        await page.screenshot({ path: resolve(output, `travel-recovery-page-${theme}-${width}.png`), fullPage: true, animations: 'disabled' });
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), JSON.stringify({ width, overflow }));
        await panel.screenshot({ path: resolve(output, `travel-recovery-fixture-${theme}-${width}.png`), animations: 'disabled' });
      }
    }
    for (const locale of ['es', 'fr', 'de', 'pt']) {
      const copy = JSON.parse(await readFile(resolve(`apps/web/messages/${locale}/admin.json`), 'utf8')).AdminTravel;
      await admin.addCookies([{ name: 'ft-locale', value: locale, url: origin }]); await page.reload();
      const localized = page.getByRole('region', { name: copy.title }); await localized.getByRole('heading', { name: copy.paused }).waitFor();
      assert.ok(await localized.getByRole('button', { name: copy.recover }).isDisabled());
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await localized.screenshot({ path: resolve(output, `travel-recovery-fixture-${locale}-390.png`) });
    }
    await admin.addCookies([{ name: 'ft-locale', value: 'en', url: origin }]); await page.reload();
    await panel.getByRole('heading', { name: 'Execution paused for recovery' }).waitFor();
    await panel.getByRole('checkbox').nth(0).focus(); await page.keyboard.press('Space');
    assert.ok(await panel.getByRole('button', { name: 'Confirm recovery' }).isDisabled());
    await panel.getByRole('checkbox').nth(1).check();
    await page.route('**/api/admin/travel', async route => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch(); assert.equal(response.status(), 200, await response.text()); await route.abort();
    });
    await panel.getByRole('button', { name: 'Confirm recovery' }).click();
    await panel.getByRole('alert').filter({ hasText: 'Recovery is not confirmed' }).waitFor();
    assert.ok(await panel.getByRole('button', { name: 'Confirm recovery' }).isDisabled());
    await panel.screenshot({ path: resolve(output, 'travel-recovery-lost-ack-390.png') });
    await page.unroute('**/api/admin/travel'); await panel.getByRole('button', { name: 'Refresh status' }).click();
    await panel.getByRole('heading', { name: 'Ready for work' }).waitFor();
    assert.equal(await panel.getByText('Admission reopened. Queued work may resume.', { exact: true }).count(), 0);
    await panel.screenshot({ path: resolve(output, 'travel-recovery-reconciled-390.png') });
    const recovered = (await db.query(`SELECT "recoveryGeneration","recoveredBy","quarantinedAt" FROM "TravelAdmission" WHERE id='singleton'`)).rows[0];
    assert.equal(recovered.recoveryGeneration, 2); assert.equal(recovered.recoveredBy, 'car-browser-bob'); assert.equal(recovered.quarantinedAt, null);
    assert.equal(Number((await db.query('SELECT count(*) FROM "CarSnapshot"')).rows[0].count), snapshots);
    await db.query(`UPDATE "User" SET "isAdmin"=false WHERE id='car-browser-bob'`);
    await panel.getByRole('button', { name: 'Refresh status' }).click();
    await panel.getByRole('alert').filter({ hasText: 'Administrator access is unavailable' }).waitFor();
    assert.equal(await panel.getByRole('heading', { name: 'Ready for work' }).count(), 0);
    await panel.screenshot({ path: resolve(output, 'travel-recovery-access-lost-390.png') });
  } finally {
    await page.close(); await admin.addCookies([{ name: 'ft-locale', value: 'en', url: origin }]);
    await db.query(`UPDATE "User" SET "isAdmin"=true WHERE id='car-browser-bob'`);
    if (previousLease) await db.query(`UPDATE "TravelLease" SET owner=$1,generation=$2,"expiresAt"=$3::timestamp,state=$4,"topologyVersion"=$5 WHERE id='browser'`, [previousLease.owner, previousLease.generation, previousLease.savedExpiry, previousLease.state, previousLease.topologyVersion]);
    else await db.query(`DELETE FROM "TravelLease" WHERE id='browser'`);
    await db.query(`DELETE FROM "TravelAdmission" WHERE id='singleton'`);
  }
}

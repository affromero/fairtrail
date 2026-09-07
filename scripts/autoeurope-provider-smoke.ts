import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchBrowser } from '../apps/web/src/lib/scraper/browser';
import { navigateAutoEuropeSearch } from '../apps/web/src/lib/cars/autoeurope-navigation';
import { validateCarSearch } from '../apps/web/src/lib/cars/validation';
import { captureAutoEuropeDetail } from '../apps/web/src/lib/cars/autoeurope-capture';
import { extractAutoEuropeOffer } from '../apps/web/src/lib/cars/autoeurope-extraction';
import { assessCarPrice } from '../apps/web/src/lib/cars/pricing';
import { carContractIdentity } from '../apps/web/src/lib/cars/identity';
import { navigateCarPage } from '../apps/web/src/lib/cars/navigation';
import { verifyCarProviderContext } from '../apps/web/src/lib/cars/provider-context';

async function main() {
process.umask(0o077);
const root = '/tmp/flight-finder-autoeurope-provider';
await mkdir(root, { recursive: true });
const output = await mkdtemp(join(root, 'run-'));
const pickup = new Date(); pickup.setUTCMonth(pickup.getUTCMonth() + 1, 15);
const dropoff = new Date(pickup); dropoff.setUTCDate(dropoff.getUTCDate() + 3);
const location = { name: 'London Heathrow Airport', country: 'GB', timeZone: 'Europe/London', providerIds: { autoeurope: '547' } };
let search = validateCarSearch({
  pickup: location, dropoff: location,
  pickupAt: { date: pickup.toISOString().slice(0, 10), time: '12:00' }, dropoffAt: { date: dropoff.toISOString().slice(0, 10), time: '12:00' },
  driver: { age: Number(process.env.CAR_SMOKE_AGE ?? 35), licenceYears: 2, residenceCountry: process.env.CAR_SMOKE_RESIDENCE ?? 'US' },
  currency: process.env.CAR_SMOKE_CURRENCY ?? 'USD', sources: ['autoeurope'],
});
const browser = await launchBrowser();
const context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
console.log(`Private Auto Europe evidence: ${output}`);
try {
  const { links: offers } = await navigateAutoEuropeSearch(page, search);
  assert.ok(offers.length);
  await page.screenshot({ path: join(output, 'search.png'), fullPage: true });
  const detail = await context.newPage();
  if (process.env.CAR_SMOKE_PROTECTION === 'true') {
    await navigateCarPage(detail, offers[0]!, 'autoeurope');
    verifyCarProviderContext(detail.url(), 'autoeurope', search);
    const buttons = detail.locator('[data-cy^="go_to_checkout_button_"]:visible');
    await buttons.first().waitFor();
    const choices = await buttons.evaluateAll(elements => elements.map(element => ({
      productId: element.getAttribute('data-cy')?.replace(/^go_to_checkout_button_/, ''),
      label: element.textContent?.replace(/\s+/g, ' ').trim(),
    })));
    await writeFile(join(output, 'protection-choices.json'), JSON.stringify(choices, null, 2));
    assert.ok(choices.length <= 8, 'Protection choices must remain bounded');
    const selected = choices.find(choice => choice.productId !== 'basic' && choice.productId && /^[A-Za-z0-9.]+$/.test(choice.productId));
    assert.ok(selected?.productId && selected.label, 'Current quote must offer an identified protection product');
    search = validateCarSearch({ ...search, extras: { ...search.extras, protection: [{ source: 'autoeurope', productId: selected.productId }] } });
  }
  const capture = await captureAutoEuropeDetail(detail, offers[0]!, search);
  await writeFile(join(output, 'capture.json'), JSON.stringify(capture));
  const offer = extractAutoEuropeOffer(capture, search);
  assert.ok('contract' in offer, 'reasons' in offer ? offer.reasons.join('; ') : 'Complete rental contract required');
  const assessment = assessCarPrice(offer, search);
  assert.equal(assessment.eligible, true, assessment.reasons.join('; '));
  for (const selected of search.extras.protection) {
    assert.ok(offer.extras.some(extra => extra.kind === 'protection' && extra.productId === selected.productId && extra.eligibility.value === true), 'Selected observed protection must be present and eligible in the extracted quote');
  }
  const terms = capture.sections.map(section => `${section.title}: ${section.text}`).join('\n');
  assert.match(terms, /Driver Age/);
  assert.match(terms, /Required Documents/);
  assert.match(terms, /Mandatory Taxes & Fees/);
  await writeFile(join(output, 'terms.txt'), terms);
  await detail.screenshot({ path: join(output, 'terms.png'), fullPage: true });
  const { links: freshOffers } = await navigateAutoEuropeSearch(page, search);
  assert.ok(freshOffers.length);
  assert.notEqual(freshOffers[0], offers[0], 'Fresh discovery must create a new quote session');
  const refreshed = extractAutoEuropeOffer(await captureAutoEuropeDetail(detail, freshOffers[0]!, search), search);
  assert.ok('contract' in refreshed, 'Fresh quote must still expose its complete rental contract');
  assert.equal(carContractIdentity(refreshed.contract), carContractIdentity(offer.contract), 'Selected contract survives a new quote session');
  assert.equal(assessCarPrice(refreshed, search).eligible, true, 'Fresh detail retains verified price eligibility');
  await writeFile(join(output, 'result.json'), JSON.stringify({ passed: true, search, stages: ['search', 'selected-detail', 'empty-checkout-terms', 'fresh-search', 'fresh-selected-detail', 'stable-contract', 'verified-total'] }, null, 2));
  console.log('PASS Auto Europe real search, quote detail, rental terms and fresh discovery');
} catch (error) {
  await writeFile(join(output, 'failure.json'), JSON.stringify({ error: error instanceof Error ? error.stack : String(error) }, null, 2));
  for (const [index, openPage] of context.pages().entries()) {
    await writeFile(join(output, `failure-${index}.txt`), await openPage.locator('body').innerText()).catch(() => undefined);
    await openPage.screenshot({ path: join(output, `failure-${index}.png`), fullPage: true }).catch(() => undefined);
  }
  throw error;
} finally { await browser.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchBrowser } from '../apps/web/src/lib/scraper/browser';
import type { BrowserContext, Page } from 'playwright';
import { discoverCarsOfferFromScripts } from '../apps/web/src/lib/cars/discovercars-rendered';
import { navigateCarPage } from '../apps/web/src/lib/cars/navigation';
import { captureDiscoverCarsDetail } from '../apps/web/src/lib/cars/discovercars-capture';
import { validateCarSearch } from '../apps/web/src/lib/cars/validation';
import { discoverCarsFixedDeposit } from '../apps/web/src/lib/cars/discovercars-deposit';
import { extractDiscoverCarsOffer } from '../apps/web/src/lib/cars/discovercars-extraction';
import { assessCarPrice } from '../apps/web/src/lib/cars/pricing';
import { carContractIdentity } from '../apps/web/src/lib/cars/identity';
import { navigateDiscoverCarsSearch, submitDiscoverCarsSearch } from '../apps/web/src/lib/cars/discovercars-navigation';
import { verifyCarProviderContext } from '../apps/web/src/lib/cars/provider-context';

// Read-only provider feasibility gate. This never proceeds into booking,
// creates an account, supplies personal details, or touches the application DB.
const outputRoot = resolve(process.env.CAR_SMOKE_OUTPUT ?? '/tmp/flight-finder-car-provider');
let output = outputRoot;
process.umask(0o077);
const oneWay = process.env.CAR_SMOKE_ONE_WAY === 'true';
const driverAge = Number(process.env.CAR_SMOKE_AGE ?? 35);
const residenceCountry = process.env.CAR_SMOKE_RESIDENCE ?? 'US';
assert.ok(['US', 'GB'].includes(residenceCountry), 'Smoke residence must be US or GB');
assert.ok(driverAge === 35 || driverAge === 23, 'Smoke scenarios cover ages 35 and 23');
const pickup = new Date();
pickup.setUTCMonth(pickup.getUTCMonth() + 1, 15);
const dropoff = new Date(pickup);
dropoff.setUTCDate(dropoff.getUTCDate() + 3);
const isoDate = (date: Date) => date.toISOString().slice(0, 10);
const pickupLocation = { name: 'London Airport Heathrow (LHR)', country: 'GB', timeZone: 'Europe/London', providerIds: { discovercars: '1712' } };
const dropoffLocation = oneWay ? { ...pickupLocation, name: 'London Airport Gatwick (LGW)', providerIds: { discovercars: '1600' } } : pickupLocation;
const baseCriteria = validateCarSearch({ pickup: pickupLocation, dropoff: dropoffLocation, pickupAt: { date: isoDate(pickup), time: '11:00' }, dropoffAt: { date: isoDate(dropoff), time: '11:00' }, driver: { age: driverAge, licenceYears: 2, residenceCountry }, currency: 'USD', sources: ['discovercars'] });

async function capture(page: Page, name: string) {
  await writeFile(resolve(output, `${name}.html`), await page.content());
  await writeFile(resolve(output, `${name}.txt`), await page.locator('body').innerText());
  await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true });
}

async function main() {
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  output = await mkdtemp(resolve(outputRoot, 'run-'));
  console.log(`Private browser evidence: ${output}`);
  const browser = await launchBrowser();
  let context: BrowserContext | undefined;
  try {
    context = await browser.newContext({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    page.setDefaultNavigationTimeout(45_000);
    const links = await navigateDiscoverCarsSearch(page, baseCriteria);
    const request = verifyCarProviderContext(page.url(), 'discovercars', baseCriteria);
    await page.getByRole('button', { name: 'USD', exact: true }).waitFor();
    await capture(page, 'search');
    const href = links[0];
    assert.ok(href);
    const detailUrl = new URL(href, page.url());
    assert.equal(detailUrl.origin, 'https://www.discovercars.com');
    assert.ok(detailUrl.pathname.startsWith('/offer/'));
    const detail = await context.newPage();
    detail.setDefaultTimeout(30_000);
    await navigateCarPage(detail, detailUrl.href, 'discovercars');
    await detail.getByRole('button', { name: 'See all rental conditions', exact: true }).waitFor();
    const text = await detail.locator('body').innerText();
    assert.match(text, /Total for 3 days/);
    assert.match(text, /Pay now/);
    assert.match(text, /To pay at pick-up/);
    assert.match(text, /or similar/);
    const summary = detail.locator('.OfferPriceBreakdown:visible').first();
    const money = (value: string) => {
      const match = value.match(/\$([\d,]+\.\d{2})/);
      assert.ok(match, `Expected a USD amount: ${value}`);
      return Math.round(Number(match[1]!.replaceAll(',', '')) * 100);
    };
    const total = money(await summary.locator('.OfferPriceBreakdown-AmountPriceBlock').innerText());
    const charges = await summary.locator('.OfferPriceBreakdown-Extra').allTextContents();
    assert.equal(charges.reduce((sum, charge) => sum + money(charge), 0), total, 'Pay-now and counter charges reconcile without adding the deposit');
    if (oneWay) assert.ok(charges.some(charge => /One-way rental/i.test(charge)), 'One-way charge is itemized');
    if (driverAge === 23) assert.ok(charges.some(charge => /Young driver fee/i.test(charge)), 'Age-related charge is itemized');
    await capture(detail, 'detail');
    const scripts = await detail.locator('script:not([src])').allTextContents();
    const renderedOffer = discoverCarsOfferFromScripts(scripts, detailUrl.pathname.split('/').at(-1)!);
    const deposit = discoverCarsFixedDeposit(renderedOffer.deposit);
    if (deposit) {
      assert.equal(deposit.currency, 'USD');
      assert.equal(money(await summary.locator('.OfferPriceBreakdown-Info').first().innerText()), deposit.minor, 'Disclosed deposit matches its separate display');
    }
    await writeFile(resolve(output, 'rendered-offer.json'), JSON.stringify(renderedOffer));
    await detail.getByRole('button', { name: 'See all rental conditions', exact: true }).click();
    const conditions = detail.frameLocator('.IframeRentalConditions-Iframe iframe').locator('body');
    await conditions.getByText(/Minimum rental age|Minimum age|Driver requirements/i).first().waitFor();
    await conditions.getByText('Show more information', { exact: true }).click();
    await conditions.locator('[data-section="rate-includes"]').click();
    const conditionText = await conditions.innerText();
    const included = conditionText.split('Rate includes')[1]?.split('Optional extras')[0];
    assert.ok(included, 'Included rate charges are available');
    assert.match(included, /VAT|value added tax|State Tax/i, 'Taxes are listed as included');
    const ages = conditionText.match(/Aged (\d+)\s*-\s*(\d+)/);
    assert.ok(ages, 'Supplier discloses eligible ages');
    assert.ok(driverAge >= Number(ages[1]) && driverAge <= Number(ages[2]), 'Requested age is eligible for the sampled offer');
    await writeFile(resolve(output, 'rental-conditions.txt'), conditionText);
    await writeFile(resolve(output, 'rental-conditions.html'), await conditions.innerHTML());
    await capture(detail, 'conditions');
    const coverageId = String((renderedOffer.coverage as { id?: unknown }).id);
    const criteria = validateCarSearch({ ...baseCriteria, extras: { protection: process.env.CAR_SMOKE_PROTECTION === 'true' ? [{ source: 'discovercars', productId: coverageId }] : [] } });
    const observed = await captureDiscoverCarsDetail(detail, detailUrl.href, criteria, page);
    assert.ok(observed.sections.some(section => section.title === 'document' && /license|licence/i.test(section.text)));
    await writeFile(resolve(output, 'capture.json'), JSON.stringify(observed));
    const verified = extractDiscoverCarsOffer(observed, criteria);
    if (residenceCountry === 'GB') assert.ok('contract' in verified, 'UK-resident scenario must expose a complete contract');
    if ('contract' in verified) assert.equal(assessCarPrice(verified, criteria).eligible, true, 'Displayed all-in price is eligible');
    else assert.ok(verified.reasons.length, 'An incomplete quote exposes the reason it cannot qualify');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('a.SearchCar-CtaBtn:visible').first().waitFor();
    assert.equal(verifyCarProviderContext(page.url(), 'discovercars', criteria), request, 'Repeat search preserves its pricing context');
    await capture(page, 'repeat');
    const freshLinks = await submitDiscoverCarsSearch(page, criteria);
    assert.equal(verifyCarProviderContext(page.url(), 'discovercars', criteria), request, 'Fresh discovery preserves its pricing context');
    await capture(page, 'fresh-search');
    const freshLink = freshLinks[0];
    assert.ok(freshLink);
    const freshCapture = await captureDiscoverCarsDetail(detail, new URL(freshLink, page.url()).href, criteria, page);
    const fresh = extractDiscoverCarsOffer(freshCapture, criteria);
    await writeFile(resolve(output, 'fresh-capture.json'), JSON.stringify(freshCapture));
    if ('contract' in verified) {
      assert.ok('contract' in fresh, 'Fresh discovery exposes the selected contract');
      assert.equal(carContractIdentity(fresh.contract), carContractIdentity(verified.contract));
      assert.equal(assessCarPrice(fresh, criteria).eligible, true);
    } else assert.ok(!('contract' in fresh) || assessCarPrice(fresh, criteria).eligible, 'Fresh quotes remain explicitly classified');
    await writeFile(resolve(output, 'result.json'), JSON.stringify({ passed: true, provider: 'discovercars', request, totalCents: total, charges, completeContract: 'contract' in verified, stages: ['search', 'detail', 'conditions', 'repeat', 'fresh-search', 'fresh-detail', 'contract-and-eligibility'] }, null, 2));
    console.log('PASS DiscoverCars search, deposit disclosure, rental conditions and repeat context');
  } catch (error) {
    for (const [index, openPage] of (context?.pages() ?? []).entries()) {
      await capture(openPage, `failure-${index}`).catch(() => undefined);
      await writeFile(resolve(output, `failure-${index}-frames.json`), JSON.stringify(openPage.frames().map(frame => frame.url())));
    }
    await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: String(error) }, null, 2));
    throw error;
  } finally {
    await browser.close();
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { launchBrowser } from '../apps/web/src/lib/scraper/browser';
import { TravelExecution, withTravelExecution } from '../apps/web/src/lib/travel/execution';
import { navigateDiscoverCarsSearch } from '../apps/web/src/lib/cars/discovercars-navigation';
import { captureDiscoverCarsDetail } from '../apps/web/src/lib/cars/discovercars-capture';
import { extractDiscoverCarsOffer } from '../apps/web/src/lib/cars/discovercars-extraction';
import { validateCarSearch } from '../apps/web/src/lib/cars/validation';
import { assessCarPrice } from '../apps/web/src/lib/cars/pricing';

// Read-only provider gate: no booking submission, login, database or VPN changes.
process.umask(0o077);
const root = resolve(process.env.CAR_CONTRACT_SMOKE_OUTPUT ?? '/tmp/flight-finder-car-contracts');
await mkdir(root, { recursive: true, mode: 0o700 });
const output = await mkdtemp(resolve(root, 'run-'));
console.log(`Private contract evidence: ${output}`);
const pickup = new Date(); pickup.setUTCMonth(pickup.getUTCMonth() + 1, 15);
const dropoff = new Date(pickup); dropoff.setUTCDate(dropoff.getUTCDate() + 3);
const location = { name: 'London Airport Heathrow (LHR)', country: 'GB', timeZone: 'Europe/London', providerIds: { discovercars: '1712' } };
const search = validateCarSearch({ pickup: location, dropoff: location,
  pickupAt: { date: pickup.toISOString().slice(0, 10), time: '11:00' }, dropoffAt: { date: dropoff.toISOString().slice(0, 10), time: '11:00' },
  driver: { age: 35, licenceYears: 2, residenceCountry: 'GB' }, currency: 'GBP', sources: ['discovercars'],
});
await writeFile(resolve(output, 'request.json'), JSON.stringify(search, null, 2));
const execution = new TravelExecution({ jobId: `contract-smoke-${crypto.randomUUID()}`, generation: 1, resource: 'browser' });
const stop = () => execution.abort(new Error('Contract smoke interrupted'));
process.once('SIGINT', stop); process.once('SIGTERM', stop);
const deadline = setTimeout(() => execution.abort(new Error('Contract smoke exceeded five minutes')), 300_000);
try {
  await withTravelExecution(execution, async () => {
    const browser = await launchBrowser();
    const context = await browser.newContext({ locale: 'en-US', timezoneId: search.pickup.timeZone, viewport: { width: 1440, height: 1000 } });
    const page = await context.newPage(), detail = await context.newPage();
    const discovery = await navigateDiscoverCarsSearch(page, search);
    const results = [];
    for (const [index, url] of discovery.links.entries()) {
      execution.check();
      const capture = await captureDiscoverCarsDetail(detail, url, search, page);
      const offer = extractDiscoverCarsOffer(capture, search);
      const assessment = 'contract' in offer ? assessCarPrice(offer, search) : { eligible: false, reasons: offer.reasons };
      await writeFile(resolve(output, `capture-${index}.json`), JSON.stringify(capture, null, 2));
      await writeFile(resolve(output, `detail-${index}.html`), await detail.content());
      const result = { supplier: capture.visibleSupplier, model: capture.visibleModel, completeContract: 'contract' in offer,
        eligible: assessment.eligible, reasons: assessment.reasons, offer };
      results.push(result);
      console.log(JSON.stringify({ index, supplier: result.supplier, model: result.model, completeContract: result.completeContract, eligible: result.eligible, reasons: result.reasons }));
      await writeFile(resolve(output, 'observations.json'), JSON.stringify(results, null, 2));
    }
    assert.ok(results.length > 0, 'Provider must return rental observations');
    assert.ok(results.some(result => result.eligible), 'At least one all-in contract must be eligible');
    assert.ok(results.every(result => !result.reasons.some(reason => /Invalid provider field|Unresolved .*office/i.test(reason))), 'Provider prose and text references must parse without dropping terms');
    await writeFile(resolve(output, 'result.json'), JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), checked: results.length,
      completeContracts: results.filter(result => result.completeContract).length, eligible: results.filter(result => result.eligible).length }, null, 2));
    console.log('PASS headless DiscoverCars contracts retain office terms and checked prices');
  });
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error instanceof Error ? error.stack : String(error) }, null, 2));
  throw error;
} finally {
  clearTimeout(deadline); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
}

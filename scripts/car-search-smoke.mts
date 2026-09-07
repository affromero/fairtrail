import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { searchCars } from '../apps/web/src/lib/cars/search';
import { carSearchIntent } from '../apps/web/src/lib/cars/search-input';
import { getCarCatalogPlace } from '../apps/web/src/lib/cars/locations';
import { assessCarPrice } from '../apps/web/src/lib/cars/pricing';
import { carContractHash } from '../apps/web/src/lib/cars/selection';
import { validateCarSearch } from '../apps/web/src/lib/cars/validation';
import { TravelExecution, withTravelExecution } from '../apps/web/src/lib/travel/execution';

// Read-only live gate using the production provider orchestration. No database,
// VPN changes, booking submission, accounts or personal details are involved.
process.umask(0o077);
const outputRoot = resolve(process.env.CAR_SEARCH_SMOKE_OUTPUT ?? '/tmp/flight-finder-car-search');
await mkdir(outputRoot, { recursive: true, mode: 0o700 });
const output = await mkdtemp(resolve(outputRoot, 'run-'));
console.log(`Private live-search evidence: ${output}`);
const pickup = new Date(); pickup.setUTCMonth(pickup.getUTCMonth() + 1, 15);
const dropoff = new Date(pickup); dropoff.setUTCDate(dropoff.getUTCDate() + 3);
const location = await getCarCatalogPlace('ourairports:2434');
const search = await carSearchIntent({
  pickup: { id: location.id, version: location.version }, dropoff: { id: location.id, version: location.version },
  pickupAt: { date: pickup.toISOString().slice(0, 10), time: '11:00' },
  dropoffAt: { date: dropoff.toISOString().slice(0, 10), time: '11:00' },
  driver: { age: 35, licenceYears: 2, residenceCountry: 'GB' },
  currency: process.env.CAR_SEARCH_SMOKE_CURRENCY ?? 'GBP', sources: ['discovercars', 'autoeurope'],
});
await writeFile(resolve(output, 'request.json'), JSON.stringify(search, null, 2));
let execution = new TravelExecution({ jobId: `live-smoke-${crypto.randomUUID()}`, generation: 1, resource: 'browser' });
const recheckProtection = process.env.CAR_SEARCH_SMOKE_RECHECK === 'true';
const discoverProtection = recheckProtection || process.env.CAR_SEARCH_SMOKE_PROTECTION === 'true';
const interrupted = () => execution.abort(new Error('Live search interrupted'));
process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
const diagnostics: { source: string; error: string }[] = [];
try {
  const result = await withTravelExecution(execution, () => searchCars(search, {
    discoverProtection,
    onLocationResolution: async resolved => {
      Object.assign(search, { pickup: resolved.pickup, dropoff: resolved.dropoff });
      await writeFile(resolve(output, 'resolved-request.json'), JSON.stringify(search, null, 2));
    },
    onProgress: async (report, signal) => {
      signal.throwIfAborted();
      await writeFile(resolve(output, 'progress.json'), JSON.stringify(report, null, 2), { signal });
      console.log(report.providers.map(provider => `${provider.source}: ${provider.status}, ${provider.checked} offers checked`).join('; '));
    },
    onDiagnostic: (source, error) => { diagnostics.push({ source, error: error instanceof Error ? error.stack ?? error.message : String(error) }); },
  }));
  await writeFile(resolve(output, 'report.json'), JSON.stringify(result, null, 2));
  const assessments = result.offers.map(offer => ({ source: offer.contract.source, offerId: offer.id, assessment: assessCarPrice(offer, search) }));
  await writeFile(resolve(output, 'assessments.json'), JSON.stringify(assessments, null, 2));
  const providers = search.sources.map(source => ({ source, verified: assessments.filter(value => value.source === source && value.assessment.eligible).length, candidates: result.candidates.filter(value => value.source === source).length }));
  console.log(JSON.stringify(providers));
  assert.equal(result.scope, 'checked_provider_offers');
  assert.equal(result.completed, search.sources.length);
  for (const provider of providers) assert.ok(provider.verified > 0, `${provider.source} did not return an eligible all-in quote; inspect the private report`);
  assert.ok(result.providers.every(provider => provider.status === 'complete'), 'Both providers must finish their bounded checks');
  if (discoverProtection) {
    assert.equal(result.protection?.length, result.offers.length, 'Every complete quote must have checked protection options');
    for (const source of search.sources) assert.ok(result.protection?.some(entry => entry.status === 'complete' && entry.choices.some(choice => choice.source === source)), `${source} must expose an observed protection product`);
  }
  if (recheckProtection) {
    for (const source of search.sources) {
      const base = result.offers.find(offer => offer.contract.source === source && assessCarPrice(offer, search).eligible
        && result.protection?.some(entry => entry.offerId === offer.id && entry.status === 'complete' && entry.choices.length));
      assert.ok(base, `${source} requires an eligible base quote with observed protection`);
      const choice = result.protection!.find(entry => entry.offerId === base.id)!.choices[0]!;
      const protectedSearch = validateCarSearch({ ...search, sources: [source], extras: { ...search.extras, protection: [{ source, productId: choice.productId }] },
        protectionRecheck: { searchId: 'live-original', offerId: base.id, choiceId: choice.id, baseContractHash: carContractHash(base.contract), baseCoverageTerms: base.contract.coverageTerms } });
      await writeFile(resolve(output, `${source}-recheck-request.json`), JSON.stringify(protectedSearch, null, 2));
      execution = new TravelExecution({ jobId: `live-protection-${crypto.randomUUID()}`, generation: 1, resource: 'browser' });
      const protectedResult = await withTravelExecution(execution, () => searchCars(protectedSearch, {
        onProgress: async (report, signal) => {
          signal.throwIfAborted();
          await writeFile(resolve(output, `${source}-recheck-progress.json`), JSON.stringify(report, null, 2), { signal });
          console.log(`${source} protection recheck: ${report.providers[0]?.checked ?? 0} checked`);
        },
        onDiagnostic: (source, error) => { diagnostics.push({ source, error: error instanceof Error ? error.stack ?? error.message : String(error) }); },
      }));
      await writeFile(resolve(output, `${source}-recheck-report.json`), JSON.stringify(protectedResult, null, 2));
      const eligible = protectedResult.offers.filter(offer => assessCarPrice(offer, protectedSearch).eligible);
      assert.ok(eligible.length, `${source} did not reverify the selected base rental with protection; inspect the private report`);
      assert.ok(protectedResult.providers.every(provider => provider.status === 'complete'), `${source} protected recheck did not finish`);
      console.log(`PASS ${source} fresh protected rental: ${eligible.length} eligible quote(s)`);
    }
  }
  await writeFile(resolve(output, 'result.json'), JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), providers, scope: result.scope }, null, 2));
  console.log('PASS live two-provider search returned independently verified rental totals');
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ error: error instanceof Error ? error.stack ?? error.message : String(error) }, null, 2));
  throw error;
} finally {
  process.removeListener('SIGINT', interrupted); process.removeListener('SIGTERM', interrupted);
  await writeFile(resolve(output, 'diagnostics.json'), JSON.stringify(diagnostics, null, 2));
}

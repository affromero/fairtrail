import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { launchBrowser } from '../apps/web/src/lib/scraper/browser';
import { captureDiscoverCarsProtection, discoverDiscoverCarsProtection } from '../apps/web/src/lib/cars/discovercars-protection';
import { carRecord } from '../apps/web/src/lib/cars/validation';

async function main() {
  process.umask(0o077);
  const input = process.argv[2];
  assert.ok(input?.startsWith('/tmp/flight-finder-car-provider/run-') && input.endsWith('/capture.json'), 'Pass a private capture from the provider smoke test');
  const capture = JSON.parse(await readFile(input, 'utf8')) as { url: string; offer: unknown };
  const product = carRecord(carRecord(capture.offer).coverage);
  assert.equal(typeof product.id, 'number', 'Source quote identifies an actual protection product');
  const output = await mkdtemp(join(dirname(input), 'coverage-'));
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ locale: 'en-US', viewport: { width: 1440, height: 1000 } });
    const offered = await discoverDiscoverCarsProtection(page, capture.url);
    assert.equal(offered.productId, String(product.id));
    assert.ok(offered.termsSummary.length > 100, 'Unselected protection exposes coverage and exclusions');
    assert.ok(offered.policyLinks.length, 'Provider policy documents are available before selection');
    await writeFile(join(output, 'offered.json'), JSON.stringify(offered));
    await page.screenshot({ path: join(output, 'offered.png'), fullPage: true, animations: 'disabled' });
    const selected = await captureDiscoverCarsProtection(page, capture.url, String(product.id));
    assert.equal(selected.selected, true);
    assert.equal(selected.productId, String(product.id));
    assert.ok(selected.priceLines.some(charge => charge.label === selected.name && charge.payment === 'now'));
    assert.ok(selected.terms.length > 100, 'Provider coverage and exclusions were captured');
    await writeFile(join(output, 'selected.json'), JSON.stringify(selected));
    await page.screenshot({ path: join(output, 'selected.png'), fullPage: true, animations: 'disabled' });
    console.log(`PASS selected protection with visible price and exclusions. Private evidence: ${output}`);
  } finally { await browser.close(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });

import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.argv[2] ?? 'http://127.0.0.1:3396';
const url = new URL(base);
if (!['127.0.0.1', 'localhost'].includes(url.hostname)) throw new Error('Use a disposable local Flight Finder instance');

const parsed = {
  origins: [{ code: 'YUL', name: 'Montreal' }], destinations: [{ code: 'NRT', name: 'Tokyo' }],
  dateFrom: '2027-04-15', dateTo: '2027-04-30', tripType: 'round_trip', flexibility: 0,
  cabinClass: 'economy', currency: 'CAD', maxPrice: null, maxStops: 0, maxDurationHours: null,
  preferredAirlines: [], timePreference: 'any',
};
const fare = {
  travelDate: parsed.dateFrom, price: 1809, currency: 'CAD', airline: 'Air Canada',
  bookingUrl: 'https://example.com/round-trip', stops: 0, duration: '13h 20m', layovers: null,
  departureTime: '1:05 PM', arrivalTime: '3:25 PM', seatsLeft: null, flightNumber: 'AC 5',
};
const route = {
  origin: 'YUL', originName: 'Montreal', destination: 'NRT', destinationName: 'Tokyo',
  date: parsed.dateFrom, returnDate: parsed.dateTo, flights: [],
  error: 'Round-trip fares did not load.',
  oneWayEstimate: {
    totalPrice: 2991, currency: 'CAD',
    outbound: { ...fare, price: 1791, bookingUrl: 'https://example.com/outbound' },
    inbound: { ...fare, airline: 'ANA', price: 1200, travelDate: parsed.dateTo, bookingUrl: 'https://example.com/inbound' },
  },
};

const browser = await chromium.launch({ headless: true });
const passed = [];

async function scenario(name, routes, check, viewport = { width: 1280, height: 1000 }) {
  const context = await browser.newContext({ viewport, locale: 'en-US' });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const errors = [];
  const submissions = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/setup/status', intercepted => intercepted.fulfill({ json: { setupComplete: true, needsSetup: false } }));
  await context.addInitScript(saved => sessionStorage.setItem('ft-preview-run', JSON.stringify(saved)), {
    previewRunId: 'pricing-browser-test', parsed, query: 'Montreal to Tokyo', manualRawInput: '', vpnCountries: [], startedAt: Date.now(),
  });
  await page.route('**/api/preview/pricing-browser-test', intercepted => intercepted.fulfill({
    json: { ok: true, data: { id: 'pricing-browser-test', status: 'completed', result: { routes }, error: null, expiresAt: new Date(Date.now() + 60_000).toISOString() } },
  }));
  await page.route('**/api/queries', async intercepted => {
    if (intercepted.request().method() !== 'POST') return intercepted.continue();
    submissions.push(intercepted.request().postDataJSON());
    return intercepted.fulfill({ json: { ok: true, data: { queries: [] } } });
  });
  try {
    await page.goto(base);
    await page.getByRole('region', { name: 'Separate one-way ticket estimate' }).waitFor();
    await check(page, submissions);
    assert.deepEqual(errors, [], `${name}: browser errors`);
    passed.push(name);
  } finally {
    await context.close();
  }
}

try {
  await scenario('estimate-only preview has no selectable fares', [route], async page => {
    const estimate = page.getByRole('region', { name: 'Separate one-way ticket estimate' });
    assert.match(await estimate.innerText(), /2,991/);
    assert.match(await estimate.innerText(), /Round-trip fares could not be retrieved/);
    assert.match(await estimate.innerText(), /YUL → NRT.*Apr 15/);
    assert.match(await estimate.innerText(), /NRT → YUL.*Apr 30/);
    assert.equal(await page.getByRole('button', { name: 'Track 0 flights', exact: true }).isDisabled(), true);
    assert.deepEqual(await estimate.getByRole('link').evaluateAll(links => links.map(link => link.href)), ['https://example.com/outbound', 'https://example.com/inbound']);
    await estimate.locator('..').screenshot({ path: '/tmp/flight-finder-216-estimate.png' });
  });
  await scenario('mixed previews submit only actual fares', [
    { ...route, returnDate: '2027-04-29', flights: [fare], error: undefined, oneWayEstimate: undefined }, route,
  ], async (page, submissions) => {
    const submitted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/queries' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Track 1 flight', exact: true }).click();
    await submitted;
    assert.equal(submissions.length, 1);
    assert.equal(submissions[0].routes.length, 1);
    assert.equal(submissions[0].routes[0].returnDate, '2027-04-29');
    assert.deepEqual(submissions[0].routes[0].selectedFlights, [fare]);
  });
  await scenario('estimate links reject executable URLs', [{ ...route, oneWayEstimate: {
    ...route.oneWayEstimate,
    outbound: { ...route.oneWayEstimate.outbound, bookingUrl: 'javascript:alert(1)' },
    inbound: { ...route.oneWayEstimate.inbound, bookingUrl: 'data:text/html,bad' },
  } }], async page => {
    assert.equal(await page.getByRole('region', { name: 'Separate one-way ticket estimate' }).getByRole('link').count(), 0);
  });
  await scenario('estimate stays readable on mobile', [route], async page => {
    const bounds = await page.getByRole('region', { name: 'Separate one-way ticket estimate' }).boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390);
    const overflow = await page.getByRole('region', { name: 'Separate one-way ticket estimate' }).evaluate(element => element.scrollWidth > element.clientWidth);
    assert.equal(overflow, false);
  }, { width: 390, height: 844 });
  console.log(JSON.stringify({ passed }, null, 2));
} finally {
  await browser.close();
}

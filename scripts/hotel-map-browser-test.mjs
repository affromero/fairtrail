import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const server = process.env.HOTEL_MAP_BROWSER_URL ?? 'http://127.0.0.1:3016';
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(server).hostname), 'Use an isolated local server');
const output = resolve(process.env.HOTEL_MAP_BROWSER_OUTPUT ?? '/tmp/flight-finder-hotel-map-browser');
await mkdir(output, { recursive: true });
const caddy = await readFile(new URL('../Caddyfile', import.meta.url), 'utf8');
const csp = caddy.match(/Content-Security-Policy "([^"]+)"/)?.[1];
assert.ok(csp, 'Use the production CSP');
const date = days => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
const base = {
  id: 'strand', source: 'booking', propertyId: 'booking:/hotel/gb/strandpalace.html', hotelName: 'Strand Palace',
  address: '372 Strand, London', imageUrl: null, propertyUrl: 'https://www.booking.com/hotel/gb/strandpalace.html',
  bookingUrl: 'https://www.booking.com/hotel/gb/strandpalace.html', seller: 'Booking.com', roomName: 'Superior double room',
  rateName: 'Free cancellation', totalPrice: 647, currency: 'GBP', taxesIncluded: true, occupancyVerified: true,
  rooms: [{ adults: 2, children: [] }], refundable: true, breakfast: true, stars: 4, rating: 8.6, amenities: {}, match: 'exact',
  checkIn: date(45), checkOut: date(48), location: { propertyId: 'booking:/hotel/gb/strandpalace.html', latitude: 51.510719, longitude: -0.121075 },
};
const offers = [base,
  { ...base, id: 'soho', propertyId: 'soho', hotelName: "Mimi's Hotel Soho", totalPrice: 598, address: '56–57 Frith Street, London', location: { propertyId: 'soho', latitude: 51.5140711, longitude: -0.1319983 } },
  { ...base, id: 'overlap', propertyId: 'overlap', hotelName: 'Co-located hotel fixture', totalPrice: 720, location: { ...base.location, propertyId: 'overlap' } },
  { ...base, id: 'missing', propertyId: 'missing', hotelName: 'Location unavailable fixture', totalPrice: 580, location: null },
  { ...base, id: 'other-stay', checkIn: date(46), checkOut: date(49), totalPrice: 400 },
];
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const results = [];

async function scenario(name, width, mode, test) {
  const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'en-GB', serviceWorkers: 'block' });
  await context.addCookies([{ name: 'map-privacy-canary', value: 'must-not-reach-map-resources', url: server }]);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = []; const traffic = []; const violations = [];
  await page.exposeFunction('recordMapCspViolation', value => violations.push(value));
  await page.addInitScript(() => document.addEventListener('securitypolicyviolation', event => window.recordMapCspViolation({ directive: event.violatedDirective, blocked: event.blockedURI })));
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/openfreemap|versatiles|\/maplibre\/|\/maps\/|unlisted\.example/.test(request.url())) traffic.push({ url: request.url(), headers: request.headers() }); });
  await page.route(`${server}/hotels`, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': csp } });
  });
  await page.route('**/api/hotels**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: { ok: true, data: path === '/api/hotels' ? { trackers: [] } : { id: 'map-browser', status: 'success', result: { offers: mode === 'missing' ? offers.map(offer => ({ ...offer, location: null })) : offers, errors: [], completed: 1, total: 1 } } } });
  });
  if (mode === 'offline') await context.route('https://tiles.openfreemap.org/**', route => route.abort('internetdisconnected'));
  if (mode === 'no-webgl') await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...args) { return String(args[0]).includes('webgl') ? null : original.apply(this, args); };
  });
  if (mode.startsWith('custom')) await page.route(`${server}/maps/**`, route => {
    if (mode === 'custom-redirect') return route.fulfill({ status: 302, headers: { location: 'https://unlisted.example/map.json' } });
    const style = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#d8e5db' } }] };
    if (mode === 'custom-blocked') style.sources = { forbidden: { type: 'vector', url: 'https://unlisted.example/map.json' } };
    return route.fulfill({ json: style });
  });
  try {
    await page.goto(`${server}/hotels`);
    await page.getByLabel('City or hotel name').fill('London');
    await page.getByLabel('Check-in', { exact: true }).fill(base.checkIn);
    await page.getByLabel('Check-out', { exact: true }).fill(base.checkOut);
    await page.getByRole('combobox', { name: /^Currency/ }).selectOption('GBP');
    await page.getByRole('button', { name: 'Search hotels', exact: true }).click();
    await page.getByRole('button', { name: 'Open hotel map', exact: true }).waitFor();
    assert.equal(traffic.length, 0, 'No map requests before activation');
    await page.getByRole('button', { name: 'Open hotel map', exact: true }).click();
    await test({ page, traffic });
    assert.deepEqual(errors, [], 'No uncaught browser exceptions');
    assert.deepEqual(violations, [], 'Production CSP remains satisfied');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'No horizontal page overflow');
    await page.getByRole('heading', { name: 'Find your bearings', exact: true }).first().evaluate(element => { element.scrollIntoView({ block: 'start', behavior: 'instant' }); window.scrollBy(0, -16); });
    await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled' });
    results.push({ name, passed: true, mapRequests: traffic.length });
    console.log(`PASS ${name}`);
  } catch (error) {
    await page.screenshot({ path: resolve(output, `${name}-failure.png`), fullPage: true }).catch(() => undefined);
    throw error;
  } finally { await context.close(); }
}

try {
  for (const width of [1440, 390]) await scenario(`map-success-${width}`, width, 'live', async ({ page, traffic }) => {
    await page.locator('.maplibregl-canvas').waitFor();
    await page.getByText('Loading map…', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await page.getByText(/The map could not load completely/).count(), 0);
    const marker = page.locator('.maplibregl-marker').filter({ hasText: '£598.00' });
    await marker.focus(); await marker.press('Enter');
    assert.equal(await marker.evaluate(element => element === document.activeElement), true, 'Selecting a pin preserves keyboard focus');
    assert.equal(await marker.getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: /Booking.com · Superior double room · £598.00/ }).click();
    assert.equal(await page.locator('#hotel-offer-soho').evaluate(element => element === document.activeElement), true, 'Offer chooser moves keyboard focus to details');
    await page.getByRole('button', { name: 'Hotels at this location: 2', exact: true }).click();
    const chooser = page.getByRole('group', { name: 'Hotels at this location', exact: true });
    for (const hotel of ['Strand Palace · £647.00', 'Co-located hotel fixture · £720.00']) {
      await chooser.getByRole('button', { name: hotel, exact: true }).click();
      assert.equal(await chooser.getByRole('button', { name: hotel, exact: true }).getAttribute('aria-pressed'), 'true', 'Co-located properties are independently selectable with a pointer');
    }
    await chooser.scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(output, `map-overlap-${width}.png`), animations: 'disabled' });
    await page.getByRole('button', { name: 'Close hotel chooser', exact: true }).click();
    await page.getByRole('button', { name: 'Co-located hotel fixture · £720.00', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Co-located hotel fixture · £720.00', exact: true }).getAttribute('aria-pressed'), 'true');
    await page.getByLabel('Stay shown on map').selectOption({ index: 1 });
    assert.equal(await page.locator('.maplibregl-marker').count(), 1);
    assert.match(await page.locator('.maplibregl-marker').innerText(), /400/);
    await page.getByLabel('Stay shown on map').selectOption({ index: 0 });
    const mapTraffic = traffic.filter(entry => entry.url.startsWith('https://tiles.openfreemap.org/'));
    assert.ok(mapTraffic.some(entry => entry.url.endsWith('.pbf')), 'Real vector tiles loaded');
    assert.ok(mapTraffic.every(entry => !entry.headers.cookie && !entry.headers.referer), 'No cookies or referrers sent to map provider');
    assert.ok(traffic.filter(entry => entry.url.includes('/maplibre/')).every(entry => new URL(entry.url).origin === new URL(server).origin), 'Same-origin workers');
  });
  for (const style of ['positron', 'bright']) for (const width of [1440, 390]) await scenario(`map-${style}-${width}`, width, 'live', async ({ page, traffic }) => {
    await page.locator('.maplibregl-canvas').waitFor();
    await page.getByText('Loading map…', { exact: true }).waitFor({ state: 'hidden' });
    const loaded = page.waitForResponse(response => response.url() === `https://tiles.openfreemap.org/styles/${style}` && response.ok());
    await page.getByRole('combobox', { name: /^Map style/ }).selectOption(style);
    await loaded;
    await page.getByText('Loading map…', { exact: true }).waitFor({ state: 'hidden' });
    assert.equal(await page.getByText(/The map could not load completely/).count(), 0);
    assert.equal(await page.locator('.maplibregl-marker').count(), 2, 'Changing map style preserves the hotel markers and overlap group');
    assert.ok(traffic.some(entry => entry.url === `https://tiles.openfreemap.org/styles/${style}`), 'The selected real provider style loaded');
  });
  for (const mode of ['offline', 'no-webgl']) await scenario(`map-${mode}`, 390, mode, async ({ page }) => {
    await page.getByText(/The map could not load completely/).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Track this hotel', exact: true }).count(), offers.length);
    assert.ok(await page.getByRole('button', { name: 'Track this hotel', exact: true }).first().isEnabled());
    await page.getByRole('button', { name: 'Hide map', exact: true }).click();
    assert.equal(await page.locator('.maplibregl-canvas').count(), 0);
    await page.getByRole('button', { name: 'Open hotel map', exact: true }).click();
    await page.getByText(/The map could not load completely/).waitFor();
  });
  const readConfig = async () => {
    const response = await fetch(`${server}/api/admin/hotel-map`);
    assert.equal(response.status, 200, 'Local solo admin settings are available');
    return (await response.json()).data;
  };
  await scenario('map-missing-locations', 390, 'missing', async ({ page, traffic }) => {
    await page.getByText(/No verified hotel locations are available/).waitFor();
    assert.equal(traffic.length, 0, 'Missing coordinates never trigger geocoding or map traffic');
    assert.equal(await page.getByRole('button', { name: 'Track this hotel', exact: true }).count(), offers.length);
  });
  const saveConfig = async (config, current) => {
    const response = await fetch(`${server}/api/admin/hotel-map`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Hotel-Map-Actor': current.actorScope }, body: JSON.stringify({ config, revision: current.revision }) });
    assert.equal(response.status, 200, 'Local fixture configuration saved');
  };
  const initial = await readConfig();
  try {
    await saveConfig({ ...initial.config, provider: 'custom', providerName: 'Local fixture map', styleUrl: '/maps/style.json', resourceOrigins: [] }, initial);
    for (const mode of ['custom', 'custom-blocked', 'custom-redirect']) await scenario(`map-${mode}`, 390, mode, async ({ page, traffic }) => {
      if (mode === 'custom') {
        await page.locator('.maplibregl-canvas').waitFor();
        await page.getByText('Loading map…', { exact: true }).waitFor({ state: 'hidden' });
        assert.equal(await page.getByText(/The map could not load completely/).count(), 0);
        assert.equal(await page.locator('.maplibregl-marker').count(), 2);
        assert.equal(await page.getByRole('combobox', { name: /^Map style/ }).count(), 0, 'Custom maps use their configured style');
      } else await page.getByText(/The map could not load completely/).waitFor();
      const requests = traffic.filter(entry => entry.url.includes('/maps/'));
      assert.ok(requests.length > 0);
      assert.ok(requests.every(entry => !entry.headers.cookie && !entry.headers.referer), 'Same-origin map resources omit application cookies and referrers');
      assert.ok(traffic.every(entry => !entry.url.includes('unlisted.example') && !entry.url.includes('openfreemap')), 'No redirect, unlisted-resource or fallback requests');
      assert.equal(await page.getByRole('button', { name: 'Track this hotel', exact: true }).count(), offers.length);
    });
    await saveConfig({ ...initial.config, provider: 'custom', providerName: 'VersaTiles', styleUrl: 'https://tiles.versatiles.org/assets/styles/colorful/style.json', resourceOrigins: ['https://tiles.versatiles.org'], privacyUrl: 'https://versatiles.org/', attribution: 'VersaTiles · OpenStreetMap contributors', attributionUrl: 'https://www.openstreetmap.org/copyright' }, await readConfig());
    for (const width of [1440, 390]) await scenario(`map-versatiles-${width}`, width, 'versatiles', async ({ page, traffic }) => {
      await page.locator('.maplibregl-canvas').waitFor();
      await page.getByText('Loading map…', { exact: true }).waitFor({ state: 'hidden' });
      assert.equal(await page.getByText(/The map could not load completely/).count(), 0);
      assert.equal(await page.locator('.maplibregl-marker').count(), 2);
      const resources = traffic.filter(entry => new URL(entry.url).hostname === 'tiles.versatiles.org');
      assert.ok(resources.some(entry => entry.url.includes('/tiles/osm/')), 'Real alternative-provider tiles loaded');
      assert.ok(resources.every(entry => !entry.headers.cookie && !entry.headers.referer), 'Alternative-provider resources omit cookies and referrers');
      assert.ok(traffic.every(entry => !entry.url.includes('openfreemap')), 'Alternative provider does not fall back to OpenFreeMap');
    });
  } finally { await saveConfig(initial.config, await readConfig()); }
  await writeFile(resolve(output, 'results.json'), JSON.stringify(results, null, 2));
} finally { await browser.close(); }

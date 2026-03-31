#!/usr/bin/env node
/**
 * Real end-to-end scrape test: navigates Google Flights with our stealth
 * browser, extracts visible text, and verifies results load.
 *
 * This is NOT a mock -- it hits the real Google Flights website.
 *
 * Usage: node --experimental-strip-types scripts/real-scrape-test.mjs
 */

const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

let pass = 0;
let fail = 0;
function ok(msg) { pass++; console.log(`${GREEN}PASS${RESET} ${msg}`); }
function bad(msg, detail) { fail++; console.log(`${RED}FAIL${RESET} ${msg} -- ${detail}`); }
function info(msg) { console.log(`${DIM}${msg}${RESET}`); }

console.log(`\n${BOLD}Real Google Flights scrape test (anti-detection active)${RESET}\n`);

const { launchBrowser, createStealthContext } = await import('../apps/web/src/lib/scraper/browser.ts');
const { COUNTRY_PROFILES } = await import('../apps/web/src/lib/scraper/country-profiles.ts');

function buildGoogleFlightsUrl(params) {
  const dateFrom = params.dateFrom.toISOString().split('T')[0];
  const dateTo = params.dateTo.toISOString().split('T')[0];
  let url = `https://www.google.com/travel/flights?q=flights+from+${params.origin}+to+${params.destination}+on+${dateFrom}+to+${dateTo}&hl=en`;
  if (params.currency) url += `&curr=${params.currency}`;
  if (params.country) url += `&gl=${params.country}`;
  return url;
}

// Random flight: pick a random origin-destination pair
const routes = [
  { origin: 'JFK', destination: 'CDG', label: 'New York to Paris' },
  { origin: 'LAX', destination: 'NRT', label: 'LA to Tokyo' },
  { origin: 'ORD', destination: 'LHR', label: 'Chicago to London' },
  { origin: 'SFO', destination: 'FCO', label: 'San Francisco to Rome' },
  { origin: 'MIA', destination: 'GRU', label: 'Miami to Sao Paulo' },
];
const route = routes[Math.floor(Math.random() * routes.length)];

// Random date 30-60 days from now
const daysAhead = 30 + Math.floor(Math.random() * 30);
const dateFrom = new Date(Date.now() + daysAhead * 86400000);
const dateTo = new Date(dateFrom.getTime() + 7 * 86400000);

const searchParams = {
  origin: route.origin,
  destination: route.destination,
  dateFrom,
  dateTo,
  currency: 'USD',
  country: 'US',
};

const url = buildGoogleFlightsUrl(searchParams);
info(`Route: ${route.label} (${route.origin} -> ${route.destination})`);
info(`Dates: ${dateFrom.toISOString().split('T')[0]} to ${dateTo.toISOString().split('T')[0]}`);
info(`URL: ${url}\n`);

// ── Test 1: Scrape with US profile (no VPN, just anti-detection) ─
const profile = COUNTRY_PROFILES['US'];

info('Launching stealth browser...');
// Use Playwright's bundled Chromium (not the Docker-specific launch flags)
const { chromium } = await import('playwright');
const browser = await chromium.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--disable-blink-features=AutomationControlled',
    '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
    '--enforce-webrtc-ip-permission-check',
  ],
});
const context = await createStealthContext(browser, { countryProfile: profile });
const page = await context.newPage();

// Verify anti-detection is active before navigating
const checks = await page.evaluate(() => ({
  webdriver: navigator.webdriver,
  hasChrome: !!(/** @type {any} */ (window)).chrome?.runtime,
  plugins: navigator.plugins.length,
  dpr: window.devicePixelRatio,
  screenMatch: screen.width === window.innerWidth,
}));

if (checks.webdriver === false) ok('Anti-detection active: webdriver=false');
else bad('webdriver', `${checks.webdriver}`);

if (checks.hasChrome) ok('Anti-detection active: chrome.runtime present');
else bad('chrome.runtime', 'missing');

if (checks.plugins >= 3) ok(`Anti-detection active: ${checks.plugins} plugins`);
else bad('plugins', `${checks.plugins}`);

// Navigate to Google Flights
info('\nNavigating to Google Flights...');
const navStart = Date.now();

try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const gotoMs = Date.now() - navStart;
  ok(`Page loaded in ${gotoMs}ms`);
} catch (err) {
  bad('Navigation failed', err.message);
  await context.close();
  await browser.close();
  console.log(`\n${BOLD}Results: ${pass} passed, ${fail} failed${RESET}\n`);
  process.exit(1);
}

// Wait for page to settle
await new Promise(r => setTimeout(r, 5000));

// Dismiss consent dialog
try {
  const consentButton = page.locator('button:has-text("Accept all")').first();
  if (await consentButton.isVisible({ timeout: 2000 })) {
    await consentButton.click();
    info('Dismissed consent dialog');
    await new Promise(r => setTimeout(r, 2000));
  }
} catch { /* no consent dialog */ }

// Wait for flight results
let resultsFound = false;
try {
  await page.waitForSelector('[data-gs]', { timeout: 15000 });
  resultsFound = true;
  ok('Flight results selector [data-gs] found');
} catch {
  info('Selector [data-gs] not found -- checking page content...');
}

// Extract page text
let text = '';
try {
  text = await page.evaluate(() => document.body.innerText);
} catch (err) {
  bad('Page text extraction failed', err.message);
  await context.close();
  await browser.close();
  console.log(`\n${BOLD}Results: ${pass} passed, ${fail} failed${RESET}\n`);
  process.exit(1);
}
info(`Page text length: ${text.length} chars`);

// Check for bot detection / CAPTCHA signals
const blocked = /unusual traffic|captcha|verify.*human|automated.*detected/i.test(text);
if (!blocked) ok('No bot detection / CAPTCHA triggered');
else bad('Bot detection', 'Page contains CAPTCHA or "unusual traffic" message');

// Check for price-like content
const hasPrice = /\$\s?\d{2,}|USD\s?\d{2,}|\d{2,}\s?USD/.test(text);
if (hasPrice) ok('Price data found in page text');
else if (resultsFound) ok('Results selector found (prices may use non-$ format)');
else bad('No prices', 'Neither price text nor result selector found');

// Check for airline names
const airlines = ['Delta', 'United', 'American', 'JetBlue', 'Spirit', 'Frontier',
  'Air France', 'British Airways', 'Lufthansa', 'ANA', 'JAL', 'LATAM', 'Alitalia',
  'ITA Airways', 'Norse', 'TAP', 'Iberia', 'Swiss', 'KLM', 'Emirates'];
const foundAirlines = airlines.filter(a => text.includes(a));
if (foundAirlines.length > 0) ok(`Found airlines: ${foundAirlines.join(', ')}`);
else info('No airline names detected in text (may be localized)');

// ── Summary ──────────────────────────────────────────────────────
const totalMs = Date.now() - navStart;
info(`\nTotal scrape time: ${totalMs}ms`);

await context.close();
await browser.close();

console.log(`\n${BOLD}Results: ${pass} passed, ${fail} failed${RESET}\n`);
process.exit(fail > 0 ? 1 : 0);

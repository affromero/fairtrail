import type { Page } from 'playwright';
import { launchBrowser, createStealthContext } from './browser';
import { getAirlineUrl } from './airline-urls';

/** Random delay between min and max milliseconds */
function randomDelay(min: number, max: number): Promise<void> {
  return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}

/** Simulate human-like page interaction: mouse moves, scrolls, pauses */
async function simulateHumanBehavior(page: Page): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1440, height: 900 };

  // Move mouse to a random spot (humans don't leave cursor at 0,0)
  await page.mouse.move(
    100 + Math.random() * (viewport.width - 200),
    100 + Math.random() * (viewport.height - 200),
    { steps: 5 + Math.floor(Math.random() * 10) }
  );
  await randomDelay(200, 600);

  // Scroll down slightly like a human scanning results
  await page.mouse.wheel(0, 100 + Math.random() * 300);
  await randomDelay(300, 800);

  // Move mouse again
  await page.mouse.move(
    100 + Math.random() * (viewport.width - 200),
    200 + Math.random() * (viewport.height - 400),
    { steps: 3 + Math.floor(Math.random() * 8) }
  );
  await randomDelay(100, 400);
}

export interface FlightSearchParams {
  origin: string;
  destination: string;
  dateFrom: Date;
  dateTo: Date;
  cabinClass?: string;
  tripType?: string; // 'one_way' | 'round_trip'
  currency?: string; // ISO 4217 code, defaults to USD
}

export type NavigationSource = 'google_flights' | 'airline_direct';

export interface NavigationResult {
  html: string;
  url: string;
  resultsFound: boolean;
  source: NavigationSource;
}

function buildGoogleFlightsUrl(params: FlightSearchParams): string {
  const dateFrom = params.dateFrom.toISOString().split('T')[0];
  const dateTo = params.dateTo.toISOString().split('T')[0];
  const oneWayPrefix = params.tripType === 'one_way' ? 'one+way+' : '';

  const curr = params.currency || 'USD';
  return `https://www.google.com/travel/flights?q=${oneWayPrefix}flights+from+${params.origin}+to+${params.destination}+on+${dateFrom}+to+${dateTo}&curr=${curr}&hl=en`;
}

export async function navigateGoogleFlights(
  params: FlightSearchParams
): Promise<NavigationResult> {
  const url = buildGoogleFlightsUrl(params);
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const browser = await launchBrowser();

    try {
      const context = await createStealthContext(browser);
      const page = await context.newPage();
      console.log(`[navigate] attempt ${attempt}/${maxAttempts} → ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

      // Wait for page to settle — randomized to look human
      await randomDelay(attempt === 1 ? 2000 : 4000, attempt === 1 ? 4000 : 7000);

      // Simulate human browsing behavior
      await simulateHumanBehavior(page);

      // Dismiss consent/cookie dialog — Google renders two identical "Accept all"
      // buttons; without .first() Playwright strict mode throws on the ambiguity
      try {
        const consentButton = page.locator('button:has-text("Accept all")').first();
        if (await consentButton.isVisible({ timeout: 2000 })) {
          await consentButton.click();
          await randomDelay(2000, 4000);
        }
      } catch {
        // No consent dialog — continue
      }

      // Wait for flight results — look for price elements
      let resultsFound = false;
      try {
        await page.waitForSelector('[data-gs]', { timeout: 15_000 });
        resultsFound = true;
      } catch {
        // Selector not found — page may be blocked, CAPTCHA'd, or empty
      }

      // Scroll through results like a human scanning prices
      if (resultsFound) {
        await simulateHumanBehavior(page);
      }

      // Capture visible text instead of raw HTML — Google Flights pages are 2-3MB
      // of HTML but only ~3k of visible text, and flight data starts deep in the DOM
      // where a 50k char cap would never reach it
      const html = await page.evaluate(() => document.body.innerText);
      console.log(`[navigate] attempt ${attempt}: resultsFound=${resultsFound}, textLength=${html.length}`);

      await context.close();

      // Retry with fresh browser if no results and we have attempts left
      if (!resultsFound && attempt < maxAttempts) {
        console.log(`[navigate] no results on attempt ${attempt}, retrying after delay…`);
        await browser.close();
        await new Promise((r) => setTimeout(r, 3000 + Math.random() * 4000));
        continue;
      }

      return { html, url, resultsFound, source: 'google_flights' };
    } finally {
      await browser.close();
    }
  }

  // Unreachable — loop always returns — but TypeScript needs it
  throw new Error('navigateGoogleFlights: exhausted all attempts');
}

export interface FlightDetailResult {
  airlineDirectPrice: number | null;
  airlineDirectCurrency: string | null;
  bookingUrl: string | null;
  allBookingOptions: Array<{
    provider: string;
    isAirline: boolean;
    price: number;
    currency: string;
  }>;
}

export async function navigateFlightDetail(
  params: FlightSearchParams,
  flightIndex: number
): Promise<FlightDetailResult> {
  const browser = await launchBrowser();

  try {
    const context = await createStealthContext(browser);
    const page = await context.newPage();

    // Must use one-way search so clicking goes directly to booking options
    const url = buildGoogleFlightsUrl({ ...params, tripType: 'one_way' });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
    await randomDelay(2000, 4000);
    await simulateHumanBehavior(page);

    // Dismiss consent
    try {
      const consentButton = page.locator('button:has-text("Accept all")').first();
      if (await consentButton.isVisible({ timeout: 2000 })) {
        await consentButton.click();
        await randomDelay(2000, 4000);
      }
    } catch {
      // No consent dialog
    }

    // Wait for results
    try {
      await page.waitForSelector('li.pIav2d', { timeout: 15_000 });
    } catch {
      await context.close();
      return { airlineDirectPrice: null, airlineDirectCurrency: null, bookingUrl: null, allBookingOptions: [] };
    }

    // Click the specific flight result
    const flightItems = page.locator('li.pIav2d');
    const count = await flightItems.count();
    if (flightIndex >= count) {
      await context.close();
      return { airlineDirectPrice: null, airlineDirectCurrency: null, bookingUrl: null, allBookingOptions: [] };
    }

    await flightItems.nth(flightIndex).click();
    await page.waitForTimeout(4000);

    // Extract booking options from the detail view
    // Google Flights renders "Book with LOTAirline\n$662" (Airline appended to name)
    // or "Book with Mytrip\n$704" (no Airline tag for OTAs)
    const detailCurrency = params.currency || 'USD';
    const result = await page.evaluate((curr) => {
      const text = document.body.innerText ?? '';
      const options: Array<{ provider: string; isAirline: boolean; price: number; currency: string }> = [];

      const bookingPattern = /Book with (.+?)(?:Airline)?\n\$?([\d,]+)/g;
      let match;
      while ((match = bookingPattern.exec(text)) !== null) {
        const rawProvider = match[1]!.trim();
        // Check if the full match area contains "Airline" tag
        const fullMatch = match[0]!;
        const isAirline = /Airline/.test(fullMatch);
        const provider = rawProvider.replace(/Airline$/, '').trim();
        const price = parseInt(match[2]!.replace(/,/g, ''), 10);
        if (!isNaN(price) && provider.length > 0) {
          options.push({ provider, isAirline, price, currency: curr });
        }
      }

      return options;
    }, detailCurrency);

    await context.close();

    // Find the airline-direct option (tagged as "Airline")
    const airlineOption = result.find((o) => o.isAirline);

    return {
      airlineDirectPrice: airlineOption?.price ?? null,
      airlineDirectCurrency: airlineOption?.currency ?? null,
      bookingUrl: null, // booking URL requires following a redirect — use Google Flights link
      allBookingOptions: result,
    };
  } finally {
    await browser.close();
  }
}

export async function navigateAirlineDirect(
  params: FlightSearchParams,
  airlineName: string
): Promise<NavigationResult> {
  const url = getAirlineUrl(airlineName, params);
  if (!url) {
    throw new Error(`No URL pattern for airline: ${airlineName}`);
  }

  const browser = await launchBrowser();

  try {
    const context = await createStealthContext(browser);
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45_000 });

    // Airline sites are slower — wait for dynamic content to render
    await randomDelay(4000, 7000);
    await simulateHumanBehavior(page);

    // Dismiss cookie/consent dialogs common on airline sites
    try {
      for (const label of ['Accept all', 'Accept', 'I agree', 'Accept cookies', 'OK', 'Got it']) {
        const btn = page.locator(`button:has-text("${label}")`).first();
        if (await btn.isVisible({ timeout: 1000 })) {
          await btn.click();
          await randomDelay(1500, 3000);
          break;
        }
      }
    } catch {
      // No consent dialog — continue
    }

    // Heuristic: check if any price-like content loaded (currency symbols or digits)
    let resultsFound = false;
    try {
      await page.waitForFunction(
        () => {
          const text = document.body?.innerText ?? '';
          return /\$\s?\d|€\s?\d|£\s?\d|USD|EUR|GBP|\d+\.\d{2}/.test(text);
        },
        { timeout: 15_000 }
      );
      resultsFound = true;
    } catch {
      // No price content detected — page may be blocked or empty
    }

    const html = await page.evaluate(() => document.body.innerText);

    await context.close();
    return { html, url, resultsFound, source: 'airline_direct' };
  } finally {
    await browser.close();
  }
}

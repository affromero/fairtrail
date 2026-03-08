import { launchBrowser, createStealthContext } from './browser';

export interface FlightSearchParams {
  origin: string;
  destination: string;
  dateFrom: Date;
  dateTo: Date;
  cabinClass?: string;
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

  return `https://www.google.com/travel/flights?q=flights+from+${params.origin}+to+${params.destination}+on+${dateFrom}+to+${dateTo}&curr=USD&hl=en`;
}

export async function navigateGoogleFlights(
  params: FlightSearchParams
): Promise<NavigationResult> {
  const browser = await launchBrowser();

  try {
    const context = await createStealthContext(browser);
    const page = await context.newPage();
    const url = buildGoogleFlightsUrl(params);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

    // Wait for flight results to load
    await page.waitForTimeout(3000);

    // Dismiss consent/cookie dialog — Google renders two identical "Accept all"
    // buttons; without .first() Playwright strict mode throws on the ambiguity
    try {
      const consentButton = page.locator('button:has-text("Accept all")').first();
      if (await consentButton.isVisible({ timeout: 2000 })) {
        await consentButton.click();
        await page.waitForTimeout(3000);
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

    const html = await page.content();

    await context.close();
    return { html, url, resultsFound, source: 'google_flights' };
  } finally {
    await browser.close();
  }
}

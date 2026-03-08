export interface FlightSearchParams {
  origin: string;
  destination: string;
  dateFrom: Date;
  dateTo: Date;
}

export interface NavigationResult {
  html: string;
  url: string;
  resultsFound: boolean;
}

function buildGoogleFlightsUrl(params: FlightSearchParams): string {
  const dateFrom = params.dateFrom.toISOString().split('T')[0];
  const dateTo = params.dateTo.toISOString().split('T')[0];

  return `https://www.google.com/travel/flights?q=flights+from+${params.origin}+to+${params.destination}+on+${dateFrom}+to+${dateTo}&curr=USD&hl=en`;
}

export async function navigateGoogleFlights(
  params: FlightSearchParams
): Promise<NavigationResult> {
  const { chromium } = await import('playwright');

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
    });

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
    return { html, url, resultsFound };
  } finally {
    await browser.close();
  }
}

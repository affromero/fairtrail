import type { Page } from 'playwright';
import { navigateCarPage } from './navigation';
import { verifyCarProviderContext } from './provider-context';
import { carRecord, carText } from './validation';
import { parseCarMoney } from './money';
import { carProtectionPolicyUrl, validateCarProtectionChoice, type CarProtectionChoice } from './protection-choice';
import { CarError, type CarSearch } from './types';
import { carProviderUrl } from './offer-validation';

export interface AutoEuropeProtectionCapture {
  requestedUrl: string;
  url: string;
  observedAt: string;
  providerContext: Record<string, string>;
  quoteMatchesUrl: boolean;
  packages: unknown;
  buttons: { productId: string; label: string; enabled: boolean }[];
}

function verifyQuote(requestedUrl: string, currentUrl: string): void {
  const requested = new URL(carProviderUrl(requestedUrl, 'autoeurope')), current = new URL(carProviderUrl(currentUrl, 'autoeurope'));
  if (requested.pathname !== '/en-us/options' || current.pathname !== requested.pathname || !requested.searchParams.get('rate_reference')
    || ['rate_reference', 'unique_id'].some(key => requested.searchParams.get(key) !== current.searchParams.get(key))) {
    throw new CarError('Protection options belong to another quote');
  }
}

/** Visits options only. No option is selected and no customer form is submitted. */
export async function captureAutoEuropeProtectionChoices(page: Page, url: string, search: CarSearch): Promise<AutoEuropeProtectionCapture> {
  verifyQuote(url, url);
  verifyCarProviderContext(url, 'autoeurope', search);
  await navigateCarPage(page, url, 'autoeurope');
  verifyQuote(url, page.url());
  verifyCarProviderContext(page.url(), 'autoeurope', search);
  if (new URL(page.url()).pathname !== '/en-us/options') throw new CarError('Expected the rental protection options page');
  const buttons = page.locator('[data-cy^="go_to_checkout_button_"]:visible');
  await buttons.first().waitFor();
  if (await buttons.count() > 9) throw new CarError('Too many protection options');
  const fields = await page.locator('#checkoutOptions').evaluate(element => {
    const data = JSON.parse(element.getAttribute('data-data') ?? '{}') as Record<string, unknown>;
    const rules = data.rate_rules as Record<string, unknown> | undefined;
    const request = rules?.search as Record<string, unknown> | undefined;
    const keys = ['pickup_location', 'dropoff_location', 'pickup_date', 'dropoff_date', 'pickup_time', 'dropoff_time', 'drivers_age', 'residence_country', 'currency'];
    const providerContext = Object.fromEntries(keys.map(key => [key, String(request?.[key] ?? '')]));
    const quoteMatchesUrl = request?.rate_reference === new URL(window.location.href).searchParams.get('rate_reference');
    const available = data.available_packages as Record<string, unknown> | undefined;
    const packages = available?.packages;
    if (!Array.isArray(packages) || packages.length > 9) throw new Error('Invalid protection packages');
    // Exclude booking, CSRF, customer and other unrelated provider fields.
    const products = packages.map((raw: Record<string, unknown>) => {
      const product = raw.product as Record<string, unknown> | undefined;
      const fields = ['code', 'name', 'description', 'mandatory', 'maximum_quantity', 'default_quantity', 'included_in_vehicle_price', 'payment_type', 'rental_price'];
      return { isMain: raw.isMain, product: Object.fromEntries(fields.map(key => [key, product?.[key]])) };
    });
    return { providerContext, quoteMatchesUrl, packages: products };
  });
  const visible = await buttons.evaluateAll(elements => elements.map(element => ({
    productId: (element.getAttribute('data-cy') ?? '').replace(/^go_to_checkout_button_/, ''),
    label: (element.textContent ?? '').replace(/\s+/g, ' ').trim(),
    enabled: !element.hasAttribute('disabled') && element.getAttribute('aria-disabled') !== 'true',
  })));
  verifyQuote(url, page.url());
  return { ...fields, requestedUrl: url, url: page.url(), observedAt: new Date().toISOString(), buttons: visible };
}

export function extractAutoEuropeProtectionChoices(capture: AutoEuropeProtectionCapture, search: CarSearch): CarProtectionChoice[] {
  verifyQuote(capture.requestedUrl, capture.url);
  verifyCarProviderContext(capture.url, 'autoeurope', search);
  const contextUrl = new URL(capture.url);
  contextUrl.search = new URLSearchParams(capture.providerContext).toString();
  verifyCarProviderContext(contextUrl.href, 'autoeurope', search);
  if (!capture.quoteMatchesUrl || new URL(capture.url).pathname !== '/en-us/options') throw new CarError('Protection options belong to another quote');
  if (!Array.isArray(capture.packages) || capture.packages.length > 9 || capture.buttons.length > 9) throw new CarError('Invalid protection options');
  if (new Set(capture.buttons.map(button => button.productId)).size !== capture.buttons.length) throw new CarError('Duplicate protection choices');
  const packages = capture.packages.map(carRecord);
  return capture.buttons.filter(button => button.productId !== 'basic' && button.enabled).map(button => {
    const matches = packages.filter(item => item.isMain === false && carRecord(item.product).code === button.productId);
    if (matches.length !== 1) throw new CarError('Visible protection does not identify a unique product');
    const product = carRecord(matches[0]!.product), name = carText(product.name, 200, 'protection name');
    if (button.label !== `Go To Book With ${name}`) throw new CarError('Visible protection name disagrees with its product');
    if (product.mandatory !== false || product.included_in_vehicle_price !== false || product.default_quantity !== 0 || product.maximum_quantity !== 1 || product.payment_type !== 'Now') {
      throw new CarError('Protection is not an optional unselected prepaid product');
    }
    const price = carRecord(carRecord(product.rental_price).payment);
    if (typeof price.amount !== 'number' && typeof price.amount !== 'string') throw new CarError('Protection price is missing');
    const termsSummary = carText(product.description, 12000, 'protection terms');
    const links = [...new Set(termsSummary.match(/https:\/\/[^\s<>"']+/g) ?? [])];
    return validateCarProtectionChoice({ source: 'autoeurope', productId: button.productId, name, termsSummary,
      policyLinks: links.map(link => carProtectionPolicyUrl(link, 'autoeurope')),
      observedExtraPrice: parseCarMoney(String(price.amount), carText(price.currency, 3, 'protection currency')),
      sourceUrl: capture.url, observedAt: capture.observedAt });
  });
}

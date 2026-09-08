import type { Page } from 'playwright';
import { carProviderUrl } from './offer-validation';
import { verifyCarProviderContext } from './provider-context';
import { CarError, type CarSearch } from './types';
import { navigateCarPage, prepareCarPage } from './navigation';

export interface AutoEuropeCapture {
  url: string;
  observedAt: string;
  providerContext: Record<string, string>;
  quoteMatchesUrl: boolean;
  vehicle: unknown;
  pickupBranch: unknown;
  dropoffBranch: unknown;
  cart: unknown;
  sections: { title: string; text: string }[];
  visibleTotal: string;
  visiblePayNow: string;
  visibleModel: string;
  visibleModelBasis: string;
  visibleSupplier: string;
}

/** Reads provider-rendered quote data only; no booking form is submitted. */
export async function captureAutoEuropeDetail(page: Page, url: string, search: CarSearch): Promise<AutoEuropeCapture> {
  await navigateCarPage(page, carProviderUrl(url, 'autoeurope'), 'autoeurope');
  verifyCarProviderContext(page.url(), 'autoeurope', search);
  const protection = search.extras.protection.find(item => item.source === 'autoeurope');
  const code = protection?.productId ?? 'basic';
  if (!/^[A-Za-z0-9.]+$/.test(code)) throw new CarError('Unsupported Auto Europe protection product');
  const button = page.locator(`[data-cy="go_to_checkout_button_${code}"]:visible`).first();
  await button.waitFor();
  const guard = await prepareCarPage(page, 'autoeurope');
  guard.reset();
  await button.click();
  await page.waitForURL(location => location.pathname === '/en-us/checkout');
  await guard.settle();
  verifyCarProviderContext(page.url(), 'autoeurope', search);
  await page.locator('[data-cy="toggle_terms_conditions_modal_button"]').click();
  await page.locator('[data-cy="terms_conditions_modal"]:visible').waitFor();
  const fields = await page.locator('#checkoutForm').evaluate(element => {
    const data = JSON.parse(element.getAttribute('data-data') ?? '{}') as Record<string, unknown>;
    const rules = data.rate_rules as Record<string, unknown> | undefined;
    const request = rules?.search as Record<string, unknown> | undefined;
    const keys = ['pickup_location', 'dropoff_location', 'pickup_date', 'dropoff_date', 'pickup_time', 'dropoff_time', 'drivers_age', 'residence_country', 'currency'];
    const providerContext = Object.fromEntries(keys.map(key => [key, String(request?.[key] ?? '')]));
    const quoteMatchesUrl = typeof request?.rate_reference === 'string' && request.rate_reference === new URL(window.location.href).searchParams.get('rate_reference');
    const terms = rules?.terms as { full?: { gateway?: { sections?: { title?: unknown; content?: unknown }[] } } } | undefined;
    const sections = (terms?.full?.gateway?.sections ?? []).map(section => {
      const document = new DOMParser().parseFromString(String(section.content ?? ''), 'text/html');
      document.querySelectorAll('script,style').forEach(node => node.remove());
      return { title: String(section.title ?? ''), text: (document.body.textContent ?? '').replace(/\s+/g, ' ').trim() };
    });
    // Do not capture customer fields, IPs, session credentials or payment setup.
    return { providerContext, quoteMatchesUrl, vehicle: rules?.vehicle, pickupBranch: rules?.pickup_branch, dropoffBranch: rules?.dropoff_branch, cart: data.cart, sections };
  });
  const visible = async (selector: string) => (await page.locator(selector).first().innerText()).replace(/\s+/g, ' ').trim();
  return {
    ...fields, url: page.url(), observedAt: new Date().toISOString(),
    visibleTotal: await visible('[data-cy="total_price"]'),
    visiblePayNow: await visible('[data-cy="payment_summary_total_due_now"]'),
    visibleModel: await visible('[data-cy="vehicle_name"]'),
    visibleModelBasis: (await page.locator('[data-cy="vehicle_category"]').first().locator('..').innerText()).replace(/\s+/g, ' ').trim(),
    visibleSupplier: await page.locator('[data-cy="vehicle_supplier_logo"]').first().getAttribute('data-name') ?? '',
  };
}

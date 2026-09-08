import { describe, expect, it } from 'vitest';
import { extractAutoEuropeProtectionChoices, type AutoEuropeProtectionCapture } from './autoeurope-protection';
import { validateCarSearch } from './validation';

const location = { name: 'London Heathrow', country: 'GB', timeZone: 'Europe/London', providerIds: { autoeurope: '547' } };
const search = validateCarSearch({ pickup: location, dropoff: location,
  pickupAt: { date: '2026-10-15', time: '12:00' }, dropoffAt: { date: '2026-10-18', time: '12:00' },
  driver: { age: 35, licenceYears: 2, residenceCountry: 'GB' }, currency: 'GBP', sources: ['autoeurope'],
}, new Date('2026-09-01'));
const policy = 'https://www.globalmediaserver.com/ExcessReimbursementCover/policy.pdf';
function fixture() {
  const providerContext = { pickup_location: '547', dropoff_location: '547', pickup_date: '2026-10-15', dropoff_date: '2026-10-18',
    pickup_time: '12:00', dropoff_time: '12:00', drivers_age: '35', residence_country: 'gb', currency: 'GBP' };
  const url = `https://book.autoeurope.com/en-us/options?${new URLSearchParams(providerContext)}&rate_reference=example`;
  return {
    requestedUrl: url, url,
    observedAt: new Date().toISOString(), providerContext, quoteMatchesUrl: true as boolean,
    packages: [{ isMain: true, product: {} }, { isMain: false, product: { code: 'ZC.GBP', name: 'Damage protection',
      description: `Reimbursement subject to exclusions. Full policy: ${policy}`, mandatory: false, included_in_vehicle_price: false,
      default_quantity: 0, maximum_quantity: 1, payment_type: 'Now', rental_price: { payment: { amount: 18, currency: 'GBP' } },
    } }],
    buttons: [{ productId: 'basic', label: 'Go To Book With Basic Plus', enabled: true as boolean },
      { productId: 'ZC.GBP', label: 'Go To Book With Damage protection', enabled: true as boolean }],
  } satisfies AutoEuropeProtectionCapture;
}

describe('protection products observed before selection', () => {
  it('returns the visible optional product with its full-rental extra price and policy, without selecting it', () => {
    const capture = fixture(), previous = structuredClone(capture);
    const choices = extractAutoEuropeProtectionChoices(capture, search);
    expect(choices).toEqual([{ source: 'autoeurope', productId: 'ZC.GBP', name: 'Damage protection',
      termsSummary: `Reimbursement subject to exclusions. Full policy: ${policy}`, policyLinks: [policy],
      observedExtraPrice: { currency: 'GBP', minor: 1800 }, sourceUrl: capture.url, observedAt: capture.observedAt }]);
    expect(capture).toEqual(previous);
  });
  it('preserves payable currency separately from the requested display currency', () => {
    const capture = fixture();
    capture.packages[1]!.product.rental_price!.payment.currency = 'USD';
    expect(extractAutoEuropeProtectionChoices(capture, search)[0]?.observedExtraPrice).toEqual({ currency: 'USD', minor: 1800 });
  });
  it('does not expose products that have no enabled visible selection', () => {
    const capture = fixture();
    capture.buttons = [capture.buttons[0]!];
    expect(extractAutoEuropeProtectionChoices(capture, search)).toEqual([]);
    capture.buttons.push({ productId: 'ZC.GBP', label: 'Go To Book With Damage protection', enabled: false });
    expect(extractAutoEuropeProtectionChoices(capture, search)).toEqual([]);
  });
  it.each(['mandatory', 'included_in_vehicle_price'] as const)('rejects %s products presented as optional', field => {
    const capture = fixture(); capture.packages[1]!.product[field] = true;
    expect(() => extractAutoEuropeProtectionChoices(capture, search)).toThrow(/optional/);
  });
  it.each([
    ['default_quantity', 1], ['maximum_quantity', 2], ['payment_type', 'Local'],
  ] as const)('rejects unsupported product state: %s', (field, value) => {
    const capture: AutoEuropeProtectionCapture = fixture();
    const packages = capture.packages as { product: Record<string, unknown> }[];
    packages[1]!.product[field] = value;
    expect(() => extractAutoEuropeProtectionChoices(capture, search)).toThrow(/optional/);
  });
  it('rejects a hidden quote context that differs from the selected rental', () => {
    const capture = fixture(); capture.providerContext.drivers_age = '23';
    expect(() => extractAutoEuropeProtectionChoices(capture, search)).toThrow(/changed/);
  });
  it('rejects options from a different quote session or route', () => {
    const capture = fixture(); capture.quoteMatchesUrl = false;
    expect(() => extractAutoEuropeProtectionChoices(capture, search)).toThrow(/another quote/);
    capture.quoteMatchesUrl = true; capture.url = capture.url.replace('/options?', '/checkout?');
    expect(() => extractAutoEuropeProtectionChoices(capture, search)).toThrow(/another quote/);
  });
  it('rejects same-search redirects to another quote or rental identity', () => {
    const capture = fixture(); capture.url = capture.url.replace('rate_reference=example', 'rate_reference=another');
    expect(() => extractAutoEuropeProtectionChoices(capture, search)).toThrow(/another quote/);
    capture.url = `${capture.requestedUrl}&unique_id=another-rental`;
    expect(() => extractAutoEuropeProtectionChoices(capture, search)).toThrow(/another quote/);
  });
  it('rejects mismatched visible names and unknown product identities', () => {
    const capture = fixture(); capture.buttons[1]!.label = 'Go To Book With Another product';
    expect(() => extractAutoEuropeProtectionChoices(capture, search)).toThrow(/name/);
    capture.buttons[1]!.productId = 'invented';
    expect(() => extractAutoEuropeProtectionChoices(capture, search)).toThrow(/unique product/);
  });
  it('rejects duplicate visible options and duplicate backing products', () => {
    const capture = fixture(); capture.buttons.push(capture.buttons[1]!);
    expect(() => extractAutoEuropeProtectionChoices(capture, search)).toThrow(/Duplicate/);
    capture.buttons.pop(); capture.packages.push(capture.packages[1]!);
    expect(() => extractAutoEuropeProtectionChoices(capture, search)).toThrow(/unique product/);
  });
  it('rejects options with missing terms, invalid prices or untrusted policy links', () => {
    const capture = fixture(), product = capture.packages[1]!.product;
    product.description = '';
    expect(() => extractAutoEuropeProtectionChoices(capture, search)).toThrow(/terms/);
    product.description = 'Policy https://evil.example/policy.pdf';
    expect(() => extractAutoEuropeProtectionChoices(capture, search)).toThrow(/policy link/);
    product.description = 'Terms apply'; product.rental_price!.payment.amount = -1;
    expect(() => extractAutoEuropeProtectionChoices(capture, search)).toThrow(/price/);
  });
});

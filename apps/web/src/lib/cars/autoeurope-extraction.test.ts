import { describe, expect, it, vi } from 'vitest';
import { extractAutoEuropeOffer } from './autoeurope-extraction';
import { assessCarPrice } from './pricing';
import { validateCarSearch } from './validation';
import { carContractIdentity } from './identity';
import type { AutoEuropeCapture } from './autoeurope-capture';

const location = { name: 'Heathrow', country: 'GB', timeZone: 'Europe/London', providerIds: { autoeurope: '547' } };
const search = validateCarSearch({ pickup: location, dropoff: location, pickupAt: { date: '2026-10-15', time: '12:00' }, dropoffAt: { date: '2026-10-18', time: '12:00' }, driver: { age: 35, licenceYears: 5, residenceCountry: 'US' }, currency: 'USD', sources: ['autoeurope'] }, new Date('2026-09-01'));
const payment = (amount: number) => ({ payment: { amount, currency: 'USD' } });
function fixture() {
  return {
    url: 'https://book.autoeurope.com/en-us/checkout?pickup_location=547&dropoff_location=547&pickup_date=2026-10-15&pickup_time=12%3A00&dropoff_date=2026-10-18&dropoff_time=12%3A00&drivers_age=35&residence_country=US&currency=USD&rate_reference=sanitized',
    observedAt: '2026-09-06T12:00:00.000Z', visibleTotal: 'USD $49.65', visiblePayNow: 'USD $49.65', visibleModel: 'Fiat 500', visibleModelBasis: 'or similar | Mini', visibleSupplier: 'Example rental supplier',
    providerContext: { pickup_location: '547', dropoff_location: '547', pickup_date: '2026-10-15', dropoff_date: '2026-10-18', pickup_time: '12:00', dropoff_time: '12:00', drivers_age: '35', residence_country: 'US', currency: 'USD' }, quoteMatchesUrl: true as boolean,
    pickupBranch: { id: 245051, timezone: 'Europe/London' }, dropoffBranch: { id: 245051, timezone: 'Europe/London' }, cart: { items: [] as unknown[] },
    vehicle: {
      id: 123, name: 'Fiat 500', acriss_code: 'MCMR', transmission: 'Manual', seats: 4,
      supplier: { id: 3827, name: 'Example rental supplier', pickup_office_id: '245051', dropoff_office_id: '245051' },
      package: {
        package_name: 'Basic Plus', on_request: false, inclusions: [{ code: 'IN', name: 'Mandatory Taxes & Fees' }],
        coverages: [{ code: '7', included_in_vehicle_price: true, excessAmount: payment(2289) }],
        payments: { payNow: { total: payment(49.65) }, payLocal: { total: payment(0) } },
        fees: [] as unknown[], fuel_policy: { name: 'Same to same', description: 'Return with the pickup fuel level.' }, rate_distance: { unlimited: true },
      },
    },
    sections: [
      { title: 'General Terms', text: 'Free cancellation is available up to 48 hours before pickup. Later cancellation is nonrefundable.' },
      { title: 'The Rate Includes', text: 'Mandatory Taxes & Fees' },
      { title: 'Driver Information', text: 'Minimum driver age for the vehicle that you selected is 23. Maximum driver age for the vehicle that you selected is 75. You must have held your Driver’s License for a minimum of 2 full year(s). Present original documents and flight tickets for airport pickup.' },
      { title: 'Payment and Charges', text: 'A security deposit of USD 2,014.00 is required. This is an estimated deposit. A physical credit card is required.' },
      { title: 'Vehicle Pick-up and Return', text: 'Provide flight information for airport collection.' },
      { title: 'Geographical Restrictions', text: 'Cross-border driving requires supplier permission.' },
      { title: 'Policies, Coverage and Taxes', text: 'Collision excess USD 2,289.00. Lost keys are excluded.' },
      { title: 'Mileage Policy', text: 'Unlimited mileage' },
      { title: 'Optional Extras', text: 'Additional drivers are request-only; estimated daily prices exclude local taxes.' },
    ],
  } satisfies AutoEuropeCapture;
}
function offer(capture = fixture(), criteria = search) {
  const result = extractAutoEuropeOffer(capture, criteria);
  if (!('contract' in result)) throw new Error(result.reasons.join('; '));
  return result;
}

describe('Auto Europe scoped quote extraction', () => {
  it('reconciles the displayed rental without adding estimated deposits or collision excess', () => {
    const result = offer();
    expect(assessCarPrice(result, search, new Date('2026-09-06T12:01:00Z'))).toMatchObject({ eligible: true, total: { minor: 4965 }, payAtPickup: { minor: 0 } });
    expect(result.deposit).toMatchObject({ status: 'estimated', value: { minor: 201400 } });
    expect(result.excess.value?.minor).toBe(228900);
    expect(result.requirements).toEqual(expect.arrayContaining([expect.objectContaining({ evidence: expect.objectContaining({ value: expect.stringContaining('flight tickets') }) })]));
  });
  it('uses the selected protection rental total without multiplying its rounded daily guide price', () => {
    const capture = fixture(); capture.visibleTotal = 'USD $93.65'; capture.visiblePayNow = 'USD $93.65';
    capture.cart.items = [{ id: 'ZR.USD', name: 'Excess refund', quantity: 1, attributes: { payment_type: 'Now', description: 'Refund with stated exclusions', payments: payment(44) } }];
    const criteria = { ...search, extras: { ...search.extras, protection: [{ source: 'autoeurope' as const, productId: 'ZR.USD' }] } };
    const result = offer(capture, criteria);
    expect(assessCarPrice(result, criteria, new Date('2026-09-06T12:01:00Z'))).toMatchObject({ eligible: true, total: { minor: 9365 } });
    expect(result.charges.find(charge => charge.id === 'ZR.USD')?.amount.value?.minor).toBe(4400);
    expect(result.contract.coverageTerms).toContain('Refund with stated exclusions');
    capture.cart.items = [{ id: 'ZR.USD', name: 'Excess refund', quantity: 1, attributes: { payment_type: 'Now', description: 'Refund excludes glass and tyres', payments: payment(44) } }];
    expect(carContractIdentity(offer(capture, criteria).contract)).not.toBe(carContractIdentity(result.contract));
  });
  it('itemizes an included young-driver fee exactly once', () => {
    const capture = fixture(); capture.visibleTotal = 'USD $214.65'; capture.visiblePayNow = 'USD $214.65';
    capture.vehicle.package.payments.payNow.total = payment(214.65);
    capture.vehicle.package.fees.push({ code: '13', name: 'Young Driver', included_in_vehicle_price: true, payment_type: 'Now', rental_price: payment(165) });
    const result = offer(capture);
    expect(result.charges.find(charge => charge.kind === 'young_driver')?.amount.value?.minor).toBe(16500);
    expect(result.charges.find(charge => charge.id === 'rental-now')?.amount.value?.minor).toBe(4965);
    expect(assessCarPrice(result, search, new Date('2026-09-06T12:01:00Z'))).toMatchObject({ eligible: true, total: { minor: 21465 } });
  });
  it.each([
    ['station disagreement', (c: ReturnType<typeof fixture>) => { c.pickupBranch.id = 999; }],
    ['timezone disagreement', (c: ReturnType<typeof fixture>) => { c.pickupBranch.timezone = 'America/New_York'; }],
    ['different visible supplier', (c: ReturnType<typeof fixture>) => { c.visibleSupplier = 'Another supplier'; }],
    ['different visible vehicle', (c: ReturnType<typeof fixture>) => { c.visibleModel = 'Another model'; }],
    ['unreconciled price', (c: ReturnType<typeof fixture>) => { c.visibleTotal = 'USD $50.00'; }],
    ['wrong displayed currency', (c: ReturnType<typeof fixture>) => { c.visibleTotal = 'EUR 49.65'; }],
    ['missing licence terms', (c: ReturnType<typeof fixture>) => { c.sections = c.sections.filter(section => section.title !== 'Driver Information'); }],
    ['missing coverage', (c: ReturnType<typeof fixture>) => { c.vehicle.package.coverages = []; }],
    ['stale quote session', (c: ReturnType<typeof fixture>) => { c.quoteMatchesUrl = false; }],
    ['different rendered request', (c: ReturnType<typeof fixture>) => { c.providerContext.drivers_age = '23'; }],
  ])('returns an incomplete candidate rather than inventing a contract for %s', (_, change) => {
    const capture = fixture(); change(capture);
    const result = extractAutoEuropeOffer(capture, search);
    expect(result).not.toHaveProperty('contract');
    expect(result).toMatchObject({ reasons: expect.arrayContaining([expect.any(String)]) });
  });
  it('excludes request-only extras and unknown mandatory local charges from confirmed alerts', () => {
    const criteria = { ...search, extras: { ...search.extras, additionalDrivers: [{ age: 30, licenceYears: 5, residenceCountry: 'US' }] } };
    expect(extractAutoEuropeOffer(fixture(), criteria)).toMatchObject({ reasons: [expect.stringMatching(/request-only/)] });
    const capture = fixture(); capture.vehicle.package.fees.push({ code: 'unknown-local-fee' });
    expect(extractAutoEuropeOffer(capture, search)).toMatchObject({ reasons: [expect.stringMatching(/mandatory/)] });
  });
  it('keeps identity across fresh quote sessions but changes it when supplier requirements change', () => {
    const first = offer(); const capture = fixture(); capture.url = capture.url.replace('sanitized', 'fresh-session');
    expect(carContractIdentity(offer(capture).contract)).toBe(carContractIdentity(first.contract));
    capture.sections.find(section => section.title === 'Vehicle Pick-up and Return')!.text = 'Supplier now requires a recent proof of address.';
    expect(carContractIdentity(offer(capture).contract)).not.toBe(carContractIdentity(first.contract));
  });
  it.each(['AU', 'NZ'])('does not qualify unresolved payment surcharges for %s residents', residenceCountry => {
    const capture = fixture();
    const criteria = { ...search, driver: { ...search.driver, residenceCountry } };
    capture.url = capture.url.replace('residence_country=US', `residence_country=${residenceCountry}`);
    capture.providerContext.residence_country = residenceCountry;
    capture.sections.find(section => section.title === 'General Terms')!.text += ' For Australia and New Zealand residents only: credit card payments incur a surcharge of 1.8%.';
    expect(extractAutoEuropeOffer(capture, criteria)).toMatchObject({ reasons: [expect.stringMatching(/surcharge/)] });
  });
  it.each([-1, 0, 1])('evaluates free cancellation at the actual deadline (%s ms)', offset => {
    const capture = fixture();
    capture.observedAt = new Date(Date.parse(search.pickupAt.instant) - 48 * 3_600_000 + offset).toISOString();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(capture.observedAt));
    try { expect(offer(capture).freeCancellation.value).toBe(offset < 0); }
    finally { vi.useRealTimers(); }
  });
});

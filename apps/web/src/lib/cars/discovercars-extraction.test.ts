import { describe, expect, it } from 'vitest';
import { extractDiscoverCarsOffer } from './discovercars-extraction';
import { validateCarSearch } from './validation';
import { assessCarPrice } from './pricing';
import { carContractIdentity } from './identity';
import type { DiscoverCarsCapture } from './discovercars-capture';
import type { DiscoverCarsProtection } from './discovercars-protection';
import { selectCarObservation } from './selection';

const location = { name: 'London Heathrow Airport', country: 'GB', timeZone: 'Europe/London', providerIds: { discovercars: '1712' } };
const search = validateCarSearch({ pickup: location, dropoff: location, pickupAt: { date: '2026-10-15', time: '11:00' }, dropoffAt: { date: '2026-10-18', time: '11:00' }, driver: { age: 35, licenceYears: 2, residenceCountry: 'GB' }, sources: ['discovercars'], currency: 'USD' }, new Date('2026-09-01'));
const request = { PickupLocationId: 1712, DropOffLocationId: 1712, PickupDateTime: '2026-10-15T11:00:00', DropOffDateTime: '2026-10-18T11:00:00', DriverAge: 35, ResidenceCountry: 'GB' };
const price = (amount: number) => ({ amount, currency: 'USD' });
function fixture() {
  const id = '11111111-2222-4333-8444-555555555555-RATE';
  return {
    url: `https://www.discovercars.com/offer/${id}?sq=${encodeURIComponent(Buffer.from(JSON.stringify(request)).toString('base64'))}`,
    observedAt: '2026-09-06T12:00:00Z', selectable: true as boolean, protection: null as DiscoverCarsProtection | null,
    currencyContext: { value: 'USD', status: 'confirmed', text: 'Selected search currency USD', observedAt: '2026-09-06T12:00:00Z', sourceUrl: `https://www.discovercars.com/search/session?sq=${encodeURIComponent(Buffer.from(JSON.stringify(request)).toString('base64'))}` },
    visibleModel: 'Example crossover', visibleModelBasis: 'Example crossover or similar Compact', visibleSupplier: 'Example supplier',
    visibleInclusions: ['Unlimited mileage', 'Collision damage waiver with $2,000.00 excess', 'Theft Protection', 'Third Party Liability (TPL)'],
    visibleTotal: 'Total for 3 days $134.94', priceLines: [{ label: 'Rental prepayment', amount: '$134.94', payment: 'now' }, { label: 'Rental', amount: '$0.00', payment: 'pickup' }],
    visiblePickup: 'Thursday, Oct 15, 2026, 11:00 AM', visibleDropoff: 'Sunday, Oct 18, 2026, 11:00 AM',
    offer: {
      offerId: id, supplier: { id: 320, name: 'Example supplier', hiddenPartner: false }, rentalPeriod: 3, extras: [], coverage: { isChecked: false },
      vehicle: { model: { name: 'Example crossover', sipp: 'CDAR', exact: false }, specifications: { seats: 5, isAutomatic: true }, fuelPolicy: 'Full to full' },
      pickup: { placeId: 1712, address: 'Terminal 2 rental office', instructions: 'Take the free shuttle from stop 7.', pickTypeID: 3, datetime: '2026-10-15T11:00:00+03:00' },
      dropoff: { placeId: 1712, address: 'Terminal 2 rental office', instructions: 'Return to the same office.', type: 'airport', datetime: '2026-10-18T11:00:00+03:00' },
      includedOptions: [{ id: 62, params: null }, { id: 34, params: { type: 'fixed', ...price(2000) } }, { id: 67, params: null }, { id: 69, params: null }], deposit: [] as unknown,
      priceObject: { blocks: { payNow: { total: { client: price(134.94) }, items: [{ key: 'rentalPrepayment', client: price(134.94) }] }, atPickUp: { total: { client: price(0) }, items: [{ key: 'rental', client: price(0) }] }, total: { client: price(134.94) } } },
    },
    sections: [
      { title: 'document', text: 'Minimum rental age is 23 years. Maximum rental age is 74 years. Licence issued at least 2 year(s) before the rental. Bring physical documents.' },
      { title: 'payment', text: 'A physical credit card in the main driver name is required.' },
      { title: 'waiting-period', text: 'Office opens 05:00 to 23:59. Vehicle held for 29 minutes.' },
      { title: 'cross-border', text: 'Cross-border travel requires permission and extra charges.' },
      { title: 'protection', text: 'Included insurance Collision Damage Waiver, Theft Protection and Third Party Liability. Deductible approximately USD 2000.' },
      { title: 'mileage', text: 'There is no limit on kilometers or miles traveled.' },
      { title: 'rate-includes', text: 'Free cancellation with a full refund up to 48 hours before your pick-up time, Unlimited mileage, State Tax, Premium Location fee, Surcharges.' },
    ],
  } satisfies DiscoverCarsCapture;
}
function offer(capture = fixture()) {
  const result = extractDiscoverCarsOffer(capture, search);
  if (!('contract' in result)) throw new Error(result.reasons.join('; '));
  return result;
}
function localExtrasFixture() {
  const capture: DiscoverCarsCapture = fixture();
  const criteria = { ...search, extras: { ...search.extras, childSeats: [{ category: 'child' as const, quantity: 2 }], additionalDrivers: [search.driver, { age: 45, licenceYears: 10, residenceCountry: 'GB' }] } };
  capture.offer.extras = [{ id: 4, idWithMap: '4_17671', selectedCount: 0, maxQuantity: 3, freeSelectable: 0, payable: 'atPickUp', ...price(38.97) }, { id: 6, idWithMap: '6_17668', selectedCount: 0, maxQuantity: 3, freeSelectable: 0, payable: 'atPickUp', ...price(36) }];
  const localExtras = { offerId: String(capture.offer.offerId), observedAt: capture.observedAt, terms: 'Prices and availability are subject to change. Prices are a guide only.',
    selections: [{ id: 4, productId: '4_17671', kind: 'child_seat' as const, category: 'child' as const, quantity: 2, label: 'Child seat (9-18 kg)', visibleUnitPrice: '$38.97 for rental period' }, { id: 6, productId: '6_17668', kind: 'additional_driver' as const, category: null, quantity: 2, label: 'Additional driver', visibleUnitPrice: '$36.00 for rental period' }],
    visibleTotal: '$284.88', priceLines: [...capture.priceLines, { label: 'Child seat (9-18 kg) (2)', amount: '$77.94', payment: 'pickup' as const }, { label: 'Additional driver (2)', amount: '$72.00', payment: 'pickup' as const }],
  };
  capture.localExtras = localExtras;
  return { capture, criteria, localExtras };
}
describe('verified DiscoverCars rental contracts', () => {
  it('shows selected quantities and estimated totals without selecting them for tracker prices', () => {
    const { capture, criteria } = localExtrasFixture(), result = extractDiscoverCarsOffer(capture, criteria);
    if (!('contract' in result)) throw new Error(result.reasons.join('; '));
    expect(result.total).toMatchObject({ value: { minor: 28488 }, status: 'estimated' });
    expect(result.charges.filter(charge => charge.kind === 'extra').map(charge => charge.amount)).toMatchObject([{ value: { minor: 7794 }, status: 'estimated' }, { value: { minor: 7200 }, status: 'estimated' }]);
    expect(result.charges.find(charge => charge.id === 'payNow-rentalPrepayment')?.amount.status).toBe('confirmed');
    expect(result.contract.additionalDrivers).toEqual(criteria.extras.additionalDrivers);
    expect(result.contract.coverageProductIds).not.toContain('4_17671');
    expect(result.extras).toMatchObject([{ quantity: 2, availability: { value: null, status: 'unknown' } }, { quantity: 2, eligibility: { value: null, status: 'unknown' } }]);
    expect(assessCarPrice(result, criteria, new Date(capture.observedAt))).toMatchObject({ eligible: false, total: null });
    expect(selectCarObservation({ scope: 'checked_provider_offers', offers: [result], candidates: [], errors: [], total: 1, completed: 1, successfulProviders: 1, providers: [{ source: 'discovercars', status: 'complete', checked: 1, discoveredVisible: 1, limit: 8, truncated: false }] }, criteria, undefined, new Date(capture.observedAt))).toMatchObject({ status: 'no_eligible_checked_offers' });
  });
  it('preserves selected seats and additional drivers alongside a confirmed protection charge', () => {
    const { capture, criteria, localExtras } = localExtrasFixture();
    criteria.extras.protection = [{ source: 'discovercars', productId: '35' }];
    capture.protection = { offerId: String(capture.offer.offerId), productId: '35', name: 'Full Coverage', selected: true, price: { period: 55.29, currency: 'USD' }, terms: 'Reimbursement protection with exclusions.', visibleTotal: '$340.17', priceLines: [...localExtras.priceLines, { label: 'Full Coverage', amount: '$55.29', payment: 'now' }], observedAt: capture.observedAt };
    const result = extractDiscoverCarsOffer(capture, criteria);
    if (!('contract' in result)) throw new Error(result.reasons.join('; '));
    expect(result.total).toMatchObject({ value: { minor: 34017 }, status: 'estimated' });
    expect(result.charges.find(charge => charge.id === 'protection-35')?.amount).toMatchObject({ value: { minor: 5529 }, status: 'confirmed' });
    expect(result.contract.coverageProductIds).toContain('35');
    expect(assessCarPrice(result, criteria, new Date(capture.observedAt)).eligible).toBe(false);
    capture.protection.priceLines = capture.protection.priceLines.filter(line => !line.label.includes('Child seat'));
    expect(extractDiscoverCarsOffer(capture, criteria)).toMatchObject({ reasons: [expect.stringMatching(/reconcile/)] });
  });
  it.each(['wrong-quote', 'stale', 'wrong-category', 'wrong-quantity', 'wrong-unit-price', 'missing-line', 'double-counted', 'changed-payment', 'unrequested'])('rejects %s local-extra evidence', mode => {
    const { capture, criteria, localExtras } = localExtrasFixture();
    if (mode === 'wrong-quote') localExtras.offerId = 'another-quote';
    if (mode === 'stale') localExtras.observedAt = '2026-09-05T12:00:00Z';
    if (mode === 'wrong-category') localExtras.selections[0]!.id = 3;
    if (mode === 'wrong-quantity') localExtras.selections[0]!.quantity = 1;
    if (mode === 'wrong-unit-price') localExtras.selections[0]!.visibleUnitPrice = '$30.00 for rental period';
    if (mode === 'missing-line') localExtras.priceLines.pop();
    if (mode === 'double-counted') localExtras.priceLines.push({ ...localExtras.priceLines[2]! });
    if (mode === 'changed-payment') localExtras.priceLines[2]!.payment = 'now';
    if (mode === 'unrequested') criteria.extras.childSeats = [];
    expect(extractDiscoverCarsOffer(capture, criteria)).not.toHaveProperty('contract');
  });
  it.each(['null', 'omitted'])('explains %s optional-selection metadata without certifying the quote', absence => {
    const capture: DiscoverCarsCapture = fixture();
    if (absence === 'null') capture.offer.coverage = null;
    else delete capture.offer.coverage;
    const result = extractDiscoverCarsOffer(capture, search);
    expect(result).not.toHaveProperty('contract');
    expect(result).toMatchObject({ reasons: [expect.stringMatching(/did not disclose whether optional protection was selected/)] });
  });
  it('explains own-insurance requirements only for the residence to which they apply', () => {
    const capture = fixture();
    capture.sections.find(row => row.title === 'protection')!.text += ' USA residents must use their own Third Party Liability and Collision Damage Waiver insurance policies.';
    expect(extractDiscoverCarsOffer(capture, search)).toHaveProperty('contract');
    const query = encodeURIComponent(Buffer.from(JSON.stringify({ ...request, ResidenceCountry: 'US' })).toString('base64'));
    capture.url = capture.url.split('?')[0] + `?sq=${query}`;
    capture.currencyContext.sourceUrl = capture.currencyContext.sourceUrl.split('?')[0] + `?sq=${query}`;
    const result = extractDiscoverCarsOffer(capture, { ...search, driver: { ...search.driver, residenceCountry: 'US' } });
    expect(result).not.toHaveProperty('contract');
    expect(result).toMatchObject({ reasons: [expect.stringMatching(/US residents must provide their own/)] });
  });
  it('accepts explicit uncapped maximum age while still enforcing minimum age and licence tenure', () => {
    const capture = fixture();
    capture.sections.find(row => row.title === 'document')!.text = 'Minimum rental age is 23 years. There is no maximum age. Licence issued at least 2 year(s) before the rental.';
    expect(offer(capture).driverEligible).toMatchObject({ value: true, status: 'confirmed' });
    capture.sections.find(row => row.title === 'document')!.text = 'Minimum rental age is 23 years. There is no maximum age. Licence issued at least 4 year(s) before the rental.';
    expect(offer(capture).driverEligible.value).toBe(false);
    capture.sections.find(row => row.title === 'document')!.text = 'Minimum rental age is 40 years. There is no maximum age. Licence issued at least 2 year(s) before the rental.';
    expect(offer(capture).driverEligible.value).toBe(false);
  });
  it('rejects contradictory maximum-age conditions', () => {
    const capture = fixture();
    capture.sections.find(row => row.title === 'document')!.text += ' There is no maximum age.';
    expect(extractDiscoverCarsOffer(capture, search)).toMatchObject({ reasons: [expect.stringMatching(/age.*conflict/)] });
  });
  it('retains conditional mileage terms and does not certify an unlimited-mileage headline', () => {
    const capture = fixture();
    const terms = 'For rentals lasting from 1 days to 3 days, mileage is limited to 250 miles per day. For rentals more than 3 days mileage is unlimited.';
    capture.sections.push({ title: 'mileage-policy', text: terms });
    const result = offer(capture);
    expect(result.contract.mileagePolicy).toContain(terms);
    expect(result.unlimitedMileage).toMatchObject({ value: null, status: 'unknown', text: expect.stringContaining(terms) });
    expect(assessCarPrice(result, { ...search, filters: { ...search.filters, unlimitedMileage: true } }, new Date('2026-09-06T12:01:00Z')).eligible).toBe(false);
  });
  it('normalizes office layout whitespace without changing contract identity or dropping conditions', () => {
    const capture = fixture(), original = offer(capture);
    capture.offer.pickup.address = '\tTerminal 2\r\nrental office\n';
    capture.offer.pickup.instructions = 'Take the free\nshuttle\tfrom stop 7.';
    capture.offer.dropoff.instructions = '\nReturn to\r\nthe same office.\n';
    const result = offer(capture);
    expect(carContractIdentity(result.contract)).toBe(carContractIdentity(original.contract));
    expect(result.requirements.find(row => row.condition === 'Return office')?.evidence.text).toContain('Return to the same office.');
    capture.offer.dropoff.instructions += '\nVehicles left at the terminal incur a £200 fine.';
    expect(carContractIdentity(offer(capture).contract)).not.toBe(carContractIdentity(original.contract));
    expect(offer(capture).contract.rentalRequirements).toContain('£200 fine');
  });
  it.each(['', '\n\t', '$72', 'Office\u0000conditions', 'Office\u001b[31mconditions', ' '.repeat(12001) + 'office'])('keeps absent, unresolved or unsafe office terms out of verified contracts', instructions => {
    const capture = fixture(); capture.offer.dropoff.instructions = instructions;
    const result = extractDiscoverCarsOffer(capture, search);
    expect(result).not.toHaveProperty('contract');
    expect(result).toMatchObject({ reasons: [expect.stringMatching(/Return office instructions/)] });
  });
  it('reconciles prepaid rental while keeping an undisclosed deposit unknown', () => {
    const result = offer();
    expect(assessCarPrice(result, search, new Date('2026-09-06T12:01:00Z'))).toMatchObject({ eligible: true, total: { minor: 13494 }, payAtPickup: { minor: 0 } });
    expect(result.deposit).toMatchObject({ value: null, status: 'unknown' });
    expect(result.excess).toMatchObject({ value: { minor: 200000 }, status: 'estimated' });
    expect(result.contract.pickupStationId).toMatch(/^derived-station-v1:/);
    expect(result.contract.pickupAt.instant).toBe('2026-10-15T10:00:00Z');
  });
  it('retains a contract across fresh sessions but distinguishes collection-service changes', () => {
    const first = offer(), capture = fixture();
    capture.url = capture.url.replace('11111111', '99999999'); capture.offer.offerId = capture.offer.offerId.replace('11111111', '99999999');
    expect(carContractIdentity(offer(capture).contract)).toBe(carContractIdentity(first.contract));
    capture.offer.pickup.instructions = 'Collect at an off-airport office using a paid taxi.';
    expect(carContractIdentity(offer(capture).contract)).not.toBe(carContractIdentity(first.contract));
  });
  it.each([
    ['wrong visible time', (c: ReturnType<typeof fixture>) => { c.visiblePickup = 'Thursday, Oct 15, 2026, 10:00 AM'; }],
    ['missing office', (c: ReturnType<typeof fixture>) => { c.offer.pickup.address = ''; }],
    ['wrong supplier', (c: ReturnType<typeof fixture>) => { c.visibleSupplier = 'Other'; }],
    ['wrong total', (c: ReturnType<typeof fixture>) => { c.visibleTotal = '$130.00'; }],
    ['unpriced compulsory insurance', (c: ReturnType<typeof fixture>) => { c.sections.find(s => s.title === 'protection')!.text += ' Customers need to purchase insurance at the counter.'; }],
    ['misidentified coverage', (c: ReturnType<typeof fixture>) => { c.visibleInclusions[1] = 'Mileage'; }],
    ['conflicting displayed currency', (c: ReturnType<typeof fixture>) => { c.visibleTotal = '€134.94'; }],
    ['ambiguous currency context', (c: ReturnType<typeof fixture>) => { c.currencyContext.value = 'CAD'; }],
    ['unrequested protection', (c: ReturnType<typeof fixture>) => { c.offer.coverage.isChecked = true; }],
    ['contradictory model guarantee', (c: ReturnType<typeof fixture>) => { c.offer.vehicle.model.exact = true; }],
  ])('keeps %s out of complete contracts', (_, change) => {
    const capture = fixture(); change(capture);
    expect(extractDiscoverCarsOffer(capture, search)).toMatchObject({ reasons: expect.arrayContaining([expect.any(String)]) });
    expect(extractDiscoverCarsOffer(capture, search)).not.toHaveProperty('contract');
  });
  it('does not qualify a quote whose continuation is unavailable', () => {
    const capture = fixture(); capture.selectable = false;
    expect(assessCarPrice(offer(capture), search, new Date('2026-09-06T12:01:00Z'))).toMatchObject({ eligible: false, reasons: expect.arrayContaining([expect.stringMatching(/availability/)]) });
  });
  it.each(['taxes excluded, surcharges payable locally', 'no unlimited mileage, State Tax, Surcharges'])('does not turn negative inclusion language into a verified benefit: %s', terms => {
    const capture = fixture();
    capture.sections.find(section => section.title === 'rate-includes')!.text = `Free cancellation with a full refund up to 48 hours before your pick-up time, ${terms}`;
    const criteria = { ...search, filters: { ...search.filters, unlimitedMileage: true } };
    expect(assessCarPrice(offer(capture), criteria, new Date('2026-09-06T12:01:00Z'))).toMatchObject({ eligible: false });
  });
  it('adds the selected protection period price once and retains the supplier excess separately', () => {
    const capture = fixture();
    capture.protection = { offerId: capture.offer.offerId, productId: '35', name: 'Full Coverage', selected: true, price: { day: 18.43, period: 55.29, currency: 'USD' }, terms: 'Reimbursement product; excludes personal possessions and breaches of the rental agreement.', visibleTotal: '$190.23', priceLines: [...capture.priceLines.map(line => ({ ...line })), { label: 'Full Coverage', amount: '$55.29', payment: 'now' }], observedAt: capture.observedAt };
    const criteria = { ...search, extras: { ...search.extras, protection: [{ source: 'discovercars' as const, productId: '35' }] } };
    const result = extractDiscoverCarsOffer(capture, criteria);
    expect(result).toHaveProperty('contract');
    expect(assessCarPrice(result, criteria, new Date('2026-09-06T12:01:00Z'))).toMatchObject({ eligible: true, total: { minor: 19023 }, payNow: { minor: 19023 } });
    if (!('contract' in result)) return;
    expect(result.excess.value?.minor).toBe(200000);
    expect(result.contract.coverageTerms).toContain('excludes personal possessions');
    capture.protection.visibleTotal = '$190.22';
    expect(extractDiscoverCarsOffer(capture, criteria)).toMatchObject({ reasons: [expect.stringMatching(/reconcile/)] });
    capture.protection.visibleTotal = '$190.23';
    capture.protection.priceLines[0]!.payment = 'pickup';
    expect(extractDiscoverCarsOffer(capture, criteria)).toMatchObject({ reasons: [expect.stringMatching(/reconcile/)] });
    capture.protection.priceLines[0]!.payment = 'now';
    capture.protection.priceLines[2]!.label = 'Roadtrip assistance';
    expect(extractDiscoverCarsOffer(capture, criteria)).toMatchObject({ reasons: [expect.stringMatching(/reconcile/)] });
  });
});

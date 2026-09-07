import { describe, expect, it } from 'vitest';
import { extractDiscoverCarsOffer } from './discovercars-extraction';
import { validateCarSearch } from './validation';
import { assessCarPrice } from './pricing';
import { carContractIdentity } from './identity';
import type { DiscoverCarsCapture } from './discovercars-capture';
import type { DiscoverCarsProtection } from './discovercars-protection';

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
describe('verified DiscoverCars rental contracts', () => {
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

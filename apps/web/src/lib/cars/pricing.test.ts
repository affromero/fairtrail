import { describe, expect, it } from 'vitest';
import { assessCarPrice as assessPrice, assessCarProtectionReview } from './pricing';
import { validateCarOffer } from './offer-validation';
import { parseCarMoney, sumCarMoney } from './money';
import { carContractIdentity } from './identity';
import { validateCarSearch } from './validation';
import { carRequirementTerms } from './requirements';
import type { CarEvidence, CarOffer, CarRequirement, CarSearch } from './types';

const evidence = <T>(value: T): CarEvidence<T> => ({ value, status: 'confirmed', text: 'Provider rental detail', sourceUrl: 'https://www.discovercars.com/offer/example', observedAt: '2026-09-06T12:00:00Z' });
const money = (minor: number) => ({ currency: 'USD', minor });
const assessCarPrice = (raw: unknown, criteria: CarSearch) => assessPrice(raw, criteria, new Date('2026-09-06T12:01:00Z'));
const search = validateCarSearch({
  pickup: { name: 'Heathrow', country: 'GB', timeZone: 'Europe/London', providerIds: { discovercars: '1712' } },
  dropoff: { name: 'Gatwick', country: 'GB', timeZone: 'Europe/London', providerIds: { discovercars: '1600' } },
  pickupAt: { date: '2026-10-15', time: '11:00' }, dropoffAt: { date: '2026-10-18', time: '11:00' },
  driver: { age: 23, licenceYears: 2, residenceCountry: 'US' }, currency: 'USD', sources: ['discovercars'],
  extras: { childSeats: [{ category: 'child', quantity: 2 }], additionalDrivers: [{ age: 35, licenceYears: 10, residenceCountry: 'US' }], protection: [{ source: 'discovercars', productId: 'full-coverage' }] },
}, new Date('2026-09-01'));

function offer(): CarOffer {
  const requirements: CarRequirement[] = [{ kind: 'physical_licence', appliesTo: 'all_drivers', condition: 'At pickup', evidence: evidence('Present the original valid driving licence') }];
  return {
    id: 'observation-1', supplier: 'Example supplier', observedAt: '2026-09-06T12:00:00Z', bookingUrl: 'https://www.discovercars.com/offer/session-1',
    contract: {
      source: 'discovercars', supplierId: 'supplier-1', pickupLocationId: '1712', dropoffLocationId: '1600', pickupStationId: 'lhr-shuttle-1', dropoffStationId: 'lgw-terminal-1',
      pickupAt: search.pickupAt, dropoffAt: search.dropoffAt, driver: search.driver, additionalDrivers: search.extras.additionalDrivers, currency: 'USD',
      vehicleClass: 'mini', transmission: 'manual', seats: 4, model: 'Fiat 500', modelGuaranteed: false,
      fuelPolicy: 'full_to_full', mileagePolicy: 'unlimited', cancellationPolicy: 'free_until_48h', coverageProductIds: ['third-party', 'full-coverage'], coverageTerms: 'Provider reimbursement; excess USD 1500; excludes lost keys.',
      rentalRequirements: carRequirementTerms(requirements),
      extras: [{ kind: 'child_seat', category: 'child', quantity: 2, productId: 'child-9-18kg' }, { kind: 'additional_driver', category: null, quantity: 1, productId: 'driver' }, { kind: 'protection', category: null, quantity: 1, productId: 'full-coverage' }],
    },
    available: evidence(true), requestVerified: evidence(true), driverEligible: evidence(true), mandatoryChargesComplete: evidence(true), taxesIncluded: evidence(true), unlimitedMileage: evidence(true), freeCancellation: evidence(true),
    requirements, requirementsComplete: evidence(true),
    total: evidence(money(71000)),
    charges: [
      { id: 'prepay', label: 'Prepayment', kind: 'rental', payment: 'now', amount: evidence(money(200)) },
      { id: 'rental', label: 'Rental', kind: 'rental', payment: 'pickup', amount: evidence(money(11800)) },
      { id: 'one-way', label: 'One-way fee', kind: 'one_way', payment: 'pickup', amount: evidence(money(6000)) },
      { id: 'young', label: 'Young driver fee', kind: 'young_driver', payment: 'pickup', amount: evidence(money(32000)) },
      { id: 'seats', label: 'Two child seats', kind: 'extra', payment: 'pickup', amount: evidence(money(13000)) },
      { id: 'coverage', label: 'Full coverage', kind: 'extra', payment: 'now', amount: evidence(money(8000)) },
    ],
    deposit: evidence(money(95000)), excess: evidence(money(150000)),
    extras: [
      { kind: 'child_seat', productId: 'child-9-18kg', category: 'child', quantity: 2, availability: evidence(true), eligibility: evidence(true), included: evidence(false), chargeId: 'seats' },
      { kind: 'additional_driver', productId: 'driver', category: null, quantity: 1, availability: evidence(true), eligibility: evidence(true), included: evidence(true), chargeId: null },
      { kind: 'protection', productId: 'full-coverage', category: null, quantity: 1, availability: evidence(true), eligibility: evidence(true), included: evidence(false), chargeId: 'coverage' },
    ],
  };
}

describe('exact rental amounts', () => {
  it.each([['0.29', 'USD', 29], ['498.48', 'USD', 49848], ['15000', 'JPY', 15000], ['12.345', 'KWD', 12345], ['1.200', 'USD', 120]])('parses %s %s without rounding errors', (decimal, currency, minor) => {
    expect(parseCarMoney(decimal, currency)).toEqual({ currency, minor });
  });
  it.each([['0.001', 'USD'], ['12.5', 'JPY'], ['1.2345', 'KWD'], ['9007199254740992', 'JPY'], ['1e2', 'USD'], ['-1', 'USD'], ['1,200', 'USD'], ['NaN', 'USD'], ['10', 'ZZZ']])('rejects unsupported or lossy price %s %s', (decimal, currency) => {
    expect(() => parseCarMoney(decimal, currency)).toThrow();
  });
  it('rejects mixed currencies and totals beyond safe integer storage', () => {
    expect(() => sumCarMoney([money(100), { currency: 'GBP', minor: 100 }], 'USD')).toThrow(/currencies/);
    expect(() => sumCarMoney([money(Number.MAX_SAFE_INTEGER), money(1)], 'USD')).toThrow(/supported/);
  });
});

describe('confirmed all-in rental totals', () => {
  it('preserves customer document requirements without claiming they have been verified', () => {
    const quote = offer();
    quote.requirements.push({ kind: 'flight_ticket', appliesTo: 'rental', condition: 'Airport pickup', evidence: evidence('Present a return flight ticket') });
    quote.contract.rentalRequirements = carRequirementTerms(quote.requirements);
    expect(validateCarOffer(quote).requirements).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'flight_ticket', appliesTo: 'rental', evidence: expect.objectContaining({ value: 'Present a return flight ticket', status: 'confirmed' }) }),
    ]));
    quote.requirementsComplete = { ...evidence(true), value: null, status: 'unknown' };
    expect(assessCarPrice(quote, search)).toMatchObject({ eligible: false, reasons: [expect.stringMatching(/supplier requirements/)] });
  });
  it('excludes a quote whose supplier restrictions are uncertain despite a complete summary', () => {
    const quote = offer(); quote.requirements[0]!.evidence.status = 'unknown';
    expect(assessCarPrice(quote, search)).toMatchObject({ eligible: false, reasons: [expect.stringMatching(/conditions/)] });
  });
  it('reconciles one-way, young-driver and selected extras without adding deposits, excess or included extras', () => {
    expect(assessCarPrice(offer(), search)).toEqual({ eligible: true, reasons: [], total: money(71000), payNow: money(8200), payAtPickup: money(62800) });
  });
  it.each(['estimated', 'unknown'] as const)('excludes %s extras from alerts even when their guide price is known', status => {
    const quote = offer();
    quote.extras[0]!.availability.status = status;
    expect(assessCarPrice(quote, search)).toMatchObject({ eligible: false, reasons: [expect.stringMatching(/extra/)] });
  });
  it.each([
    ['missing seat quantity', (q: CarOffer) => { q.extras[0]!.quantity = 1; }],
    ['wrong seat category', (q: CarOffer) => { q.extras[0]!.category = 'booster'; }],
    ['ineligible additional driver', (q: CarOffer) => { q.extras[1]!.eligibility.value = false; }],
    ['different protection product', (q: CarOffer) => { q.extras[2]!.productId = 'collision-only'; }],
    ['unpriced required fee', (q: CarOffer) => { q.charges[3]!.amount.value = null; }],
    ['unconfirmed mandatory fees', (q: CarOffer) => { q.mandatoryChargesComplete.status = 'unknown'; }],
    ['missing taxes', (q: CarOffer) => { q.taxesIncluded.value = false; }],
    ['foreign-currency charge', (q: CarOffer) => { q.charges[1]!.amount.value = { currency: 'GBP', minor: 11800 }; }],
    ['unreconciled total', (q: CarOffer) => { q.total.value = money(71001); }],
    ['duplicate payable item', (q: CarOffer) => { q.charges.push(q.charges[0]!); }],
    ['double-charged included driver', (q: CarOffer) => { q.extras[1]!.chargeId = 'seats'; }],
    ['missing extra line item', (q: CarOffer) => { q.extras[0]!.chargeId = 'missing'; }],
    ['charge reused for two extras', (q: CarOffer) => { q.extras[2]!.chargeId = 'seats'; }],
    ['missing evidence', (q: CarOffer) => { q.total.text = ''; }],
    ['different driver age', (q: CarOffer) => { q.contract.driver = { ...q.contract.driver, age: 35 }; }],
    ['different return location', (q: CarOffer) => { q.contract.dropoffLocationId = '1712'; }],
  ] as const)('withholds eligibility for %s', (scenario, change) => {
    const quote = offer(); change(quote);
    const assessment = assessCarPrice(quote, search);
    expect(assessment.eligible, scenario).toBe(false);
    expect(assessment.reasons.length).toBeGreaterThan(0);
  });
  it('keeps unavailable and unknown offers distinct from a zero-price deal', () => {
    const quote = offer(); quote.available.value = false; quote.total.value = money(0);
    expect(assessCarPrice(quote, search)).toMatchObject({ eligible: false, reasons: expect.arrayContaining([expect.stringMatching(/availability/), expect.stringMatching(/positive/)]) });
  });
  it.each([
    { seats: undefined }, { seats: Number.NaN }, { seats: '4' }, { seats: 0 },
    { transmission: 'unknown' }, { supplierId: '' }, { pickupStationId: '' },
    { modelGuaranteed: 'false' }, { coverageProductIds: [] },
    { coverageProductIds: ['third-party'] }, { extras: [] },
  ])('withholds eligibility for malformed or contradictory contract data %j', contract => {
    const quote = offer();
    expect(assessCarPrice({ ...quote, contract: { ...quote.contract, ...contract } }, search)).toMatchObject({ eligible: false });
  });
  it.each([
    { value: undefined }, { text: 123 }, { value: 'true' }, { status: 'verified' },
    { sourceUrl: 'https://attacker.example/quote' },
    { sourceUrl: 'https://www.discovercars.com.attacker.example/quote' },
    { sourceUrl: 'https://book.autoeurope.com/en-us/options' },
    { observedAt: '2026-09-05T12:00:00Z' },
    { observedAt: '2099-01-01T12:00:00Z' },
    { observedAt: '2026-02-30T12:00:00Z' },
  ])('rejects malformed, foreign, stale or future evidence %j without throwing', invalid => {
    const quote = offer();
    expect(assessCarPrice({ ...quote, available: { ...quote.available, ...invalid } }, search)).toMatchObject({ eligible: false });
  });
  it.each([undefined, null, 'false', true, { ...evidence(true), status: 'estimated' }])('requires explicit confirmed evidence that an extra is included: %j', included => {
    const quote = offer();
    expect(assessCarPrice({ ...quote, extras: quote.extras.map(e => e.kind === 'additional_driver' ? { ...e, included } : e) }, search)).toMatchObject({ eligible: false });
  });
  it('returns a structured rejection for malformed stored offers', () => {
    for (const invalid of [null, [], {}, { contract: null }, { ...offer(), charges: null }, { ...offer(), available: null }]) {
      expect(assessCarPrice(invalid, search)).toMatchObject({ eligible: false, total: null, payNow: null, payAtPickup: null });
    }
  });
  it('keeps historical quotes readable but excludes an expired observation from current prices and alerts', () => {
    const quote = offer();
    const later = new Date('2026-09-06T12:16:00Z');
    expect(validateCarOffer(quote, later).total.value).toEqual(money(71000));
    expect(assessPrice(quote, search, later)).toMatchObject({ eligible: false, reasons: [expect.stringMatching(/expired/)] });
  });
});

describe('protection review of selected-options estimates', () => {
  const review = (quote: CarOffer) => assessCarProtectionReview(quote, search, new Date('2026-09-06T12:01:00Z'));
  function estimatedOffer() {
    const quote = offer();
    quote.total.status = 'estimated';
    quote.charges.find(charge => charge.id === 'seats')!.amount.status = 'estimated';
    for (const extra of quote.extras.filter(extra => extra.kind !== 'protection')) {
      extra.availability = { ...evidence<boolean>(true), status: 'unknown', value: null };
      extra.eligibility = { ...evidence<boolean>(true), status: 'unknown', value: null, text: 'Supplier confirmation required; additional-driver surcharges may apply' };
    }
    return quote;
  }
  it('allows another quote for priced request-only extras without enabling price tracking or changing evidence', () => {
    const quote = estimatedOffer(), original = structuredClone(quote);
    expect(review(quote)).toEqual({ allowed: true, reasons: [] });
    expect(assessCarPrice(quote, search).eligible).toBe(false);
    expect(quote).toEqual(original);
  });
  it.each([
    ['unpriced seats', (q: CarOffer) => { q.charges[4]!.amount.value = null; }],
    ['estimated base rental', (q: CarOffer) => { q.charges[0]!.amount.status = 'estimated'; }],
    ['estimated mandatory fee', (q: CarOffer) => { q.charges[3]!.amount.status = 'estimated'; }],
    ['unknown mandatory charges', (q: CarOffer) => { q.mandatoryChargesComplete.status = 'unknown'; }],
    ['unavailable seats', (q: CarOffer) => { q.extras[0]!.availability.value = false; }],
    ['ineligible additional driver', (q: CarOffer) => { q.extras[1]!.eligibility.value = false; }],
    ['wrong quantity', (q: CarOffer) => { q.extras[0]!.quantity = 1; q.contract.extras[0]!.quantity = 1; }],
    ['unknown inclusion', (q: CarOffer) => { q.extras[0]!.included.status = 'unknown'; }],
    ['missing charge association', (q: CarOffer) => { q.extras[0]!.chargeId = 'missing'; }],
    ['unreconciled total', (q: CarOffer) => { q.total.value = money(71001); }],
    ['uncertain protection', (q: CarOffer) => { q.extras[2]!.availability.status = 'unknown'; }],
    ['different driver', (q: CarOffer) => { q.contract.driver = { ...q.contract.driver, age: 40 }; }],
    ['foreign currency', (q: CarOffer) => { q.charges[4]!.amount.value = { currency: 'GBP', minor: 13000 }; }],
  ] as const)('rejects review with %s', (scenario, change) => {
    const quote = estimatedOffer(); change(quote);
    expect(review(quote).allowed, scenario).toBe(false);
    expect(assessCarPrice(quote, search).eligible).toBe(false);
  });
  it('does not use an estimated total when no selected charge explains the estimate', () => {
    const quote = offer(); quote.total.status = 'estimated';
    expect(review(quote)).toMatchObject({ allowed: false, reasons: expect.arrayContaining([expect.stringMatching(/total/)]) });
  });
});

describe('comparable rental contract identity', () => {
  it('survives fresh session URLs and a changed illustrative model for an or-similar rate', () => {
    const first = offer(), next = offer();
    next.id = 'new-observation'; next.bookingUrl = 'https://www.discovercars.com/offer/session-2'; next.contract.model = 'Toyota Aygo';
    expect(carContractIdentity(next.contract)).toBe(carContractIdentity(first.contract));
    expect(next.contract.modelGuaranteed).toBe(false);
  });
  it('treats a guaranteed model as part of the contract rather than an interchangeable example', () => {
    const first = offer().contract, next = offer().contract;
    first.modelGuaranteed = true; next.modelGuaranteed = true; next.model = 'Toyota Aygo';
    expect(carContractIdentity(next)).not.toBe(carContractIdentity(first));
  });
  it('rejects invalid stored contract data instead of creating an identity with missing fields', () => {
    expect(() => carContractIdentity({ ...offer().contract, seats: undefined })).toThrow(/seats/i);
    expect(() => carContractIdentity({ ...offer().contract, pickupStationId: '' })).toThrow(/station/i);
  });
  it.each([
    (q: CarOffer) => { q.contract.pickupStationId = 'different-terminal'; },
    (q: CarOffer) => { q.contract.pickupAt = { ...q.contract.pickupAt, time: '12:00', instant: '2026-10-15T11:00:00Z' }; },
    (q: CarOffer) => { q.contract.coverageProductIds = ['third-party']; },
    (q: CarOffer) => { q.contract.coverageTerms = 'Supplier waiver; zero excess; includes lost keys.'; },
    (q: CarOffer) => { q.contract.extras[0]!.quantity = 1; },
    (q: CarOffer) => { q.contract.cancellationPolicy = 'non_refundable'; },
    (q: CarOffer) => { q.contract.driver = { ...q.contract.driver, residenceCountry: 'GB' }; },
  ])('does not match a changed station, time, coverage, extras, cancellation or residence', change => {
    const original = offer(), next = offer(); change(next);
    expect(carContractIdentity(next.contract)).not.toBe(carContractIdentity(original.contract));
  });
});

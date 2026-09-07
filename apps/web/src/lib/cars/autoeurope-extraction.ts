import { createHash } from 'node:crypto';
import type { AutoEuropeCapture } from './autoeurope-capture';
import { carRecord, carText } from './validation';
import { parseCarMoney, sumCarMoney } from './money';
import { verifyCarProviderContext } from './provider-context';
import { carProviderUrl, validateCarOffer } from './offer-validation';
import { carRequirementTerms } from './requirements';
import { CarError, type CarCandidate, type CarCharge, type CarEvidence, type CarExtraQuote, type CarMoney, type CarOffer, type CarRequirement, type CarSearch } from './types';

const text = (raw: unknown) => carText(raw, 12000, 'provider field');
function providerId(raw: unknown): string {
  if ((typeof raw !== 'string' && typeof raw !== 'number') || !/^\d+$/.test(String(raw))) throw new CarError('Provider omitted a stable supplier or station identifier');
  return String(raw);
}
function rows(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw) || raw.length > 100) throw new CarError('Provider returned an invalid quote list');
  return raw.map(carRecord);
}
function amount(raw: unknown, currency: string): CarMoney {
  const value = carRecord(raw);
  if (value.currency !== currency && value.amount !== 0) throw new CarError('Provider charges use different currencies');
  if (typeof value.amount !== 'number' && typeof value.amount !== 'string') throw new CarError('Missing provider amount');
  return parseCarMoney(String(value.amount), currency);
}
function visibleAmount(value: string, currency: string): CarMoney {
  if (!value.includes(currency)) throw new CarError('Visible quote does not identify the requested currency');
  const match = value.match(/([\d,]+\.\d{2,3}|\d[\d,]*)\s*$/);
  if (!match) throw new CarError('Provider total was not visible');
  return parseCarMoney(match[1]!.replaceAll(',', ''), currency);
}

export function extractAutoEuropeOffer(capture: AutoEuropeCapture, search: CarSearch): CarOffer | CarCandidate {
  carProviderUrl(capture.url, 'autoeurope');
  const proof = <T>(value: T | null, body: string, status: CarEvidence<T>['status'] = 'confirmed'): CarEvidence<T> => ({ value, text: body, status, sourceUrl: capture.url, observedAt: capture.observedAt });
  const section = (title: string) => capture.sections.find(item => item.title === title)?.text ?? '';
  const requirements: CarRequirement[] = capture.sections.filter(item => ['Driver Information', 'Payment and Charges', 'Vehicle Pick-up and Return', 'Geographical Restrictions'].includes(item.title)).map(item => ({ kind: 'other', appliesTo: 'all_drivers', condition: item.title, evidence: proof(item.text, item.text) }));
  const specificRequirements: [CarRequirement['kind'], RegExp, CarRequirement['appliesTo']][] = [
    ['flight_ticket', /Flight tickets\s*\([^)]*\)/i, 'rental'],
    ['physical_licence', /You and all Additional Drivers must present[^.]+\./i, 'all_drivers'],
    ['international_permit', /An International Driving Permit is required[^.]+\./i, 'all_drivers'],
    ['address_proof', /You must provide additional proof of your home address[^.]+\.[^.]+\./i, 'main_driver'],
    ['payment_card', /The following credit cards are accepted:[^.]+\./i, 'main_driver'],
    ['additional_driver', /If you add Additional Drivers[^.]+\./i, 'all_drivers'],
  ];
  const customerTerms = `${section('Driver Information')} ${section('Payment and Charges')}`;
  for (const [kind, pattern, appliesTo] of specificRequirements) {
    const value = customerTerms.match(pattern)?.[0];
    if (value) requirements.push({ kind, appliesTo, condition: 'At vehicle collection; supplier exceptions apply as stated', evidence: proof(value, value) });
  }
  try {
    const requestText = verifyCarProviderContext(capture.url, 'autoeurope', search);
    const renderedContext = new URL(capture.url);
    renderedContext.search = new URLSearchParams(capture.providerContext).toString();
    verifyCarProviderContext(renderedContext.href, 'autoeurope', search);
    if (!capture.quoteMatchesUrl) throw new CarError('Rendered rental terms belong to another quote session');
    const vehicle = carRecord(capture.vehicle), supplier = carRecord(vehicle.supplier), rate = carRecord(vehicle.package);
    const pickup = carRecord(capture.pickupBranch), dropoff = carRecord(capture.dropoffBranch);
    if (providerId(supplier.pickup_office_id) !== providerId(pickup.id) || providerId(supplier.dropoff_office_id) !== providerId(dropoff.id)) throw new CarError('Provider station identifiers disagree');
    if (pickup.timezone !== search.pickupAt.timeZone || dropoff.timezone !== search.dropoffAt.timeZone) throw new CarError('Provider station timezone disagrees with the requested local time');
    if (vehicle.name !== capture.visibleModel || supplier.name !== capture.visibleSupplier) throw new CarError('Visible vehicle does not match the quoted contract');
    if (!/or similar|guaranteed/i.test(capture.visibleModelBasis)) throw new CarError('Provider did not disclose whether the vehicle model is guaranteed');
    const driverTerms = section('Driver Information');
    const minAge = driverTerms.match(/Minimum driver age for the vehicle that you selected is (\d+)/)?.[1];
    const maxAge = driverTerms.match(/Maximum driver age for the vehicle that you selected is (\d+)/)?.[1];
    const licence = driverTerms.match(/held your Driver.s License for a minimum of (\d+) full year/)?.[1];
    if (!minAge || !maxAge || !licence) throw new CarError('Supplier did not disclose supported age and licence conditions');
    const generalTerms = section('General Terms');
    if (['AU', 'NZ'].includes(search.driver.residenceCountry) && /surcharge/i.test(generalTerms)) throw new CarError('A residence-specific payment surcharge is unresolved; the displayed total is not all-in');
    const cancellation = generalTerms.match(/Free cancellation is available up to \d+ hours before[^.]+\./)?.[0];
    if (!cancellation) throw new CarError('Supplier cancellation deadline could not be verified');
    const cancellationHours = Number(cancellation.match(/(\d+) hours/)?.[1]);
    const cancellationAvailable = Date.parse(capture.observedAt) < Date.parse(search.pickupAt.instant) - cancellationHours * 3_600_000;
    if (search.extras.childSeats.length || search.extras.additionalDrivers.length) throw new CarError(`Selected local extras are request-only and not confirmed in this quote: ${section('Optional Extras') || 'No confirmed extra availability or total'}`);
    const inclusions = rows(rate.inclusions);
    const coverage = rows(rate.coverages).filter(item => item.included_in_vehicle_price === true);
    const payments = carRecord(rate.payments);
    const payment = (key: string) => amount(carRecord(carRecord(payments[key]).total).payment, search.currency);
    const payNow = payment('payNow'), payLocal = payment('payLocal');
    const feeCharges: CarCharge[] = rows(rate.fees).map(fee => {
      if (fee.included_in_vehicle_price !== true || fee.payment_type !== 'Now') throw new CarError('Unconfirmed mandatory local fee; supplier verification is required');
      const name = text(fee.name), price = amount(carRecord(fee.rental_price).payment, search.currency);
      const kind = /young|senior/i.test(name) ? 'young_driver' : /one.way/i.test(name) ? 'one_way' : 'other';
      return { id: `fee-${providerId(fee.code)}`, label: name, kind, payment: 'now', amount: proof(price, `${name}: ${price.minor} minor ${search.currency}, included in prepaid rental`) };
    });
    const includedFees = sumCarMoney(feeCharges.map(fee => fee.amount.value!), search.currency);
    if (includedFees.minor > payNow.minor) throw new CarError('Included fees exceed the prepaid rental');
    const baseRental = { ...payNow, minor: payNow.minor - includedFees.minor };
    const charges: CarCharge[] = [
      { id: 'rental-now', label: `Rental with ${text(rate.package_name)}`, kind: 'rental', payment: 'now', amount: proof(baseRental, `Prepaid rental less separately itemized included fees: ${baseRental.minor} minor ${search.currency}`) },
      ...feeCharges,
      ...(payLocal.minor ? [{ id: 'rental-pickup', label: 'Rental payable at pickup', kind: 'rental' as const, payment: 'pickup' as const, amount: proof(payLocal, `Quoted local payment: ${payLocal.minor} minor ${search.currency}`, 'estimated') }] : []),
    ];
    const cart = rows(carRecord(capture.cart).items);
    const protection = search.extras.protection.find(item => item.source === 'autoeurope');
    const extras: CarExtraQuote[] = [];
    if (cart.length !== (protection ? 1 : 0)) throw new CarError('Provider added or omitted a selected extra');
    for (const item of cart) {
      if (item.id !== protection?.productId || item.quantity !== 1) throw new CarError('Selected protection does not match the actual quote');
      const attributes = carRecord(item.attributes), price = amount(carRecord(attributes.payments).payment, search.currency);
      if (attributes.payment_type !== 'Now') throw new CarError('Selected protection is not a confirmed prepaid product');
      const id = text(item.id);
      charges.push({ id, label: text(item.name), kind: 'extra', payment: 'now', amount: proof(price, `${text(item.name)}: ${price.minor} minor ${search.currency}`) });
      extras.push({ kind: 'protection', productId: id, quantity: 1, category: null, availability: proof(true, text(item.name)), eligibility: proof(true, text(attributes.description)), included: proof(false, text(item.name)), chargeId: id });
    }
    const total = visibleAmount(capture.visibleTotal, search.currency);
    const visibleNow = visibleAmount(capture.visiblePayNow, search.currency);
    if (sumCarMoney(charges.map(item => item.amount.value!), search.currency).minor !== total.minor || sumCarMoney(charges.filter(item => item.payment === 'now').map(item => item.amount.value!), search.currency).minor !== visibleNow.minor) throw new CarError('Visible payment summary and itemized quote do not reconcile');
    const depositText = section('Payment and Charges');
    const depositMatch = depositText.match(new RegExp(`security deposit of ${search.currency} ([\\d,]+(?:\\.\\d+)?)`, 'i'));
    const deposit = depositMatch ? parseCarMoney(depositMatch[1]!.replaceAll(',', ''), search.currency) : null;
    const excessAmounts = coverage.map(item => amount(carRecord(item.excessAmount).payment, search.currency));
    const excess = excessAmounts.length ? excessAmounts.reduce((highest, value) => value.minor > highest.minor ? value : highest) : null;
    const coverageTerms = [section('Policies, Coverage and Taxes'), ...cart.map(item => `${text(item.name)}: ${text(carRecord(item.attributes).description)}`)].join(' ');
    const fuel = carRecord(rate.fuel_policy);
    const unknown = 'Supplier did not disclose this amount';
    return validateCarOffer({
      id: createHash('sha256').update(capture.url).digest('hex'), supplier: capture.visibleSupplier, bookingUrl: capture.url, observedAt: capture.observedAt,
      contract: {
        source: 'autoeurope', supplierId: providerId(supplier.id), pickupLocationId: search.pickup.providerIds.autoeurope, dropoffLocationId: search.dropoff.providerIds.autoeurope,
        pickupStationId: providerId(pickup.id), dropoffStationId: providerId(dropoff.id), pickupAt: search.pickupAt, dropoffAt: search.dropoffAt, driver: search.driver, additionalDrivers: [], currency: search.currency,
        vehicleClass: text(vehicle.acriss_code), transmission: text(vehicle.transmission).toLowerCase(), seats: vehicle.seats, model: capture.visibleModel, modelGuaranteed: !/or similar/i.test(capture.visibleModelBasis),
        fuelPolicy: `${text(fuel.name)}: ${text(fuel.description)}`, mileagePolicy: section('Mileage Policy'), cancellationPolicy: cancellation,
        coverageProductIds: [...coverage.map(item => providerId(item.code)), ...extras.map(item => item.productId)], coverageTerms, rentalRequirements: carRequirementTerms(requirements),
        extras: extras.map(({ kind, productId, quantity, category }) => ({ kind, productId, quantity, category })),
      },
      available: proof(rate.on_request === false, rate.on_request === false ? 'Instant quotation, not on request' : 'Rental is on request'),
      requestVerified: proof(true, requestText), driverEligible: proof(search.driver.age >= Number(minAge) && search.driver.age <= Number(maxAge) && search.driver.licenceYears >= Number(licence), driverTerms),
      requirements, requirementsComplete: proof(['Driver Information', 'Payment and Charges', 'Vehicle Pick-up and Return', 'Geographical Restrictions'].every(title => Boolean(section(title))), 'Driver, payment, collection and geographical requirements captured'),
      mandatoryChargesComplete: proof(payLocal.minor === 0 && inclusions.some(item => item.code === 'IN'), section('The Rate Includes')),
      taxesIncluded: proof(inclusions.some(item => item.code === 'IN'), section('The Rate Includes')),
      unlimitedMileage: proof(carRecord(rate.rate_distance).unlimited === true, section('Mileage Policy')),
      freeCancellation: proof(cancellationAvailable, cancellation), total: proof(total, capture.visibleTotal), charges,
      deposit: proof(deposit, depositText || unknown, deposit ? 'estimated' : 'unknown'),
      excess: proof(excess, coverageTerms || unknown, excess ? 'confirmed' : 'unknown'), extras,
    });
  } catch (error) {
    let advertisedTotal: CarEvidence<CarMoney> | null = null;
    try { advertisedTotal = proof(visibleAmount(capture.visibleTotal, search.currency), capture.visibleTotal, 'estimated'); } catch { /* No amount is safer than an inferred one. */ }
    return { source: 'autoeurope', supplier: capture.visibleSupplier || null, model: capture.visibleModel || null, bookingUrl: capture.url, observedAt: capture.observedAt, advertisedTotal, requirements, reasons: [error instanceof Error ? error.message : 'Incomplete provider quote'] };
  }
}

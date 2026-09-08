import { createHash } from 'node:crypto';
import type { DiscoverCarsCapture } from './discovercars-capture';
import { carRecord, carText } from './validation';
import { carProviderUrl, validateCarOffer } from './offer-validation';
import { parseCarMoney, sumCarMoney } from './money';
import { verifyCarProviderContext } from './provider-context';
import { verifyDiscoverCarsLocalTime } from './discovercars-time';
import { discoverCarsFixedDeposit } from './discovercars-deposit';
import { carAddressStationIdentity } from './station-identity';
import { carRequirementTerms } from './requirements';
import { discoverCarsRequestedExtras } from './discovercars-extras';
import type { DiscoverCarsPriceLine } from './discovercars-price-lines';
import { CarError, type CarCandidate, type CarCharge, type CarEvidence, type CarExtraQuote, type CarMoney, type CarOffer, type CarRequirement, type CarSearch } from './types';

const text = (value: unknown) => carText(value, 12000, 'provider field');
function prose(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 12000) throw new CarError(`Invalid ${label}`);
  const normalized = carText(value.replace(/[\r\n\t]/g, ' '), 12000, label).replace(/\s+/g, ' ');
  if (/^\$[0-9a-f]+$/.test(normalized)) throw new CarError(`Unresolved ${label}`);
  return normalized;
}
function rows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.length > 100) throw new CarError('Invalid provider quote list');
  return value.map(carRecord);
}
function money(value: unknown, currency: string): CarMoney {
  const item = carRecord(value);
  if (item.currency !== currency || (typeof item.amount !== 'number' && typeof item.amount !== 'string')) throw new CarError('Provider charge currency is unverified');
  return parseCarMoney(String(item.amount), currency);
}
function visibleMoney(value: string, currency: string): CarMoney {
  const explicitCodes = value.match(/\b[A-Z]{3}\b/g) ?? [];
  if (explicitCodes.some(code => Intl.supportedValuesOf('currency').includes(code) && code !== currency)) throw new CarError('Visible charge shows a different currency');
  const symbol = new Intl.NumberFormat('en-US', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find(part => part.type === 'currency')?.value;
  if ([...value.matchAll(/\p{Sc}/gu)].some(match => !symbol?.includes(match[0]))) throw new CarError('Visible charge symbol disagrees with the selected currency');
  const qualifiedDollars: Record<string, string> = { US: 'USD', CA: 'CAD', A: 'AUD', AU: 'AUD', NZ: 'NZD', HK: 'HKD', S: 'SGD' };
  const prefix = value.match(/\b(US|CA|AU|A|NZ|HK|S)\$/)?.[1];
  if (prefix && qualifiedDollars[prefix] !== currency) throw new CarError('Visible dollar currency disagrees with the selected currency');
  const match = value.trim().match(/([\d,]+(?:\.\d+)?)\s*$/);
  if (!match) throw new CarError('Provider amount was not visible');
  return parseCarMoney(match[1]!.replaceAll(',', ''), currency);
}

export function extractDiscoverCarsOffer(capture: DiscoverCarsCapture, search: CarSearch): CarOffer | CarCandidate {
  carProviderUrl(capture.url, 'discovercars');
  const proof = <T>(value: T | null, body: string, status: CarEvidence<T>['status'] = 'confirmed'): CarEvidence<T> => ({ value, text: body, status, sourceUrl: capture.url, observedAt: capture.observedAt });
  const section = (title: string) => capture.sections.filter(item => item.title === title).map(item => item.text).join(' ').trim();
  const requirements: CarRequirement[] = capture.sections.filter(item => item.text).map(item => ({ kind: item.title === 'payment' ? 'payment_card' : 'other', appliesTo: 'rental', condition: item.title, evidence: proof(item.text, item.text) }));
  try {
    const request = verifyCarProviderContext(capture.url, 'discovercars', search);
    verifyCarProviderContext(capture.currencyContext.sourceUrl, 'discovercars', search);
    if (capture.currencyContext.status !== 'confirmed' || capture.currencyContext.value !== search.currency || !Number.isFinite(Date.parse(capture.currencyContext.observedAt)) || Math.abs(Date.parse(capture.currencyContext.observedAt) - Date.parse(capture.observedAt)) > 300_000) throw new CarError('Selected search currency is not confirmed for this observation');
    const raw = capture.offer, vehicle = carRecord(raw.vehicle), model = carRecord(vehicle.model), specifications = carRecord(vehicle.specifications), supplier = carRecord(raw.supplier);
    const pickup = carRecord(raw.pickup), dropoff = carRecord(raw.dropoff);
    if (raw.offerId !== new URL(capture.url).pathname.split('/').at(-1)) throw new CarError('Rendered quote belongs to another search session');
    if (model.name !== capture.visibleModel || supplier.name !== capture.visibleSupplier || supplier.hiddenPartner !== false) throw new CarError('Visible rental supplier or vehicle disagrees with the quote');
    if (typeof model.exact !== 'boolean' || (model.exact === false && !/or similar/i.test(capture.visibleModelBasis)) || (model.exact === true && (!/\bguaranteed\b/i.test(capture.visibleModelBasis) || /or similar|not guaranteed/i.test(capture.visibleModelBasis)))) throw new CarError('Vehicle model guarantee is unverified');
    if (String(pickup.placeId) !== search.pickup.providerIds.discovercars || String(dropoff.placeId) !== search.dropoff.providerIds.discovercars) throw new CarError('Rendered quote changed the rental locations');
    verifyDiscoverCarsLocalTime(capture.visiblePickup, pickup.datetime, search.pickupAt);
    verifyDiscoverCarsLocalTime(capture.visibleDropoff, dropoff.datetime, search.dropoffAt);
    if (typeof supplier.id !== 'number' || !Number.isSafeInteger(supplier.id) || supplier.id <= 0) throw new CarError('Missing provider supplier identity');
    const supplierId = String(supplier.id);
    for (const [name, stop] of [['Pickup office', pickup], ['Return office', dropoff]] as const) {
      const description = `${prose(stop.address, `${name} address`)}; ${prose(stop.instructions, `${name} instructions`)}; collection service ${String(stop.pickTypeID ?? stop.type)}`;
      requirements.push({ kind: 'other', appliesTo: 'rental', condition: name, evidence: proof(description, description) });
    }
    const driver = section('document');
    const minAge = driver.match(/Minimum rental age is (\d+) years/i)?.[1], maxAge = driver.match(/Maximum rental age is (\d+) years/i)?.[1];
    const noMaximumAge = /There is no maximum age\./i.test(driver);
    const licence = driver.match(/at least (\d+) year\(s\) before/i)?.[1];
    if (maxAge && noMaximumAge) throw new CarError('Supplier maximum age conditions conflict');
    if (!minAge || (!maxAge && !noMaximumAge) || !licence) throw new CarError('Supplier age or licence conditions are incomplete');
    let coverageTerms = section('protection');
    if (search.driver.residenceCountry === 'US' && /USA residents must use their own Third Party Liability and Collision Damage Waiver insurance policies\./i.test(coverageTerms)) throw new CarError('US residents must provide their own liability and collision insurance; coverage eligibility could not be verified');
    if (/need to purchase insurance at the counter/i.test(coverageTerms)) throw new CarError('Required collision or theft cover is not included; own-cover proof or an unpriced counter purchase is required');
    const requestedExtras = discoverCarsRequestedExtras(search), localExtras = capture.localExtras;
    if (requestedExtras.length && (!localExtras || 'error' in localExtras)) throw new CarError(localExtras && 'error' in localExtras ? localExtras.error : 'Requested local extras were not selected in the provider quote');
    if (!requestedExtras.length && localExtras) throw new CarError('Provider captured unrequested local extras');
    if (raw.coverage === null || raw.coverage === undefined) throw new CarError('The provider did not disclose whether optional protection was selected; this quote could not be verified');
    if (carRecord(raw.coverage).isChecked !== false) throw new CarError('Provider protection selection is not verified as unselected');
    if (rows(raw.extras).some(item => item.selectedCount !== 0)) throw new CarError('Provider added an unrequested extra');
    const included = rows(raw.includedOptions);
    if (included.length !== capture.visibleInclusions.length) throw new CarError('Visible included products disagree with the rendered quote');
    const coverageLabels: Record<number, RegExp> = { 34: /collision damage waiver/i, 67: /theft protection/i, 69: /third party liability/i };
    const coverage = included.filter((item, index) => {
      const pattern = typeof item.id === 'number' ? coverageLabels[item.id] : undefined;
      if (pattern && !pattern.test(capture.visibleInclusions[index]!)) throw new CarError('Provider coverage identifier disagrees with its visible label');
      return Boolean(pattern);
    });
    if (!coverage.length || !coverageTerms) throw new CarError('Included coverage cannot be verified');
    const blocks = carRecord(carRecord(raw.priceObject).blocks);
    const charges: CarCharge[] = [];
    for (const [key, payment] of [['payNow', 'now'], ['atPickUp', 'pickup']] as const) {
      const block = carRecord(blocks[key]);
      const items = rows(block.items);
      const amounts = items.map(item => money(carRecord(item.client), search.currency));
      if (sumCarMoney(amounts, search.currency).minor !== money(carRecord(carRecord(block.total).client), search.currency).minor) throw new CarError('Provider payment block does not reconcile');
      items.forEach((item, index) => {
        const line = capture.priceLines[charges.length];
        if (!line || line.payment !== payment || visibleMoney(line.amount, search.currency).minor !== amounts[index]!.minor) throw new CarError('Visible and rendered line-item prices disagree');
        const label = line.label;
        const kind = /young driver/i.test(label) ? 'young_driver' : /one.way/i.test(label) ? 'one_way' : /rental/i.test(label) ? 'rental' : 'other';
        charges.push({ id: `${key}-${text(item.key)}`, label: label.replace(/\s+/g, ' ').trim(), kind, payment, amount: proof(amounts[index]!, label.replace(/\s+/g, ' ').trim()) });
      });
    }
    let total = money(carRecord(carRecord(blocks.total).client), search.currency);
    if (charges.length !== capture.priceLines.length || sumCarMoney(charges.map(item => item.amount.value!), search.currency).minor !== total.minor || visibleMoney(capture.visibleTotal, search.currency).minor !== total.minor) throw new CarError('Visible rental total and charges do not reconcile');
    const extras: CarExtraQuote[] = [];
    const reconcile = (lines: DiscoverCarsPriceLine[], visibleTotal: string) => {
      const key = (payment: string, label: string, minor: number) => JSON.stringify([payment, label.replace(/\s+/g, ' ').trim(), minor]);
      const actual = lines.map(line => key(line.payment, line.label, visibleMoney(line.amount, search.currency).minor)).sort();
      const expected = charges.map(charge => key(charge.payment, charge.label, charge.amount.value!.minor)).sort();
      if (JSON.stringify(actual) !== JSON.stringify(expected) || visibleMoney(visibleTotal, search.currency).minor !== total.minor) throw new CarError('Selected extras and rental total do not reconcile');
    };
    if (localExtras && 'selections' in localExtras) {
      if (localExtras.offerId !== raw.offerId || !Number.isFinite(Date.parse(localExtras.observedAt)) || Math.abs(Date.parse(localExtras.observedAt) - Date.parse(capture.observedAt)) > 300_000 || localExtras.selections.length !== requestedExtras.length) throw new CarError('Local-extra selection does not belong to this quote');
      const terms = prose(localExtras.terms, 'local-extra conditions');
      for (const requested of requestedExtras) {
        const selections = localExtras.selections.filter(item => item.id === requested.id), selection = selections[0];
        const products = rows(raw.extras).filter(item => item.id === requested.id), product = products[0];
        if (selections.length !== 1 || !selection || products.length !== 1 || !product || selection.productId !== product.idWithMap || !selection.productId.startsWith(`${requested.id}_`) || selection.kind !== requested.kind || selection.category !== requested.category || selection.quantity !== requested.quantity || selection.label !== requested.label) throw new CarError('Selected local-extra identities or quantities disagree');
        if (product.payable !== 'atPickUp' || product.freeSelectable !== 0 || typeof product.maxQuantity !== 'number' || !Number.isSafeInteger(product.maxQuantity) || product.maxQuantity < requested.quantity) throw new CarError('Local-extra payment, inclusion or quantity could not be verified');
        const unit = money(product, search.currency);
        if (!selection.visibleUnitPrice.endsWith(' for rental period') || visibleMoney(selection.visibleUnitPrice.replace(/ for rental period$/, ''), search.currency).minor !== unit.minor) throw new CarError('Visible local-extra price disagrees with the rendered product');
        const amount = sumCarMoney(Array.from({ length: requested.quantity }, () => unit), search.currency);
        const id = `local-extra-${selection.productId}`, label = requested.quantity === 1 ? requested.label : `${requested.label} (${requested.quantity})`;
        charges.push({ id, label, kind: 'extra', payment: 'pickup', amount: proof(amount, `${label}. ${terms}`, 'estimated') });
        extras.push({ kind: requested.kind, category: requested.category, quantity: requested.quantity, productId: selection.productId,
          availability: proof<boolean>(null, terms, 'unknown'), eligibility: proof<boolean>(null, requested.kind === 'additional_driver' ? 'Additional-driver eligibility and possible age-related charges require supplier confirmation.' : `${requested.label}; suitability and availability require supplier confirmation.`, 'unknown'),
          included: proof(false, selection.visibleUnitPrice), chargeId: id });
      }
      total = sumCarMoney(charges.map(charge => charge.amount.value!), search.currency);
      reconcile(localExtras.priceLines, localExtras.visibleTotal);
      requirements.push({ kind: 'other', appliesTo: 'rental', condition: 'Selected local extras', evidence: proof(terms, terms) });
    }
    const selected = search.extras.protection.find(item => item.source === 'discovercars');
    const protection = capture.protection;
    if (Boolean(selected) !== Boolean(protection)) throw new CarError('Selected protection was added or omitted');
    if (protection) {
      if (protection.offerId !== raw.offerId || protection.productId !== selected?.productId || protection.selected !== true || !Number.isFinite(Date.parse(protection.observedAt)) || Math.abs(Date.parse(protection.observedAt) - Date.parse(capture.observedAt)) > 300_000) throw new CarError('Protection selection does not belong to this quote');
      const rate = carRecord(protection.price);
      const amount = money({ amount: rate.period, currency: rate.currency }, search.currency);
      charges.push({ id: `protection-${protection.productId}`, label: protection.name, kind: 'extra', payment: 'now', amount: proof(amount, `${protection.name}: ${amount.minor} minor ${search.currency} for the entire rental`) });
      total = sumCarMoney(charges.map(charge => charge.amount.value!), search.currency);
      reconcile(protection.priceLines, protection.visibleTotal);
      coverageTerms += ` ${text(protection.terms)}`;
      extras.push({ kind: 'protection', productId: protection.productId, category: null, quantity: 1, availability: proof(true, protection.name), eligibility: proof(true, protection.terms), included: proof(false, protection.name), chargeId: `protection-${protection.productId}` });
    }
    const includedTerms = section('rate-includes');
    const inclusionEntries = includedTerms.split(',').map(entry => entry.trim());
    const mileageTerms = [section('mileage'), section('mileage-policy')].filter(Boolean).join(' ');
    const conditionalMileage = /\b(?:limited|not unlimited|limit of|allowance|per (?:day|rental)|up to \d+)\b/i.test(mileageTerms);
    const taxesIncluded = inclusionEntries.some(entry => /^(?:State Tax|VAT(?: \(value added tax\))?|Taxes(?: & Fees)?)$/i.test(entry));
    const mandatoryIncluded = inclusionEntries.some(entry => /^(?:Surcharges|Airport surcharge|Premium Location fee)$/i.test(entry));
    const contradictoryFees = /not included|excluded|payable locally|additional (?:fee|charge)/i.test(includedTerms);
    const cancellation = includedTerms.match(/Free cancellation with a full refund up to (\d+) hours before your pick-up time/i);
    if (!cancellation) throw new CarError('Cancellation conditions are not verified');
    const deposit = discoverCarsFixedDeposit(raw.deposit);
    const collision = included.find(item => item.id === 34);
    const excess = collision ? discoverCarsFixedDeposit(collision.params) : null;
    return validateCarOffer({
      id: createHash('sha256').update(capture.url).digest('hex'), supplier: capture.visibleSupplier, bookingUrl: capture.url, observedAt: capture.observedAt,
      contract: {
        source: 'discovercars', supplierId, pickupLocationId: String(pickup.placeId), dropoffLocationId: String(dropoff.placeId),
        pickupStationId: carAddressStationIdentity('discovercars', supplierId, String(pickup.placeId), prose(pickup.address, 'Pickup office address')), dropoffStationId: carAddressStationIdentity('discovercars', supplierId, String(dropoff.placeId), prose(dropoff.address, 'Return office address')),
        pickupAt: search.pickupAt, dropoffAt: search.dropoffAt, driver: search.driver, additionalDrivers: search.extras.additionalDrivers, currency: search.currency,
        vehicleClass: text(model.sipp), transmission: specifications.isAutomatic === true ? 'automatic' : specifications.isAutomatic === false ? 'manual' : 'unknown', seats: specifications.seats, model: capture.visibleModel, modelGuaranteed: model.exact,
        fuelPolicy: text(vehicle.fuelPolicy), mileagePolicy: mileageTerms, cancellationPolicy: cancellation[0], coverageProductIds: [...coverage.map(item => `included:${String(item.id)}`), ...extras.filter(extra => extra.kind === 'protection').map(extra => extra.productId)], coverageTerms, rentalRequirements: carRequirementTerms(requirements), extras: extras.map(({ kind, productId, category, quantity }) => ({ kind, productId, category, quantity })),
      },
      available: proof(capture.selectable === true, 'Provider rendered a selectable current rental quote'), requestVerified: proof(true, request),
      driverEligible: proof(search.driver.age >= Number(minAge) && (noMaximumAge || search.driver.age <= Number(maxAge)) && search.driver.licenceYears >= Number(licence), driver),
      requirements, requirementsComplete: proof(['document', 'payment', 'waiting-period', 'cross-border'].every(title => Boolean(section(title))), 'Driver, payment, collection and geographical conditions captured'),
      mandatoryChargesComplete: proof(taxesIncluded && mandatoryIncluded && !contradictoryFees, includedTerms), taxesIncluded: proof(taxesIncluded && !contradictoryFees, includedTerms),
      unlimitedMileage: proof<boolean>(conditionalMileage ? null : inclusionEntries.some(entry => /^Unlimited mileage$/i.test(entry)), mileageTerms, conditionalMileage ? 'unknown' : 'confirmed'),
      freeCancellation: proof(Date.parse(capture.observedAt) < Date.parse(search.pickupAt.instant) - Number(cancellation[1]) * 3_600_000, cancellation[0]),
      total: proof(total, (protection?.visibleTotal ?? (localExtras && 'selections' in localExtras ? localExtras.visibleTotal : capture.visibleTotal)).replace(/\s+/g, ' ').trim(), requestedExtras.length ? 'estimated' : 'confirmed'), charges,
      deposit: proof(deposit, section('deposit') || 'Supplier did not disclose a deposit', deposit ? 'estimated' : 'unknown'),
      excess: proof(excess, coverageTerms, excess ? 'estimated' : 'unknown'), extras,
    });
  } catch (error) {
    let advertisedTotal: CarEvidence<CarMoney> | null = null;
    try { advertisedTotal = proof(visibleMoney(capture.visibleTotal, search.currency), capture.visibleTotal.replace(/\s+/g, ' ').trim(), 'estimated'); } catch { /* No inferred price. */ }
    return { source: 'discovercars', supplier: capture.visibleSupplier || null, model: capture.visibleModel || null, bookingUrl: capture.url, observedAt: capture.observedAt, advertisedTotal, requirements, reasons: [error instanceof Error ? error.message : 'Incomplete provider rental quote'] };
  }
}

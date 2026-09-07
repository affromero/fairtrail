import { CAR_SOURCES, CAR_REQUIREMENT_KINDS, CHILD_SEAT_CATEGORIES, CarError, type CarCharge, type CarContract, type CarEvidence, type CarExtraQuote, type CarOffer, type CarRequirement, type CarSource } from './types';
import { carInteger, carRecord, carText, resolveCarLocalTime, validateCarDriver } from './validation';
import { currencyPrecision, validateCarMoney } from './money';
import { carRequirementTerms } from './requirements';

const PROVIDER_HOSTS: Record<CarSource, string> = { discovercars: 'www.discovercars.com', autoeurope: 'book.autoeurope.com' };
export function carProviderUrl(raw: unknown, source: CarSource): string {
  const text = carText(raw, 16000, 'provider URL');
  let url: URL;
  try { url = new URL(text); } catch { throw new CarError('Invalid provider URL'); }
  if (url.protocol !== 'https:' || url.hostname !== PROVIDER_HOSTS[source] || url.port || url.username || url.password) throw new CarError('Evidence and booking links must belong to the selected provider');
  return url.href;
}
function boolean(raw: unknown): boolean {
  if (typeof raw !== 'boolean') throw new CarError('Expected a verified boolean');
  return raw;
}
function list(raw: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(raw) || raw.length > max) throw new CarError(`Invalid ${label}`);
  return raw;
}
function timestamp(raw: unknown, now: Date): string {
  const text = carText(raw, 30, 'observation time');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text) || !Number.isFinite(Date.parse(text)) || Date.parse(text) > now.getTime() + 5000) throw new CarError('Invalid or future observation time');
  const canonical = new Date(text).toISOString();
  if (canonical !== text && canonical.replace('.000Z', 'Z') !== text) throw new CarError('Invalid observation calendar date');
  return canonical;
}
function evidence<T>(raw: unknown, source: CarSource, observedAt: string, parse: (value: unknown) => T): CarEvidence<T> {
  const r = carRecord(raw);
  if (r.status !== 'confirmed' && r.status !== 'estimated' && r.status !== 'unknown') throw new CarError('Invalid evidence status');
  const captured = timestamp(r.observedAt, new Date(observedAt));
  if (Math.abs(Date.parse(captured) - Date.parse(observedAt)) > 5 * 60_000) throw new CarError('Evidence belongs to a different observation');
  if (r.value === undefined || (r.status === 'confirmed' && r.value === null)) throw new CarError('Missing evidence value');
  return { value: r.value === null ? null : parse(r.value), status: r.status, text: carText(r.text, 12000, 'evidence text'), sourceUrl: carProviderUrl(r.sourceUrl, source), observedAt: captured };
}
function extraIdentity(raw: unknown): CarContract['extras'][number] {
  const r = carRecord(raw);
  if (r.kind !== 'child_seat' && r.kind !== 'additional_driver' && r.kind !== 'protection') throw new CarError('Unknown extra kind');
  const category = r.category === null ? null : CHILD_SEAT_CATEGORIES.find(c => c === r.category);
  if (category === undefined || (r.kind === 'child_seat') !== (category !== null)) throw new CarError('Extra has an invalid seat category');
  return { kind: r.kind, productId: carText(r.productId, 200, 'extra product'), quantity: carInteger(r.quantity, 1, r.kind === 'protection' ? 1 : 4, 'Extra quantity'), category };
}
export function validateCarContract(raw: unknown): CarContract {
  const r = carRecord(raw);
  const source = CAR_SOURCES.find(s => s === r.source);
  if (!source) throw new CarError('Unsupported car provider');
  const currency = carText(r.currency, 3, 'currency');
  currencyPrecision(currency);
  if (r.transmission !== 'automatic' && r.transmission !== 'manual') throw new CarError('Unknown vehicle transmission');
  const pickupAt = resolveCarLocalTime(r.pickupAt), dropoffAt = resolveCarLocalTime(r.dropoffAt);
  if (carRecord(r.pickupAt).instant !== pickupAt.instant || carRecord(r.dropoffAt).instant !== dropoffAt.instant || Date.parse(dropoffAt.instant) <= Date.parse(pickupAt.instant)) throw new CarError('Contract times do not match their station-local instants');
  const coverageProductIds = list(r.coverageProductIds, 20, 'coverage products').map(p => carText(p, 200, 'coverage product'));
  if (!coverageProductIds.length || new Set(coverageProductIds).size !== coverageProductIds.length) throw new CarError('Missing or duplicate coverage products');
  return {
    source, supplierId: carText(r.supplierId, 200, 'supplier ID'),
    pickupLocationId: carText(r.pickupLocationId, 200, 'pickup location ID'), dropoffLocationId: carText(r.dropoffLocationId, 200, 'return location ID'),
    pickupStationId: carText(r.pickupStationId, 200, 'pickup station ID'), dropoffStationId: carText(r.dropoffStationId, 200, 'return station ID'),
    pickupAt, dropoffAt, driver: validateCarDriver(r.driver), additionalDrivers: list(r.additionalDrivers, 4, 'additional drivers').map(validateCarDriver), currency,
    vehicleClass: carText(r.vehicleClass, 100, 'vehicle class'), transmission: r.transmission, seats: carInteger(r.seats, 2, 9, 'Vehicle seats'),
    model: carText(r.model, 200, 'vehicle model'), modelGuaranteed: boolean(r.modelGuaranteed), fuelPolicy: carText(r.fuelPolicy, 500, 'fuel policy'),
    mileagePolicy: carText(r.mileagePolicy, 500, 'mileage policy'), cancellationPolicy: carText(r.cancellationPolicy, 500, 'cancellation policy'),
    coverageProductIds, coverageTerms: carText(r.coverageTerms, 12000, 'coverage terms'), rentalRequirements: carText(r.rentalRequirements, 100000, 'rental requirements'), extras: list(r.extras, 8, 'contract extras').map(extraIdentity),
  };
}
export function validateCarOffer(raw: unknown, now = new Date()): CarOffer {
  const r = carRecord(raw);
  const contract = validateCarContract(r.contract);
  const observedAt = timestamp(r.observedAt, now);
  const proof = <T>(value: unknown, parse: (value: unknown) => T) => evidence(value, contract.source, observedAt, parse);
  const monetary = (value: unknown) => validateCarMoney(value);
  const charges: CarCharge[] = list(r.charges, 100, 'price breakdown').map(rawCharge => {
    const c = carRecord(rawCharge);
    const kind = (['rental', 'tax', 'one_way', 'young_driver', 'extra', 'other'] as const).find(k => k === c.kind);
    if (!kind || (c.payment !== 'now' && c.payment !== 'pickup')) throw new CarError('Invalid rental charge');
    return { id: carText(c.id, 200, 'charge ID'), label: carText(c.label, 200, 'charge label'), kind, payment: c.payment, amount: proof(c.amount, monetary) };
  });
  const extras: CarExtraQuote[] = list(r.extras, 8, 'quoted extras').map(rawExtra => {
    const e = carRecord(rawExtra);
    return { ...extraIdentity(e), availability: proof(e.availability, boolean), eligibility: proof(e.eligibility, boolean), included: proof(e.included, boolean), chargeId: e.chargeId === null ? null : carText(e.chargeId, 200, 'extra charge ID') };
  });
  const identities = (items: CarContract['extras']) => items.map(e => JSON.stringify([e.kind, e.productId, e.category, e.quantity])).sort();
  const quotedIdentities = identities(extras);
  if (new Set(quotedIdentities).size !== quotedIdentities.length || JSON.stringify(identities(contract.extras)) !== JSON.stringify(quotedIdentities)) throw new CarError('Quoted extras disagree with the rental contract');
  if (extras.some(e => e.kind === 'protection' && !contract.coverageProductIds.includes(e.productId))) throw new CarError('Quoted protection disagrees with contract coverage');
  const requirements: CarRequirement[] = list(r.requirements, 30, 'supplier requirements').map(rawRequirement => {
    const item = carRecord(rawRequirement);
    const kind = CAR_REQUIREMENT_KINDS.find(value => value === item.kind);
    if (!kind || (item.appliesTo !== 'main_driver' && item.appliesTo !== 'all_drivers' && item.appliesTo !== 'rental')) throw new CarError('Invalid supplier requirement');
    return { kind, appliesTo: item.appliesTo, condition: carText(item.condition, 1000, 'requirement applicability'), evidence: proof(item.evidence, value => carText(value, 12000, 'supplier requirement')) };
  });
  if (contract.rentalRequirements !== carRequirementTerms(requirements)) throw new CarError('Supplier requirements disagree with the rental contract');
  return {
    id: carText(r.id, 200, 'offer ID'), supplier: carText(r.supplier, 200, 'supplier'), contract, bookingUrl: carProviderUrl(r.bookingUrl, contract.source), observedAt,
    available: proof(r.available, boolean), requestVerified: proof(r.requestVerified, boolean), driverEligible: proof(r.driverEligible, boolean),
    requirements, requirementsComplete: proof(r.requirementsComplete, boolean),
    mandatoryChargesComplete: proof(r.mandatoryChargesComplete, boolean), taxesIncluded: proof(r.taxesIncluded, boolean),
    unlimitedMileage: proof(r.unlimitedMileage, boolean), freeCancellation: proof(r.freeCancellation, boolean),
    total: proof(r.total, monetary), charges, deposit: proof(r.deposit, monetary), excess: proof(r.excess, monetary), extras,
  };
}

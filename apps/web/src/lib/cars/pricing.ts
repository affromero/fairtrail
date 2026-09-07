import { CarError, type CarEvidence, type CarMoney, type CarOffer, type CarSearch } from './types';
import { carContractMatchesSearch } from './identity';
import { sumCarMoney, validateCarMoney } from './money';
import { validateCarOffer } from './offer-validation';
function confirmedCarEvidence<T>(evidence: CarEvidence<T>): evidence is CarEvidence<T> & { value: T } {
  if (!evidence || evidence.status !== 'confirmed' || evidence.value == null || typeof evidence.text !== 'string' || !evidence.text.trim() || !Number.isFinite(Date.parse(evidence.observedAt))) return false;
  try {
    const url = new URL(evidence.sourceUrl);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port;
  } catch { return false; }
}
export interface CarPriceAssessment {
  eligible: boolean;
  reasons: string[];
  total: CarMoney | null;
  payNow: CarMoney | null;
  payAtPickup: CarMoney | null;
}
export const MAX_CAR_OFFER_AGE_MS = 15 * 60_000;
export function assessCarPrice(raw: unknown, search: CarSearch, now = new Date()): CarPriceAssessment {
  let offer: CarOffer;
  try { offer = validateCarOffer(raw, now); }
  catch (error) { return { eligible: false, reasons: [error instanceof Error ? error.message : 'Invalid provider offer'], total: null, payNow: null, payAtPickup: null }; }
  const reasons: string[] = [];
  if (now.getTime() - Date.parse(offer.observedAt) > MAX_CAR_OFFER_AGE_MS) reasons.push('Rental quote has expired; refresh before updating prices or alerts');
  if (!carContractMatchesSearch(offer.contract, search)) reasons.push('Rental contract does not match the requested locations, times or driver details');
  for (const [name, evidence] of [
    ['availability', offer.available], ['search details', offer.requestVerified],
    ['driver age and licence eligibility', offer.driverEligible], ['supplier requirements', offer.requirementsComplete], ['mandatory fees', offer.mandatoryChargesComplete],
    ['included taxes', offer.taxesIncluded],
  ] as const) {
    if (!confirmedCarEvidence(evidence) || evidence.value !== true) reasons.push(`Unconfirmed ${name}`);
  }
  if (offer.requirements.some(requirement => !confirmedCarEvidence(requirement.evidence))) reasons.push('Supplier rental conditions could not be verified');
  let total: CarMoney | null = null, payNow: CarMoney | null = null, payAtPickup: CarMoney | null = null;
  try {
    if (!confirmedCarEvidence(offer.total)) throw new CarError('Unconfirmed rental total');
    total = validateCarMoney(offer.total.value, search.currency);
    if (total.minor === 0) throw new CarError('Rental total must be positive');
    if (!offer.charges.length || new Set(offer.charges.map(c => c.id)).size !== offer.charges.length) throw new CarError('Missing or duplicate charge items');
    const amounts = offer.charges.map(charge => {
      if (!confirmedCarEvidence(charge.amount)) throw new CarError(`Unconfirmed charge: ${charge.label}`);
      if (charge.payment !== 'now' && charge.payment !== 'pickup') throw new CarError('Unknown payment timing');
      return validateCarMoney(charge.amount.value, search.currency);
    });
    if (sumCarMoney(amounts, search.currency).minor !== total.minor) throw new CarError('Itemized charges do not reconcile with the total');
    payNow = sumCarMoney(amounts.filter((_, i) => offer.charges[i]!.payment === 'now'), search.currency);
    payAtPickup = sumCarMoney(amounts.filter((_, i) => offer.charges[i]!.payment === 'pickup'), search.currency);
  } catch (error) { reasons.push(error instanceof Error ? error.message : 'Invalid price'); }

  const requested = [
    ...search.extras.childSeats.map(seat => ({ kind: 'child_seat', category: seat.category, quantity: seat.quantity, productId: null })),
    ...(search.extras.additionalDrivers.length ? [{ kind: 'additional_driver', category: null, quantity: search.extras.additionalDrivers.length, productId: null }] : []),
    ...search.extras.protection.filter(p => p.source === offer.contract.source).map(p => ({ kind: 'protection', category: null, quantity: 1, productId: p.productId })),
  ];
  const usedChargeIds = new Set<string>();
  for (const extra of requested) {
    const matches = offer.extras.filter(e => e.kind === extra.kind && e.category === extra.category && (extra.productId === null || e.productId === extra.productId));
    const match = matches[0];
    if (matches.length !== 1 || !match || match.quantity !== extra.quantity || !confirmedCarEvidence(match.availability) || match.availability.value !== true || !confirmedCarEvidence(match.eligibility) || match.eligibility.value !== true) {
      reasons.push(`Unconfirmed requested extra: ${extra.category ?? extra.kind}`);
      continue;
    }
    if (!confirmedCarEvidence(match.included)) {
      reasons.push(`Unconfirmed extra inclusion: ${match.productId}`);
      continue;
    }
    if (match.included.value) {
      if (match.chargeId !== null) reasons.push('Included extra must not have a separate charge');
      continue;
    }
    const charge = offer.charges.find(c => c.id === match.chargeId && c.kind === 'extra');
    if (!charge || usedChargeIds.has(charge.id)) reasons.push(`Missing or duplicated extra charge: ${match.productId}`);
    else usedChargeIds.add(charge.id);
  }
  if (search.filters.unlimitedMileage && (!confirmedCarEvidence(offer.unlimitedMileage) || offer.unlimitedMileage.value !== true)) reasons.push('Unlimited mileage is not confirmed');
  if (search.filters.freeCancellation && (!confirmedCarEvidence(offer.freeCancellation) || offer.freeCancellation.value !== true)) reasons.push('Free cancellation is not confirmed');
  if (search.filters.transmission !== 'any' && offer.contract.transmission !== search.filters.transmission) reasons.push('Transmission does not match');
  if (offer.contract.seats < search.filters.minSeats) reasons.push('Too few seats');
  if (total && search.filters.maxTotal && total.minor > search.filters.maxTotal.minor) reasons.push('Above the requested budget');
  return { eligible: reasons.length === 0, reasons, total, payNow, payAtPickup };
}

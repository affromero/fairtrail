import { validateCarSearch } from '../lib/cars/validation';
import type { CarEvidence, CarOffer, CarSearchReport, CarSource } from '../lib/cars/types';

const location = { name: 'Example Airport', country: 'GB', timeZone: 'Europe/London', providerIds: { discovercars: '1712', autoeurope: '547' } };
export function carSearchFixture() {
  const pickup = new Date(); pickup.setUTCMonth(pickup.getUTCMonth() + 2, 15);
  const dropoff = new Date(pickup); dropoff.setUTCDate(dropoff.getUTCDate() + 3);
  return validateCarSearch({ pickup: location, dropoff: location, pickupAt: { date: pickup.toISOString().slice(0, 10), time: '11:00' }, dropoffAt: { date: dropoff.toISOString().slice(0, 10), time: '11:00' }, driver: { age: 35, licenceYears: 2, residenceCountry: 'GB' }, currency: 'GBP', sources: ['discovercars', 'autoeurope'], filters: { maxTotal: { currency: 'GBP', minor: 15000 } } });
}
export function carOfferFixture(observedAt = new Date().toISOString(), minor = 10000): CarOffer {
  const search = carSearchFixture();
  const evidence = <T>(value: T): CarEvidence<T> => ({ value, status: 'confirmed', text: 'Verified provider terms', sourceUrl: 'https://www.discovercars.com/offer/example', observedAt });
  return {
    id: 'verified-quote', supplier: 'Example supplier', bookingUrl: 'https://www.discovercars.com/offer/example', observedAt,
    contract: { source: 'discovercars', supplierId: '320', pickupLocationId: '1712', dropoffLocationId: '1712', pickupStationId: 'station-1', dropoffStationId: 'station-1', pickupAt: search.pickupAt, dropoffAt: search.dropoffAt, driver: search.driver, additionalDrivers: [], currency: 'GBP', vehicleClass: 'CDAR', transmission: 'automatic', seats: 5, model: 'Example car', modelGuaranteed: false, fuelPolicy: 'Full to full', mileagePolicy: 'Unlimited', cancellationPolicy: 'Free until 48 hours before pickup', coverageProductIds: ['cdw'], coverageTerms: 'Collision cover with excess', rentalRequirements: '[]', extras: [] },
    available: evidence(true), requestVerified: evidence(true), driverEligible: evidence(true), requirements: [], requirementsComplete: evidence(true), mandatoryChargesComplete: evidence(true), taxesIncluded: evidence(true), unlimitedMileage: evidence(true), freeCancellation: evidence(true),
    total: evidence({ currency: 'GBP', minor }), charges: [{ id: 'rental', label: 'Rental including taxes', kind: 'rental', payment: 'now', amount: evidence({ currency: 'GBP', minor }) }],
    deposit: { ...evidence(null), status: 'unknown' }, excess: { ...evidence(null), status: 'unknown' }, extras: [],
  };
}
export function carReportFixture(offers = [carOfferFixture()], sources: CarSource[] = ['discovercars', 'autoeurope']): CarSearchReport {
  return { scope: 'checked_provider_offers', offers, candidates: [], errors: [], completed: sources.length, total: sources.length, successfulProviders: sources.length, providers: sources.map(source => ({ source, status: 'complete', checked: offers.filter(offer => offer.contract.source === source).length, discoveredVisible: offers.filter(offer => offer.contract.source === source).length, limit: 8, truncated: false })) };
}
export function carTrackerViewFixture() {
  const now = new Date().toISOString();
  return { id: 'tracker-one', userId: 'alice', label: 'London weekend', search: carSearchFixture(), selection: null,
    options: { mode: 'best' as const, target: null, notifyLows: true, scrapeInterval: 3 }, active: true, revision: 0,
    latestPriceMinor: 10000, historicalLowMinor: 9000, currency: 'GBP', createdAt: now, updatedAt: now, lastCheckedAt: now, nextCheckAt: now, lastError: null };
}

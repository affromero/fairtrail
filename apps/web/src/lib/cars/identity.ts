import type { CarContract, CarDriver, CarLocalTime, CarSearch } from './types';
import { validateCarContract } from './offer-validation';

const driverKey = (driver: CarDriver) => [driver.age, driver.licenceYears, driver.residenceCountry];
const timeKey = (time: CarLocalTime) => [time.date, time.time, time.timeZone, time.instant];
const sortedDrivers = (drivers: CarDriver[]) => drivers.map(driverKey).map(d => JSON.stringify(d)).sort();

/** Versioned value identity, not a session-dependent booking URL or quote ID. */
export function carContractIdentity(raw: unknown): string {
  const contract = validateCarContract(raw);
  return JSON.stringify([
    'car-contract-v1', contract.source, contract.supplierId, contract.pickupLocationId, contract.dropoffLocationId, contract.pickupStationId, contract.dropoffStationId,
    timeKey(contract.pickupAt), timeKey(contract.dropoffAt), driverKey(contract.driver), sortedDrivers(contract.additionalDrivers),
    contract.currency, contract.vehicleClass, contract.transmission, contract.seats,
    contract.modelGuaranteed, contract.modelGuaranteed ? contract.model : null,
    contract.fuelPolicy, contract.mileagePolicy, contract.cancellationPolicy,
    [...contract.coverageProductIds].sort(), contract.coverageTerms,
    contract.extras.map(e => JSON.stringify([e.kind, e.productId, e.category, e.quantity])).sort(),
  ]);
}
export function carContractMatchesSearch(contract: CarContract, search: CarSearch): boolean {
  return search.sources.includes(contract.source)
    && contract.pickupLocationId === search.pickup.providerIds[contract.source]
    && contract.dropoffLocationId === search.dropoff.providerIds[contract.source]
    && JSON.stringify(timeKey(contract.pickupAt)) === JSON.stringify(timeKey(search.pickupAt))
    && JSON.stringify(timeKey(contract.dropoffAt)) === JSON.stringify(timeKey(search.dropoffAt))
    && JSON.stringify(driverKey(contract.driver)) === JSON.stringify(driverKey(search.driver))
    && JSON.stringify(sortedDrivers(contract.additionalDrivers)) === JSON.stringify(sortedDrivers(search.extras.additionalDrivers))
    && contract.currency === search.currency;
}

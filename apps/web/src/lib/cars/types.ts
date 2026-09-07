export const CAR_SOURCES = ['discovercars', 'autoeurope'] as const;
export type CarSource = typeof CAR_SOURCES[number];
export const CHILD_SEAT_CATEGORIES = ['infant', 'child', 'booster'] as const;
export type ChildSeatCategory = typeof CHILD_SEAT_CATEGORIES[number];

export class CarError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = 'CarError';
  }
}

export interface CarMoney { currency: string; minor: number }
export interface CarLocalTime { date: string; time: string; timeZone: string; instant: string }
export interface CarLocation {
  name: string;
  country: string;
  timeZone: string;
  providerIds: Partial<Record<CarSource, string>>;
}
export interface CarDriver { age: number; licenceYears: number; residenceCountry: string }
export interface CarExtras {
  childSeats: { category: ChildSeatCategory; quantity: number }[];
  additionalDrivers: CarDriver[];
  protection: { source: CarSource; productId: string }[];
}
export interface CarSearch {
  pickup: CarLocation;
  dropoff: CarLocation;
  pickupAt: CarLocalTime;
  dropoffAt: CarLocalTime;
  driver: CarDriver;
  currency: string;
  sources: CarSource[];
  extras: CarExtras;
  filters: {
    transmission: 'any' | 'automatic' | 'manual';
    minSeats: number;
    unlimitedMileage: boolean;
    freeCancellation: boolean;
    maxTotal: CarMoney | null;
  };
}

/** Each assertion carries its own provenance; one verified field cannot verify another. */
export interface CarEvidence<T> {
  value: T | null;
  status: 'confirmed' | 'estimated' | 'unknown';
  text: string;
  sourceUrl: string;
  observedAt: string;
}
export interface CarCharge {
  id: string;
  label: string;
  kind: 'rental' | 'tax' | 'one_way' | 'young_driver' | 'extra' | 'other';
  payment: 'now' | 'pickup';
  amount: CarEvidence<CarMoney>;
}
export interface CarExtraQuote {
  kind: 'child_seat' | 'additional_driver' | 'protection';
  productId: string;
  category: ChildSeatCategory | null;
  quantity: number;
  availability: CarEvidence<boolean>;
  eligibility: CarEvidence<boolean>;
  // Included extras have no separate charge. Charged extras reference the one
  // payable line item which already includes their complete requested quantity.
  included: CarEvidence<boolean>;
  chargeId: string | null;
}
export const CAR_REQUIREMENT_KINDS = ['flight_ticket', 'physical_licence', 'international_permit', 'payment_card', 'address_proof', 'additional_driver', 'other'] as const;
export interface CarRequirement {
  kind: typeof CAR_REQUIREMENT_KINDS[number];
  appliesTo: 'main_driver' | 'all_drivers' | 'rental';
  condition: string;
  evidence: CarEvidence<string>;
}
export interface CarContract {
  source: CarSource;
  supplierId: string;
  pickupLocationId: string;
  dropoffLocationId: string;
  pickupStationId: string;
  dropoffStationId: string;
  pickupAt: CarLocalTime;
  dropoffAt: CarLocalTime;
  driver: CarDriver;
  additionalDrivers: CarDriver[];
  currency: string;
  vehicleClass: string;
  transmission: 'automatic' | 'manual';
  seats: number;
  model: string;
  modelGuaranteed: boolean;
  fuelPolicy: string;
  mileagePolicy: string;
  cancellationPolicy: string;
  coverageProductIds: string[];
  coverageTerms: string;
  rentalRequirements: string;
  extras: { kind: CarExtraQuote['kind']; productId: string; quantity: number; category: ChildSeatCategory | null }[];
}
export interface CarOffer {
  id: string;
  supplier: string;
  contract: CarContract;
  bookingUrl: string;
  observedAt: string;
  available: CarEvidence<boolean>;
  requestVerified: CarEvidence<boolean>;
  /** Age/licence tenure only; documents and supplier restrictions remain separate. */
  driverEligible: CarEvidence<boolean>;
  requirements: CarRequirement[];
  requirementsComplete: CarEvidence<boolean>;
  mandatoryChargesComplete: CarEvidence<boolean>;
  taxesIncluded: CarEvidence<boolean>;
  unlimitedMileage: CarEvidence<boolean>;
  freeCancellation: CarEvidence<boolean>;
  total: CarEvidence<CarMoney>;
  charges: CarCharge[];
  deposit: CarEvidence<CarMoney>;
  excess: CarEvidence<CarMoney>;
  extras: CarExtraQuote[];
}
/** Partial observations are displayable but never valid contracts or alert prices. */
export interface CarCandidate {
  source: CarSource;
  supplier: string | null;
  model: string | null;
  bookingUrl: string;
  observedAt: string;
  advertisedTotal: CarEvidence<CarMoney> | null;
  requirements: CarRequirement[];
  reasons: string[];
}
export interface CarSearchResult {
  offers: CarOffer[];
  candidates: CarCandidate[];
  errors: { source: CarSource; message: string }[];
  completed: number;
  total: number;
}
export interface CarTrackingOptions {
  mode: 'best' | 'contract';
  target: CarMoney | null;
  notifyLows: boolean;
  scrapeInterval: number;
}

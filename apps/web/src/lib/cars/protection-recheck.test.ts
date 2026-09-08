import { describe, expect, it } from 'vitest';
import { carOfferFixture, carSearchFixture } from '@/test/car-fixtures';
import { assertCarProtectionRecheck } from './protection-recheck';
import { carContractHash, carTrackerSearch } from './selection';
import { validateCarSearch } from './validation';
import { normalizeCarSearchInput } from './public-input';
import type { CarContract, CarSource } from './types';

function fixture(source: CarSource = 'discovercars') {
  const base = carOfferFixture(); base.contract.source = source;
  const productId = source === 'discovercars' ? '35' : 'ZC.GBP';
  const search = validateCarSearch({ ...carSearchFixture(), sources: [source],
    extras: { childSeats: [], additionalDrivers: [], protection: [{ source, productId }] },
    protectionRecheck: { searchId: 'original', offerId: base.id, choiceId: 'c51f31ce-1f53-486b-b84c-2817429f3a73',
      baseContractHash: carContractHash(base.contract), baseCoverageTerms: base.contract.coverageTerms } });
  const offer = structuredClone(base);
  const identity = { kind: 'protection' as const, productId, category: null, quantity: 1 };
  offer.extras.push({ ...identity, availability: { ...base.available, text: 'Full Coverage' },
    eligibility: { ...base.driverEligible, text: 'Reimbursement subject to exclusions.' }, included: { ...base.available, value: false }, chargeId: 'protection' });
  offer.contract.extras.push(identity);
  offer.contract.coverageProductIds.push(productId);
  offer.contract.coverageTerms += ` ${source === 'autoeurope' ? 'Full Coverage: ' : ''}Reimbursement subject to exclusions.`;
  return { search, offer };
}

describe('protected quotes preserve the selected base rental', () => {
  it.each(['discovercars', 'autoeurope'] as const)('accepts only the exact %s coverage composition and retains newly observed terms', source => {
    const { search, offer } = fixture(source);
    expect(() => assertCarProtectionRecheck(offer, search)).not.toThrow();
    offer.extras[0]!.eligibility.text = 'Updated reimbursement exclusions.';
    offer.contract.coverageTerms = `${search.protectionRecheck!.baseCoverageTerms} ${source === 'autoeurope' ? 'Full Coverage: ' : ''}Updated reimbursement exclusions.`;
    expect(() => assertCarProtectionRecheck(offer, search)).not.toThrow();
    expect(offer.contract.coverageTerms).toContain('Updated reimbursement exclusions');
  });
  it('rejects changed base terms sharing the saved prefix', () => {
    const { search, offer } = fixture();
    offer.contract.coverageTerms = `${search.protectionRecheck!.baseCoverageTerms} NEW exclusion. ${offer.extras[0]!.eligibility.text}`;
    expect(() => assertCarProtectionRecheck(offer, search)).toThrow(/coverage changed/);
  });
  it.each<[keyof CarContract, string]>([
    ['supplierId', 'other'], ['pickupStationId', 'other'], ['dropoffStationId', 'other'],
    ['fuelPolicy', 'Prepaid fuel'], ['mileagePolicy', 'Limited'], ['cancellationPolicy', 'Nonrefundable'],
    ['rentalRequirements', '["Additional mandatory licence"]'], ['vehicleClass', 'OTHER'],
  ])('rejects a substituted %s despite the selected product still being present', (field, value) => {
    const { search, offer } = fixture();
    Object.assign(offer.contract, { [field]: value });
    expect(() => assertCarProtectionRecheck(offer, search)).toThrow(/base rental changed/);
  });
  it('rejects changed included coverage and unrequested extra identities', () => {
    const { search, offer } = fixture();
    offer.contract.coverageProductIds[0] = 'changed-included-cover';
    expect(() => assertCarProtectionRecheck(offer, search)).toThrow(/base rental changed/);
    offer.contract.coverageProductIds[0] = 'cdw';
    offer.contract.extras.push({ kind: 'additional_driver', productId: 'unexpected-driver', category: null, quantity: 1 });
    expect(() => assertCarProtectionRecheck(offer, search)).toThrow(/base rental changed/);
  });
  it('rejects absent, substituted and unconfirmed protection', () => {
    const { search, offer } = fixture();
    offer.extras[0]!.eligibility.status = 'unknown';
    expect(() => assertCarProtectionRecheck(offer, search)).toThrow(/not verified/);
    offer.extras[0]!.eligibility.status = 'confirmed'; offer.extras[0]!.productId = '36';
    expect(() => assertCarProtectionRecheck(offer, search)).toThrow(/not verified/);
    offer.extras = [];
    expect(() => assertCarProtectionRecheck(offer, search)).toThrow(/not verified/);
  });
  it('keeps the selected product but removes the one-time binding and budget from tracker refreshes', () => {
    const { search } = fixture();
    const tracking = carTrackerSearch(search);
    expect(tracking).not.toHaveProperty('protectionRecheck');
    expect(tracking.extras.protection).toEqual(search.extras.protection);
    expect(tracking.filters.maxTotal).toBeNull();
    expect(search.protectionRecheck?.offerId).toBe('verified-quote');
    expect(search.filters.maxTotal?.minor).toBe(15000);
  });
  it('rejects public metadata injection and malformed internal bindings', () => {
    const { search } = fixture();
    expect(() => normalizeCarSearchInput(search)).toThrow(/Unsupported/);
    expect(() => validateCarSearch({ ...search, protectionRecheck: { ...search.protectionRecheck, baseContractHash: 'fake' } })).toThrow(/identity/);
    expect(() => validateCarSearch({ ...search, protectionRecheck: { ...search.protectionRecheck, price: 1 } })).toThrow(/recheck/);
    expect(() => validateCarSearch({ ...search, extras: { ...search.extras, protection: [] } })).toThrow(/recheck/);
  });
});

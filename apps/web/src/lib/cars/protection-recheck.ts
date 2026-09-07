import { carContractHash } from './selection';
import { CarError, type CarOffer, type CarSearch } from './types';

/** Compare exact extractor composition, not a prefix which could hide changed base terms. */
export function assertCarProtectionRecheck(offer: CarOffer, search: CarSearch): void {
  const binding = search.protectionRecheck;
  if (!binding) return;
  const selected = search.extras.protection[0];
  const products = offer.extras.filter(extra => extra.kind === 'protection');
  const product = products[0];
  if (!selected || products.length !== 1 || !product || product.productId !== selected.productId
    || offer.contract.source !== selected.source || product.quantity !== 1
    || product.availability.status !== 'confirmed' || product.availability.value !== true
    || product.eligibility.status !== 'confirmed' || product.eligibility.value !== true) {
    throw new CarError('The selected protection product was not verified for this rental', 409);
  }
  const selectedTerms = selected.source === 'autoeurope'
    ? `${product.availability.text}: ${product.eligibility.text}` : product.eligibility.text;
  if (offer.contract.coverageTerms !== `${binding.baseCoverageTerms} ${selectedTerms}`) {
    throw new CarError('The base rental coverage changed during protection selection', 409);
  }
  const base = { ...offer.contract, coverageTerms: binding.baseCoverageTerms,
    coverageProductIds: offer.contract.coverageProductIds.filter(id => id !== selected.productId),
    extras: offer.contract.extras.filter(extra => !(extra.kind === 'protection' && extra.productId === selected.productId)) };
  if (carContractHash(base) !== binding.baseContractHash) throw new CarError('The selected base rental changed during protection selection', 409);
}

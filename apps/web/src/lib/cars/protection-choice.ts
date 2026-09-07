import { carObservationTime, carProviderUrl } from './offer-validation';
import { validateCarMoney } from './money';
import { carRecord, carText } from './validation';
import { CAR_SOURCES, CarError, type CarMoney, type CarSource } from './types';

/** An observed option, not a selected extra or a verified all-in rental quote. */
export interface CarProtectionChoice {
  source: CarSource;
  productId: string;
  name: string;
  termsSummary: string;
  policyLinks: string[];
  observedExtraPrice: CarMoney;
  sourceUrl: string;
  observedAt: string;
}

const POLICY_HOSTS: Record<CarSource, readonly string[]> = {
  discovercars: ['www.sincerainsurance.com', 'www.discovercars.com'],
  autoeurope: ['www.globalmediaserver.com', 'book.autoeurope.com'],
};

export function carProtectionPolicyUrl(raw: unknown, source: CarSource): string {
  const text = carText(raw, 2000, 'protection policy URL');
  let url: URL;
  try { url = new URL(text); } catch { throw new CarError('Invalid protection policy URL'); }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !POLICY_HOSTS[source].includes(url.hostname)) {
    throw new CarError('Protection policy link does not belong to an approved provider');
  }
  return url.href;
}

export function validateCarProtectionChoice(raw: unknown, now = new Date()): CarProtectionChoice {
  const value = carRecord(raw), source = CAR_SOURCES.find(source => source === value.source);
  if (!source) throw new CarError('Unsupported protection provider');
  const productId = carText(value.productId, 200, 'protection product');
  if (!(source === 'discovercars' ? /^\d+$/ : /^[A-Za-z0-9.]+$/).test(productId) || productId === 'basic') {
    throw new CarError('Invalid optional protection product');
  }
  if (!Array.isArray(value.policyLinks) || value.policyLinks.length > 8) throw new CarError('Invalid protection policy links');
  const policyLinks = value.policyLinks.map(link => carProtectionPolicyUrl(link, source));
  if (new Set(policyLinks).size !== policyLinks.length) throw new CarError('Duplicate protection policy links');
  return {
    source, productId, name: carText(value.name, 200, 'protection name'),
    termsSummary: carText(value.termsSummary, 12000, 'protection terms'), policyLinks,
    observedExtraPrice: validateCarMoney(value.observedExtraPrice),
    sourceUrl: carProviderUrl(value.sourceUrl, source), observedAt: carObservationTime(value.observedAt, now),
  };
}

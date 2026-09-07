'use client';
import { useLocale, useTranslations } from 'next-intl';
import { formatCarMoney } from '@/lib/cars/money';
import type { CarEvidence, CarMoney, CarOffer, CarRequirement, CarSource } from '@/lib/cars/types';
import { safeCarLink } from './presentation';
import styles from './Cars.module.css';

export function CarProof({ label, evidence, source }: { label: string; evidence: CarEvidence<string | boolean | CarMoney>; source: CarSource }) {
  const t = useTranslations('Cars'), locale = useLocale(), link = safeCarLink(evidence.sourceUrl, source);
  const value = evidence.value;
  const content = value === null ? t('unknown') : typeof value === 'boolean' ? t(value ? 'yes' : 'no') : typeof value === 'string' ? value : formatCarMoney(value, locale);
  return <details className={styles.proof}><summary><span>{label}</span><span>{content} · {t(evidence.status)}</span></summary>
    <p className={styles.evidenceText}>{evidence.text}</p><p className={styles.hint}><time dateTime={evidence.observedAt}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(evidence.observedAt))} UTC</time>{link && <> · <a href={link} target="_blank" rel="noopener noreferrer">{t('source')}</a></>}</p>
  </details>;
}
export function CarRequirements({ requirements, source }: { requirements: CarRequirement[]; source: CarSource }) {
  const t = useTranslations('Cars');
  return <div className={styles.requirements}><h4>{t('requirements')}</h4><p className={styles.hint}>{t('requirementsHelp')}</p>
    {requirements.map((entry, index) => <CarProof key={`${entry.kind}-${index}`} label={`${t(entry.appliesTo)}: ${entry.condition}`} evidence={entry.evidence} source={source} />)}
  </div>;
}
export function CarEvidenceDetails({ offer }: { offer: CarOffer }) {
  const t = useTranslations('Cars'), source = offer.contract.source;
  return <details className={styles.details}><summary>{t('details')}</summary><div className={styles.detailBody}>
    <h4>{t('charges')}</h4>{offer.charges.map(charge => <CarProof key={charge.id} label={`${charge.label} · ${t(charge.payment === 'now' ? 'payNow' : 'payPickup')}`} evidence={charge.amount} source={source} />)}
    <div className={styles.security}><h4>{t('security')}</h4><p className={styles.hint}>{t('securityHelp')}</p><CarProof label={t('deposit')} evidence={offer.deposit} source={source} /><CarProof label={t('excess')} evidence={offer.excess} source={source} /></div>
    <h4>{t('terms')}</h4><dl className={styles.terms}><div><dt>{t('fuel')}</dt><dd>{offer.contract.fuelPolicy}</dd></div><div><dt>{t('mileage')}</dt><dd>{offer.contract.mileagePolicy}</dd></div><div><dt>{t('cancellation')}</dt><dd>{offer.contract.cancellationPolicy}</dd></div><div><dt>{t('protection')}</dt><dd>{offer.contract.coverageTerms}</dd></div></dl>
    <h4>{t('extras')}</h4>{!offer.extras.length && <p className={styles.hint}>{t('noExtras')}</p>}
    {offer.extras.map(extra => <div key={`${extra.kind}-${extra.productId}`} className={styles.extra}><h5>{t(extra.category ?? extra.kind)} × {extra.quantity}</h5><p className={styles.hint}>{extra.productId}</p><CarProof label={t('availability')} evidence={extra.availability} source={source} /><CarProof label={t('eligibility')} evidence={extra.eligibility} source={source} /><CarProof label={t('included')} evidence={extra.included} source={source} /></div>)}
    <CarRequirements requirements={offer.requirements} source={source} />
    <details className={styles.details}><summary>{t('verification')}</summary>
      {(['total', 'available', 'requestVerified', 'driverEligible', 'requirementsComplete', 'mandatoryChargesComplete', 'taxesIncluded', 'unlimitedMileage', 'freeCancellation'] as const).map(key => <CarProof key={key} label={t(key)} evidence={offer[key]} source={source} />)}
    </details>
  </div></details>;
}

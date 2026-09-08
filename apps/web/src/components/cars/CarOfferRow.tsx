'use client';
import { useId, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatCarMoney } from '@/lib/cars/money';
import { CAR_PROVIDER_LABELS } from '@/lib/cars/preferences';
import type { CarOffer, CarSearch } from '@/lib/cars/types';
import type { CarPriceAssessment } from '@/lib/cars/pricing';
import { CarEvidenceDetails } from './CarEvidenceDetails';
import { carLocalDate, safeCarLink } from './presentation';
import styles from './Cars.module.css';
import { CarLocationLabel } from './CarLocationLabel';

export function CarOfferRow({ offer, search, assessment, disabled, onTrack, children }: { offer: CarOffer; search: CarSearch; assessment: CarPriceAssessment; disabled: boolean; onTrack: () => void; children?: ReactNode }) {
  const t = useTranslations('Cars'), locale = useLocale(), id = useId(), booking = safeCarLink(offer.bookingUrl, offer.contract.source);
  return <article className={styles.offer} aria-labelledby={`${id}-title`}>
    <div className={styles.offerMain}><div><p className={styles.eyebrow}>{CAR_PROVIDER_LABELS[offer.contract.source]} · {offer.supplier}</p><h3 id={`${id}-title`}>{offer.contract.model}{!offer.contract.modelGuaranteed && <> <span className={styles.similar}>{t('similar')}</span></>}</h3>
      <p className={styles.hint}>{offer.contract.vehicleClass} · {t(offer.contract.transmission)} · {t('seats', { count: offer.contract.seats })}</p>
      <dl className={styles.journey}><div><dt>{t('pickup')}</dt><dd><CarLocationLabel location={search.pickup} sources={[offer.contract.source]} /><time dateTime={offer.contract.pickupAt.instant}>{carLocalDate(offer.contract.pickupAt, locale)} · {offer.contract.pickupAt.timeZone}</time></dd></div><div><dt>{t('dropoff')}</dt><dd><CarLocationLabel location={search.dropoff} sources={[offer.contract.source]} /><time dateTime={offer.contract.dropoffAt.instant}>{carLocalDate(offer.contract.dropoffAt, locale)} · {offer.contract.dropoffAt.timeZone}</time></dd></div></dl>
    </div><div className={styles.quote}><p className={styles.eyebrow}>{t(assessment.eligible ? 'verifiedTotal' : 'unverifiedTotal')}</p><p className={styles.price}>{offer.total.value ? formatCarMoney(offer.total.value, locale) : t('unknown')}</p>
      <p className={styles.hint}>{t('wholeRental')}</p>
      {assessment.eligible && <dl className={styles.payments}><div><dt>{t('payNow')}</dt><dd>{formatCarMoney(assessment.payNow!, locale)}</dd></div><div><dt>{t('payPickup')}</dt><dd>{formatCarMoney(assessment.payAtPickup!, locale)}</dd></div></dl>}
      <button type="button" className={styles.button} disabled={disabled || !assessment.eligible} onClick={onTrack} aria-describedby={!assessment.eligible ? `${id}-reasons` : undefined}>{t('track')}</button>
      {booking && <a className={styles.secondary} href={booking} target="_blank" rel="noopener noreferrer">{t('viewProvider')}</a>}
    </div></div>
    {!assessment.eligible && <div id={`${id}-reasons`} className={styles.notice}><strong>{t('notEligible')}</strong><ul>{assessment.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div>}
    {children}
    <CarEvidenceDetails offer={offer} />
  </article>;
}

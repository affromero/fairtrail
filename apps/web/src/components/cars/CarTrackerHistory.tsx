'use client';
import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { CarDetailView } from '@/lib/cars/detail-view';
import { formatCarMoney } from '@/lib/cars/money';
import { CAR_PROVIDER_LABELS } from '@/lib/cars/preferences';
import { CarEvidenceDetails } from './CarEvidenceDetails';
import { carLocalDate } from './presentation';
import styles from './Cars.module.css';
import { CarLocationLabel } from './CarLocationLabel';

export function CarTrackerHistory({ detail }: { detail: CarDetailView }) {
  const t = useTranslations('Cars'), locale = useLocale(), id = useId();
  const { tracker, latestObservation, snapshots, runs } = detail;
  const sources = tracker.selection ? [tracker.selection.source] : tracker.search.sources;
  const money = (minor: number | null) => minor === null ? t('unknown') : formatCarMoney({ currency: tracker.currency, minor }, locale);
  const time = (value: string | null) => value === null ? t('notRecorded') : <time dateTime={value}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value))} UTC</time>;
  const verified = snapshots.filter(snapshot => snapshot.eligible), excluded = snapshots.filter(snapshot => !snapshot.eligible);
  return <div className={styles.root}>
    <section aria-labelledby={`${id}-summary`}>
      <div className={styles.resultsHeader}><div><p className={styles.eyebrow}>{t(tracker.active ? 'trackerActive' : 'trackerPaused')}</p><h2 id={`${id}-summary`}>{tracker.label}</h2></div><p className={styles.hint}>{t(tracker.options.mode === 'best' ? 'bestHelp' : 'contractHelp')}</p></div>
      <dl className={styles.journey}><div><dt>{t('pickup')}</dt><dd><CarLocationLabel location={tracker.search.pickup} sources={sources} /><time dateTime={tracker.search.pickupAt.instant}>{carLocalDate(tracker.search.pickupAt, locale)} · {tracker.search.pickupAt.timeZone}</time></dd></div><div><dt>{t('dropoff')}</dt><dd><CarLocationLabel location={tracker.search.dropoff} sources={sources} /><time dateTime={tracker.search.dropoffAt.instant}>{carLocalDate(tracker.search.dropoffAt, locale)} · {tracker.search.dropoffAt.timeZone}</time></dd></div></dl>
      <dl className={styles.historySummary}>
        <div><dt>{t('retainedPrice')}</dt><dd className={styles.price}>{money(tracker.latestPriceMinor)}</dd></div>
        <div><dt>{t('historicalLow')}</dt><dd className={styles.price}>{money(tracker.historicalLowMinor)}</dd></div>
        <div><dt>{t('verifiedObservedAt')}</dt><dd>{time(latestObservation?.observedAt ?? null)}</dd></div>
        <div><dt>{t('lastAttempt')}</dt><dd>{time(tracker.lastCheckedAt)}</dd></div>
      </dl>
      <p className={styles.hint}>{t('historicalPriceHelp')}</p>
      {tracker.lastError && <div className={styles.error} role="alert"><strong>{t('latestCheckAttention')}</strong><p>{tracker.lastError}</p><p>{t('retainedPriceHelp')}</p></div>}
      {!detail.notificationsConfigured && <p className={styles.notice}>{t('noNotificationChannel')}</p>}
      {latestObservation && <details className={styles.details}><summary>{t('retainedEvidence')}</summary><p className={styles.hint}>{CAR_PROVIDER_LABELS[latestObservation.source]} · {latestObservation.offer.supplier} · {time(latestObservation.observedAt)}</p><CarEvidenceDetails offer={latestObservation.offer} /></details>}
    </section>
    <section aria-labelledby={`${id}-deliveries`} className={styles.historySection}>
      <h2 id={`${id}-deliveries`}>{t('Delivery.title')}</h2><p className={styles.hint}>{t('Delivery.help')}</p>
      {!detail.deliveries.length && <p>{t('Delivery.empty')}</p>}
      <ol className={styles.historyList}>{detail.deliveries.map(delivery => <li key={delivery.id} className={styles.checkHistory}>
        <strong>{t(`Delivery.${delivery.status}`)}</strong>
        <dl><div><dt>{t('Delivery.created')}</dt><dd>{time(delivery.createdAt)}</dd></div>
          <div><dt>{t('Delivery.acknowledged')}</dt><dd>{delivery.acknowledgedChannels}</dd></div>
          {delivery.nextAttemptAt && <div><dt>{t('Delivery.next')}</dt><dd>{time(delivery.nextAttemptAt)}</dd></div>}
        </dl>
      </li>)}</ol>
    </section>
    <section aria-labelledby={`${id}-history`} className={styles.historySection}>
      <h2 id={`${id}-history`}>{t('verifiedHistory')}</h2><p className={styles.hint}>{t('historyLimit')}</p>
      {!verified.length && <p>{t('noVerifiedHistory')}</p>}
      <ol className={styles.historyList}>{verified.map(snapshot => <li key={snapshot.id}><details className={styles.details}><summary><span>{money(snapshot.totalMinor)} · {CAR_PROVIDER_LABELS[snapshot.source]}</span><span>{time(snapshot.observedAt)}</span></summary><p>{snapshot.offer.supplier} · {snapshot.offer.contract.model}{!snapshot.offer.contract.modelGuaranteed && <> {t('similar')}</>}</p><CarEvidenceDetails offer={snapshot.offer} /></details></li>)}</ol>
    </section>
    {!!excluded.length && <section aria-labelledby={`${id}-excluded`} className={styles.historySection}><h2 id={`${id}-excluded`}>{t('excludedHistory')}</h2><p className={styles.hint}>{t('excludedHistoryHelp')}</p><ol className={styles.historyList}>{excluded.map(snapshot => <li key={snapshot.id}><details className={styles.details}><summary>{CAR_PROVIDER_LABELS[snapshot.source]} · {snapshot.offer.supplier} · {time(snapshot.observedAt)}</summary><p>{t('unverifiedTotal')}: {money(snapshot.totalMinor)}</p><ul>{snapshot.reasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}</ul><CarEvidenceDetails offer={snapshot.offer} /></details></li>)}</ol></section>}
    <section aria-labelledby={`${id}-checks`} className={styles.historySection}><h2 id={`${id}-checks`}>{t('checkHistory')}</h2><p className={styles.hint}>{t('checkHistoryHelp')}</p>{!runs.length && <p>{t('noChecks')}</p>}<ol className={styles.historyList}>{runs.map(run => <li key={run.id} className={styles.checkHistory}><strong>{t(run.status === 'success' ? 'complete' : run.status === 'unavailable' ? 'noVerified' : run.status)}</strong><dl><div><dt>{t('checkRequested')}</dt><dd>{time(run.createdAt)}</dd></div><div><dt>{t('checkFinished')}</dt><dd>{time(run.completedAt)}</dd></div></dl>{run.error && <p className={styles.error}>{run.error}</p>}</li>)}</ol></section>
  </div>;
}

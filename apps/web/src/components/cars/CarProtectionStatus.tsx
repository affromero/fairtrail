'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { useCarSearchCreation } from './useCarSearchCreation';
import styles from './Cars.module.css';

export function CarProtectionStatus({ recovery, disabled, complete }: { recovery: ReturnType<typeof useCarSearchCreation>; disabled: boolean; complete: boolean }) {
  const t = useTranslations('Cars.Protection'), car = useTranslations('Cars');
  return <>
    {recovery.error && <p role="alert" className={styles.error}>{recovery.error}</p>}
    {recovery.phase === 'sending' && <p role="status" className={styles.notice}>{t('sending')}</p>}
    {recovery.phase === 'uncertain' && <div role="alert" className={styles.notice}><h3>{t('uncertain')}</h3><p>{t('uncertainHelp')}</p><button className={styles.button} type="button" disabled={disabled} onClick={() => void recovery.retry()}>{t('retry')}</button></div>}
    {recovery.phase === 'storage_error' && <div role="alert" className={styles.notice}><p>{car('storageError')}</p><button className={styles.secondary} type="button" disabled={disabled} onClick={recovery.recoverStorage}>{car('Search.retryStorage')}</button>
      {!recovery.pending && complete && <details><summary>{car('closeTrackingTitle')}</summary><p>{t('closeHelp')}</p><button className={styles.secondary} type="button" disabled={disabled} onClick={() => void recovery.closeTracking()}>{car('closeTrackingConfirm')}</button></details>}
    </div>}
    {recovery.phase === 'closing' && <p role="status" className={styles.notice}>{car('closingTracking')}</p>}
    {recovery.phase === 'close_uncertain' && <div role="alert" className={styles.notice}><p>{car('closeTrackingUncertain')}</p><button className={styles.secondary} type="button" disabled={disabled} onClick={() => void recovery.closeTracking()}>{car('closeTrackingRetry')}</button></div>}
    {recovery.phase === 'removed' && <p className={styles.notice}>{t('removed')}</p>}
    {recovery.phase === 'created' && recovery.id && <div role="status" className={styles.notice}><h3>{t('created')}</h3><p>{t('createdHelp')}</p><Link className={styles.button} href={`/cars/search/${encodeURIComponent(recovery.id)}`}>{t('open')}</Link></div>}
    {recovery.pending && <dl className={styles.terms} aria-label={t('pending')}><div><dt>{car('selectedOffer')}</dt><dd>{String(recovery.pending.body.offerId)}</dd></div><div><dt>{t('choice')}</dt><dd>{String(recovery.pending.body.choiceId)}</dd></div></dl>}
  </>;
}

'use client';
import { useTranslations } from 'next-intl';
import type { useCarTracker } from './useCarTracker';
import { useCarRefresh } from './useCarRefresh';
import { carRunIsActive } from '@/lib/cars/run-view';
import styles from './Cars.module.css';

export function CarRefreshControls({ controller, actorScope }: { controller: ReturnType<typeof useCarTracker>; actorScope: string }) {
  const t = useTranslations('Cars.Refresh'), { tracker } = controller.detail;
  const refresh = useCarRefresh(tracker.id, actorScope, () => { if (!controller.busy && !controller.locked) void controller.read(); }, controller.loseAccess);
  const disabled = controller.busy || controller.locked || !tracker.active || controller.detail.runs.some(carRunIsActive);
  if (controller.hidden) return null;
  return <section className={styles.historySection} aria-label={t('title')}>
    <h2>{t('title')}</h2><p className={styles.hint}>{t('help')}</p>
    <button type="button" className={styles.secondary} disabled={disabled || refresh.locked} onClick={() => void refresh.start(tracker.revision)}>{t(refresh.phase === 'sending' ? 'sending' : 'start')}</button>
    {refresh.phase === 'uncertain' && <div className={styles.notice} role="status"><p>{t('uncertain')}</p><button type="button" className={styles.secondary} disabled={controller.busy} onClick={() => void refresh.retry()}>{t('recover')}</button></div>}
    {refresh.phase === 'storage_error' && <div className={styles.error} role="alert"><p>{t('storageError')}</p><button type="button" className={styles.secondary} onClick={refresh.recoverStorage}>{t('retryStorage')}</button>
      {!refresh.pending && <><p>{t('discardHelp')}</p><button type="button" className={styles.secondary} disabled={tracker.active || controller.busy || controller.locked} onClick={refresh.discardUnreadable}>{t('discard')}</button></>}
    </div>}
    {refresh.phase === 'accepted' && <p className={styles.notice} role="status">{t('accepted')}</p>}
    {refresh.phase === 'removed' && <p className={styles.notice} role="status">{t('removed')}</p>}
    {refresh.phase === 'rejected' && <p className={styles.error} role="alert">{t('rejected')}</p>}
  </section>;
}

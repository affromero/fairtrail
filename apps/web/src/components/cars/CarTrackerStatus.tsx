'use client';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import type { CarDetailView } from '@/lib/cars/detail-view';
import { useCarTracker } from './useCarTracker';
import { CarTrackerHistory } from './CarTrackerHistory';
import { CarManagement } from './CarManagement';
import styles from './Cars.module.css';

export function CarTrackerStatus({ initial, actorScope }: { initial: CarDetailView; actorScope: string }) {
  const t = useTranslations('Cars'), controller = useCarTracker(initial, actorScope);
  const { busy, interrupted, hidden, detail, phase } = controller;
  return <div className={styles.root}>
    {phase !== 'deleted' && <button type="button" className={styles.secondary} disabled={busy} onClick={() => void controller.read()}>{t(interrupted ? 'retryStatus' : 'refreshStatus')}</button>}
    {busy && <p role="status" className={styles.notice}>{t('updatingTracker')}</p>}
    {phase === 'deleted' ? <p role="status" className={styles.notice}>{t('trackerDeleted')}</p> : interrupted && <p role="alert" className={styles.error}>{t(hidden ? 'trackerAccessLost' : 'trackerInterrupted')}</p>}
    {hidden ? phase !== 'deleted' && <Link className={styles.secondary} href={`/login?next=${encodeURIComponent(`/cars/${initial.tracker.id}`)}`}>{t('signIn')}</Link> : <><CarTrackerHistory detail={detail} /><CarManagement controller={controller} /></>}
  </div>;
}

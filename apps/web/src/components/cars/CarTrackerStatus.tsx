'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { validateCarDetailView, type CarDetailView } from '@/lib/cars/detail-view';
import { carRunIsActive } from '@/lib/cars/run-view';
import { travelRequest, TravelResponseError } from '../travel/client';
import { CarTrackerHistory } from './CarTrackerHistory';
import styles from './Cars.module.css';

export function CarTrackerStatus({ initial, actorScope }: { initial: CarDetailView; actorScope: string }) {
  const t = useTranslations('Cars');
  const [detail, setDetail] = useState(initial), [busy, setBusy] = useState(false), [interrupted, setInterrupted] = useState(false), [hidden, setHidden] = useState(false);
  const current = useRef(initial), generation = useRef(0), controller = useRef<AbortController | null>(null);
  const read = useCallback(async () => {
    const sequence = ++generation.current, aborter = new AbortController();
    controller.current?.abort(); controller.current = aborter; setBusy(true);
    const timeout = setTimeout(() => aborter.abort(), 15_000);
    try {
      const next = validateCarDetailView(await travelRequest<unknown>(`/api/cars/${encodeURIComponent(initial.tracker.id)}`, { signal: aborter.signal, cache: 'no-store' }), initial.tracker.id);
      if (sequence !== generation.current) return;
      if (aborter.signal.aborted) throw new Error('Rental history request exceeded its deadline');
      if (next.tracker.createdAt !== initial.tracker.createdAt || JSON.stringify(next.tracker.search) !== JSON.stringify(initial.tracker.search) || JSON.stringify(next.tracker.selection) !== JSON.stringify(initial.tracker.selection) || next.tracker.revision < current.current.tracker.revision) throw new Error('Rental history identity or revision changed unexpectedly');
      if (next.tracker.updatedAt < current.current.tracker.updatedAt) throw new Error('Rental history moved backwards');
      for (const run of next.runs) {
        const previous = current.current.runs.find(value => value.id === run.id);
        if (previous && ((!carRunIsActive(previous) && (previous.status !== run.status || previous.completedAt !== run.completedAt)) || (previous.status === 'running' && run.status === 'queued'))) throw new Error('Rental check status moved backwards');
      }
      current.current = next; setDetail(next); setInterrupted(false); setHidden(false);
    } catch (error) {
      if (sequence !== generation.current) return;
      setInterrupted(true);
      setHidden(previous => previous || (error instanceof TravelResponseError && [401, 403, 404].includes(error.status)));
    } finally {
      clearTimeout(timeout);
      if (controller.current === aborter) controller.current = null;
      if (sequence === generation.current) setBusy(false);
    }
  }, [initial.tracker]);
  useEffect(() => {
    if (busy || interrupted || hidden || !detail.runs.some(carRunIsActive)) return;
    const timeout = setTimeout(() => void read(), 1500);
    return () => clearTimeout(timeout);
  }, [busy, interrupted, hidden, detail, read]);
  useEffect(() => () => { generation.current++; controller.current?.abort(); }, [initial.tracker.id, actorScope]);
  return <div className={styles.root}>
    <button type="button" className={styles.secondary} disabled={busy} onClick={() => void read()}>{t(interrupted ? 'retryStatus' : 'refreshStatus')}</button>
    {busy && <p role="status" className={styles.notice}>{t('updatingTracker')}</p>}
    {interrupted && <p role="alert" className={styles.error}>{t(hidden ? 'trackerAccessLost' : 'trackerInterrupted')}</p>}
    {hidden ? <Link className={styles.secondary} href={`/login?next=${encodeURIComponent(`/cars/${initial.tracker.id}`)}`}>{t('signIn')}</Link> : <CarTrackerHistory detail={detail} />}
  </div>;
}

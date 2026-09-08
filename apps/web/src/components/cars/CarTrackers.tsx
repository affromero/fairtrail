'use client';
import Link from 'next/link';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { validateCarTrackerView, type CarTrackerView } from '@/lib/cars/tracker-view';
import { carRecord } from '@/lib/cars/validation';
import { formatCarMoney } from '@/lib/cars/money';
import { travelRequest, TravelResponseError } from '../travel/client';
import { carLocalDate } from './presentation';
import styles from './Cars.module.css';
import { CarLocationLabel } from './CarLocationLabel';

interface ListState { trackers: CarTrackerView[] | null; cursor: string | null; busy: boolean; failed: boolean; hidden: boolean; attempted: string | null }
export function CarTrackers({ admin = false }: { admin?: boolean }) {
  const t = useTranslations('Cars'), locale = useLocale(), id = useId();
  const [state, setState] = useState<ListState>({ trackers: null, cursor: null, busy: true, failed: false, hidden: false, attempted: null });
  const current = useRef(state), generation = useRef(0), controller = useRef<AbortController | null>(null), seen = useRef(new Set<string>());
  const update = useCallback((patch: Partial<ListState>) => { current.current = { ...current.current, ...patch }; setState(current.current); }, []);
  const load = useCallback(async (cursor: string | null = null) => {
    const sequence = ++generation.current, aborter = new AbortController();
    controller.current?.abort(); controller.current = aborter;
    update({ busy: true, failed: false, attempted: cursor });
    const timeout = setTimeout(() => aborter.abort(), 15_000);
    try {
      const params = new URLSearchParams({ limit: '25', ...(admin ? { admin: 'true' } : {}), ...(cursor ? { cursor } : {}) });
      const value = carRecord(await travelRequest<unknown>(`/api/cars?${params}`, { cache: 'no-store', signal: aborter.signal }));
      if (sequence !== generation.current) return;
      if (aborter.signal.aborted) throw new Error('Tracker list exceeded its deadline');
      if (!Array.isArray(value.trackers) || value.trackers.length > 25 || !(value.nextCursor === null || typeof value.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,1500}$/.test(value.nextCursor))) throw new Error('Invalid tracker page');
      const trackers = value.trackers.map(validateCarTrackerView), nextCursor = value.nextCursor;
      if (new Set(trackers.map(tracker => tracker.id)).size !== trackers.length || nextCursor && (!trackers.length || nextCursor === cursor || cursor && seen.current.has(nextCursor))) throw new Error('Tracker page did not advance');
      const previous = cursor ? current.current.trackers ?? [] : [];
      if (cursor && trackers.length && trackers.every(tracker => previous.some(row => row.id === tracker.id))) throw new Error('Tracker page repeated');
      if (cursor === null) seen.current.clear();
      if (nextCursor) seen.current.add(nextCursor);
      const known = new Set(previous.map(tracker => tracker.id));
      update({ trackers: [...previous, ...trackers.filter(tracker => !known.has(tracker.id))], cursor: nextCursor, failed: false, hidden: false });
    } catch (error) {
      if (sequence !== generation.current) return;
      const hidden = current.current.hidden || error instanceof TravelResponseError && [401, 403, 404].includes(error.status);
      update({ failed: true, hidden, ...(hidden ? { trackers: null, cursor: null, attempted: null } : {}) });
    } finally {
      clearTimeout(timeout);
      if (controller.current === aborter) controller.current = null;
      if (sequence === generation.current) update({ busy: false });
    }
  }, [admin, update]);
  useEffect(() => {
    update({ trackers: null, cursor: null, hidden: false }); seen.current.clear(); void load();
    return () => { generation.current++; controller.current?.abort(); };
  }, [load, update]);
  return <section className={styles.root} aria-labelledby={`${id}-title`}>
    <header className={styles.resultsHeader}><div><p className={styles.eyebrow}>{t('carsNav')}</p><h2 id={`${id}-title`}>{t(admin ? 'allTrackers' : 'savedTrackers')}</h2></div><button className={styles.secondary} onClick={() => void load()}>{t('refreshList')}</button></header>
    <p className={styles.hint}>{t('listHistoricalHelp')}</p>
    {state.busy && <p role="status">{t('loadingTrackers')}</p>}
    {state.failed && <div role="alert" className={styles.error}><p>{t(state.hidden ? 'listAccessLost' : 'listFailed')}</p><div className={styles.actions}><button className={styles.secondary} disabled={state.busy} onClick={() => void load(state.attempted)}>{t('retryList')}</button>{state.hidden && <Link className={styles.secondary} href="/login?next=%2Fcars">{t('signIn')}</Link>}</div></div>}
    {!state.hidden && state.trackers !== null && (state.trackers.length ? <ul className={styles.trackerList}>{state.trackers.map(tracker => <li key={tracker.id}>
      <Link className={styles.trackerRow} href={`/cars/${encodeURIComponent(tracker.id)}`}>
        <div><h3>{tracker.label}</h3><p className={styles.eyebrow}>{t(tracker.active ? 'trackerActive' : 'trackerPaused')}</p>
          <dl className={styles.journey}>
            <div><dt>{t('pickup')}</dt><dd><CarLocationLabel location={tracker.search.pickup} sources={tracker.selection ? [tracker.selection.source] : tracker.search.sources} /><time dateTime={tracker.search.pickupAt.instant}>{carLocalDate(tracker.search.pickupAt, locale)} · {tracker.search.pickupAt.timeZone}</time></dd></div>
            <div><dt>{t('dropoff')}</dt><dd><CarLocationLabel location={tracker.search.dropoff} sources={tracker.selection ? [tracker.selection.source] : tracker.search.sources} /><time dateTime={tracker.search.dropoffAt.instant}>{carLocalDate(tracker.search.dropoffAt, locale)} · {tracker.search.dropoffAt.timeZone}</time></dd></div>
          </dl>{tracker.lastError && <p className={styles.error}>{t('latestCheckAttention')}</p>}
        </div>
        <div><p className={styles.hint}>{t('retainedPrice')}</p><p className={styles.price}>{tracker.latestPriceMinor === null ? t('unknown') : formatCarMoney({ currency: tracker.currency, minor: tracker.latestPriceMinor }, locale)}</p><span className={styles.hint}>{t('openTracker')}</span></div>
      </Link>
    </li>)}</ul> : !state.busy && !state.failed && <p className={styles.notice}>{t('noSavedTrackers')}</p>)}
    {!state.hidden && state.cursor && !state.failed && <button className={styles.secondary} disabled={state.busy} onClick={() => void load(state.cursor)}>{t('loadMoreTrackers')}</button>}
  </section>;
}

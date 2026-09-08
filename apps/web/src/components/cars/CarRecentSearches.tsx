'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { carRecord, carText } from '@/lib/cars/validation';
import { validateCarRunSummary } from '@/lib/cars/run-view';
import { travelRequest, TravelResponseError } from '../travel/client';
import styles from './Cars.module.css';

type Search = ReturnType<typeof validateCarRunSummary> & { label: string };
export function CarRecentSearches() {
  const t = useTranslations('Cars.Search'), car = useTranslations('Cars'), locale = useLocale();
  const [rows, setRows] = useState<Search[]>([]), [cursor, setCursor] = useState<string | null>(null), [busy, setBusy] = useState(true), [failed, setFailed] = useState(false), [hidden, setHidden] = useState(false);
  const sequence = useRef(0), controller = useRef<AbortController | null>(null);
  const load = useCallback(async (cursor: string | null = null) => {
    const current = ++sequence.current, aborter = new AbortController(); controller.current?.abort(); controller.current = aborter;
    setBusy(true); setFailed(false);
    const timer = setTimeout(() => aborter.abort(), 15_000);
    try {
      const raw = carRecord(await travelRequest<unknown>(`/api/cars/search${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { cache: 'no-store', signal: aborter.signal }));
      if (current !== sequence.current) return;
      if (aborter.signal.aborted || !Array.isArray(raw.searches) || raw.searches.length > 25 || !(raw.nextCursor === null || typeof raw.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,1500}$/.test(raw.nextCursor))) throw new Error('Invalid search history');
      const searches = raw.searches.map(value => ({ ...validateCarRunSummary(value), label: carText(carRecord(value).label, 503, 'rental label') }));
      if (searches.some(row => row.trackerId !== null) || new Set(searches.map(row => row.id)).size !== searches.length || raw.nextCursor && (!searches.length || raw.nextCursor === cursor)) throw new Error('Search history did not advance');
      setRows(searches); setCursor(raw.nextCursor); setHidden(false);
    } catch (error) {
      if (current !== sequence.current) return;
      setFailed(true);
      if (error instanceof TravelResponseError && [401, 403, 404].includes(error.status)) { setRows([]); setCursor(null); setHidden(true); }
    } finally { clearTimeout(timer); if (current === sequence.current) setBusy(false); }
  }, []);
  useEffect(() => { void load(); return () => { sequence.current++; controller.current?.abort(); }; }, [load]);
  return <section className={styles.root} aria-label={t('recentSearches')}><header className={styles.resultsHeader}><h2>{t('recentSearches')}</h2><button className={styles.secondary} disabled={busy} onClick={() => void load()}>{t('refreshSearches')}</button></header>
    <p className={styles.hint}>{t('recentHelp')}</p>
    {busy && <p role="status">{car('updatingStatus')}</p>}
    {failed && <p role="alert" className={styles.error}>{hidden ? car('accessLost') : t('searchListFailed')}</p>}
    {hidden && <Link className={styles.secondary} href="/login?next=%2Fcars">{car('signIn')}</Link>}
    {!hidden && <ul className={styles.historyList}>{rows.map(row => <li className={styles.checkHistory} key={row.id}><Link href={`/cars/search/${encodeURIComponent(row.id)}`}>{row.label}</Link><p>{car(row.status === 'unavailable' ? 'noVerified' : row.status)} · <time dateTime={row.createdAt}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(row.createdAt))}</time></p></li>)}</ul>}
    {!busy && !failed && !rows.length && <p className={styles.hint}>{t('noRecent')}</p>}
    {cursor && !hidden && <button className={styles.secondary} disabled={busy} onClick={() => void load(cursor)}>{t('loadOlder')}</button>}
  </section>;
}

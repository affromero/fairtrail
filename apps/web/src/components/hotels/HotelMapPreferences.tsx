'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DEFAULT_HOTEL_MAP_PREFERENCES, HOTEL_MAP_STYLES, HOTEL_MAP_BROWSER_PREFERENCES_KEY, validateHotelMapPreferences, type HotelMapPreferences as MapPreferences } from '@/lib/hotels/map-config';
import { hotelRequest } from './client';
import styles from './Hotels.module.css';

export function HotelMapPreferences({ initial, initialRevision = 0, account = true, actorScope, onSaved }: { initial: unknown; initialRevision?: number; account?: boolean; actorScope?: string; onSaved?: (preferences: MapPreferences, revision: number) => void }) {
  const t = useTranslations('Hotels');
  const [loaded] = useState(() => {
    try { return { preferences: initial ? validateHotelMapPreferences(initial) : DEFAULT_HOTEL_MAP_PREFERENCES, invalid: false }; }
    catch { return { preferences: DEFAULT_HOTEL_MAP_PREFERENCES, invalid: true }; }
  });
  const [preferences, setPreferences] = useState(loaded.preferences);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(loaded.invalid ? t('mapSettingsError') : '');
  const [saved, setSaved] = useState(false);
  const [revision, setRevision] = useState(initialRevision);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); }, [actorScope]);
  async function save() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError(''); setSaved(false);
    try {
      if (account) {
        if (!actorScope) throw new Error(t('mapSettingsError'));
        await hotelRequest('/api/account/settings', { method: 'PATCH', headers: { 'X-Hotel-Map-Actor': actorScope }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), body: JSON.stringify({ hotelMapPreferences: preferences, hotelMapPreferencesRevision: revision }) });
      }
      else window.localStorage.setItem(HOTEL_MAP_BROWSER_PREFERENCES_KEY, JSON.stringify(preferences));
      if (controller.signal.aborted) return;
      const nextRevision = account ? revision + 1 : revision;
      setRevision(nextRevision); onSaved?.(preferences, nextRevision); setSaved(true);
    }
    catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t('failed')); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  return <section className={styles.form} aria-label={t('mapTitle')}>
    <h2 className={styles.heading}>{t('mapTitle')}</h2>
    <label className={styles.check}><input type="checkbox" checked={preferences.enabled} disabled={busy} onChange={event => { setPreferences({ ...preferences, enabled: event.target.checked }); setSaved(false); }} />{t('mapPreferenceEnabled')}</label>
    <p className={styles.muted}>{t('mapPreferenceHelp')}</p>
    <label className={styles.field}>{t('mapStyle')}<select value={preferences.style} disabled={busy} onChange={event => { setPreferences(validateHotelMapPreferences({ ...preferences, style: event.target.value })); setSaved(false); }}>{HOTEL_MAP_STYLES.map(style => <option key={style} value={style}>{style}</option>)}</select></label>
    {error && <><p className={styles.error} role="alert">{error}</p>{account && <button type="button" className={styles.secondary} onClick={() => window.location.reload()}>{t('mapReloadPreferences')}</button>}</>}
    {saved && <p role="status">{t('savedChanges')}</p>}
    <div className={styles.actions}><button type="button" className={styles.button} disabled={busy} onClick={() => void save()}>{t('mapSavePreferences')}</button></div>
  </section>;
}

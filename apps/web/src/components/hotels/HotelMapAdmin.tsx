'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DEFAULT_HOTEL_MAP_CONFIG, validateHotelMapConfig, type HotelMapConfig } from '@/lib/hotels/map-config';
import { hotelRequest } from './client';
import styles from './Hotels.module.css';

interface SavedSettings { revision: number; config: HotelMapConfig; actorScope: string }
export function HotelMapAdmin() {
  const t = useTranslations('Hotels');
  const failed = t('failed');
  const [saved, setSaved] = useState<SavedSettings | null>(null);
  const [draft, setDraft] = useState<HotelMapConfig>(DEFAULT_HOTEL_MAP_CONFIG);
  const [origins, setOrigins] = useState(DEFAULT_HOTEL_MAP_CONFIG.resourceOrigins.join('\n'));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const mutation = useRef<AbortController | null>(null);
  useEffect(() => () => mutation.current?.abort(), []);
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    hotelRequest<SavedSettings>('/api/admin/hotel-map', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) }).then(value => {
      if (disposed) return;
      const config = validateHotelMapConfig(value.config);
      setSaved({ ...value, config }); setDraft(config); setOrigins(config.resourceOrigins.join('\n'));
    }).catch(failure => { if (!disposed) setError(failure instanceof Error ? failure.message : failed); });
    return () => { disposed = true; controller.abort(); };
  }, [attempt, failed]);
  async function save() {
    if (!saved) return;
    mutation.current?.abort();
    const controller = new AbortController();
    mutation.current = controller;
    setBusy(true); setError(''); setMessage('');
    try {
      const config = validateHotelMapConfig({ ...draft, resourceOrigins: origins.split('\n').map(value => value.trim()).filter(Boolean) });
      const next = await hotelRequest<SavedSettings>('/api/admin/hotel-map', { method: 'PATCH', headers: { 'X-Hotel-Map-Actor': saved.actorScope }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]), body: JSON.stringify({ config, revision: saved.revision }) });
      if (controller.signal.aborted) return;
      setSaved(next); setDraft(next.config); setOrigins(next.config.resourceOrigins.join('\n')); setMessage(t('savedChanges'));
    } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t('failed')); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  const fields = ['styleUrl', 'providerName', 'privacyUrl', 'attribution', 'attributionUrl'] as const;
  return <section className={styles.form} aria-label={t('mapAdminTitle')}>
    <h2 className={styles.heading}>{t('mapAdminTitle')}</h2><p className={styles.muted}>{t('mapAdminHelp')}</p>
    {!saved && !error && <p role="status">{t('loading')}</p>}
    {saved && <fieldset disabled={busy}><label className={styles.check}><input type="checkbox" checked={draft.enabled} onChange={event => setDraft({ ...draft, enabled: event.target.checked })} />{t('mapPreferenceEnabled')}</label>
      <label className={styles.field}>{t('mapProvider')}<select value={draft.provider} onChange={event => setDraft(event.target.value === 'openfreemap' ? { ...DEFAULT_HOTEL_MAP_CONFIG, enabled: draft.enabled } : { ...draft, provider: 'custom' })}><option value="openfreemap">OpenFreeMap</option><option value="custom">{t('mapCustom')}</option></select></label>
      {draft.provider === 'custom' && <div className={styles.grid}>{fields.map(field => <label key={field} className={styles.field}>{t(`mapConfig_${field}`)}<input value={draft[field]} maxLength={field === 'providerName' ? 80 : field === 'attribution' ? 300 : 2048} onChange={event => setDraft({ ...draft, [field]: event.target.value })} /></label>)}<label className={`${styles.field} ${styles.wide}`}>{t('mapOrigins')}<textarea rows={3} value={origins} maxLength={16384} onChange={event => setOrigins(event.target.value)} /></label></div>}
      <div className={styles.actions}><button type="button" className={styles.button} onClick={() => void save()}>{t('mapSaveConfig')}</button></div>
    </fieldset>}
    {error && <div role="alert" className={styles.error}><p>{error}</p><button type="button" className={styles.secondary} disabled={busy} onClick={() => { setError(''); setMessage(''); setSaved(null); setAttempt(value => value + 1); }}>{t('mapReloadConfig')}</button></div>}
    {message && <p role="status">{message}</p>}
  </section>;
}

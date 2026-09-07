'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { carRecord, carText } from '@/lib/cars/validation';
import { formatCarMoney } from '@/lib/cars/money';
import { travelRequest } from '../travel/client';
import { CarTrackingOptions } from './CarTrackingOptions';
import { carOptionsFromDraft, carOptionsToDraft } from './presentation';
import type { useCarTracker } from './useCarTracker';
import styles from './Cars.module.css';

type Controller = ReturnType<typeof useCarTracker>;
export function CarManagement({ controller }: { controller: Controller }) {
  const t = useTranslations('Cars'), locale = useLocale(), id = useId();
  const { detail: { tracker }, locked, pending, phase } = controller;
  const [base, setBase] = useState(tracker), [options, setOptions] = useState(() => carOptionsToDraft(tracker.options, locale)), [label, setLabel] = useState(tracker.label), [invalid, setInvalid] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null), confirmButton = useRef<HTMLButtonElement>(null);
  const changed = tracker.revision !== base.revision;
  useEffect(() => { if (confirming !== null) confirmButton.current?.focus(); }, [confirming]);
  function reload() { setBase(tracker); setOptions(carOptionsToDraft(tracker.options, locale)); setLabel(tracker.label); setInvalid(false); }
  function save() {
    if (changed || locked) return;
    try {
      const normalized = carOptionsFromDraft(options, tracker.currency, locale), editedLabel = label === base.label ? undefined : carText(label, 250, 'tracker label');
      setInvalid(false); void controller.mutate({ kind: 'settings', options: normalized, ...(editedLabel === undefined ? {} : { label: editedLabel }) }, base.revision);
    } catch { setInvalid(true); }
  }
  return <section className={`${styles.historySection} ${styles.management}`} aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>{t('manageTracker')}</h2>
    <p className={styles.hint}>{t('editCancelsCheck')}</p>
    {pending && <div className={styles.notice}><h3>{t('pendingAction')}</h3><p>{t(pending.action.kind === 'delete' ? 'deleteTracker' : pending.action.kind === 'active' ? pending.action.active ? 'resumeTracker' : 'pauseTracker' : pending.action.kind === 'owner' ? 'reassignTracker' : 'saveSettings')}</p>
      {pending.action.kind === 'settings' && <dl className={styles.terms}><div><dt>{t('target', { currency: tracker.currency })}</dt><dd>{pending.action.options.target ? formatCarMoney(pending.action.options.target, locale) : t('noTarget')}</dd></div><div><dt>{t('interval')}</dt><dd>{pending.action.options.scrapeInterval}</dd></div><div><dt>{t('notifyLows')}</dt><dd>{t(pending.action.options.notifyLows ? 'yes' : 'no')}</dd></div>{pending.action.label !== undefined && <div><dt>{t('trackerLabel')}</dt><dd>{pending.action.label}</dd></div>}</dl>}
      {pending.action.kind === 'owner' && <p>{pending.action.userId}</p>}
      <p>{t(phase === 'conflict' ? 'managementConflict' : 'managementUncertain')}</p>
      <div className={styles.actions}>{phase === 'conflict' ? <button className={styles.secondary} disabled={controller.busy} onClick={controller.acceptCurrent}>{t('acceptCurrentSettings')}</button> : <button className={styles.secondary} disabled={controller.busy || controller.hidden} onClick={() => void controller.retry()}>{t('recoverAction')}</button>}</div>
      {phase !== 'conflict' && <><p>{t('closePendingHelp')}</p><button type="button" className={styles.secondary} disabled={controller.busy || controller.hidden} onClick={() => void controller.recoverStorage()}>{t('closePending')}</button></>}
    </div>}
    {phase === 'storage_error' && <p role="alert" className={styles.error}>{t('managementStorageError')}</p>}
    {phase === 'storage_error' && !pending && <div className={styles.notice}><p>{t('recoverStorageHelp')}</p><button type="button" className={styles.secondary} disabled={controller.busy || controller.hidden} onClick={() => void controller.recoverStorage()}>{t('recoverStorage')}</button></div>}
    {controller.error && <p role="alert" className={styles.error}>{controller.error}</p>}
    {controller.notice && <p role="status" className={styles.notice}>{t(controller.notice)}</p>}
    <div className={styles.actions}><button type="button" className={styles.secondary} disabled={locked} onClick={() => void controller.mutate({ kind: 'active', active: !tracker.active })}>{t(tracker.active ? 'pauseTracker' : 'resumeTracker')}</button><button type="button" className={styles.secondary} disabled={locked} onClick={() => setConfirming(tracker.revision)}>{t('deleteTracker')}</button></div>
    {confirming !== null && <div className={styles.notice} role="group" aria-label={t('confirmDeleteTitle')}><h3>{t('confirmDeleteTitle')}</h3><p>{t('confirmDeleteHelp')}</p>{confirming !== tracker.revision && <p role="alert">{t('settingsChanged')}</p>}<div className={styles.actions}><button ref={confirmButton} type="button" className={styles.button} disabled={locked || confirming !== tracker.revision} onClick={() => { const revision = confirming; setConfirming(null); void controller.mutate({ kind: 'delete' }, revision); }}>{t('confirmDelete')}</button><button type="button" className={styles.secondary} onClick={() => setConfirming(null)}>{t('keepTracker')}</button></div></div>}
    <form onSubmit={event => { event.preventDefault(); save(); }}>
      <label className={styles.field}>{t('trackerLabel')}<input value={label} disabled={locked || changed} maxLength={Math.max(250, base.label.length)} onChange={event => setLabel(event.target.value)} /></label>
      <CarTrackingOptions value={options} currency={tracker.currency} disabled={locked || changed} invalid={invalid} onChange={setOptions} edit />
      {invalid && <p role="alert" className={styles.error}>{t('invalidTrackerLabel')}</p>}
      {changed && <div className={styles.notice}><p>{t('settingsChanged')}</p><button className={styles.secondary} type="button" disabled={locked} onClick={reload}>{t('loadCurrentSettings')}</button></div>}
      <button className={styles.button} disabled={locked || changed}>{t('saveSettings')}</button>
    </form>
    {controller.detail.canReassign && <CarOwner controller={controller} />}
  </section>;
}

function CarOwner({ controller }: { controller: Controller }) {
  const t = useTranslations('Cars');
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]), [owner, setOwner] = useState(''), [error, setError] = useState(false), [loading, setLoading] = useState(false), [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const aborter = new AbortController(); let disposed = false;
    setLoading(true); setError(false);
    const timeout = setTimeout(() => aborter.abort(), 15_000);
    void travelRequest<unknown>('/api/admin/users', { signal: aborter.signal, cache: 'no-store' }).then(raw => {
      const value = carRecord(raw);
      if (!Array.isArray(value.users) || value.users.length > 10000) throw new Error('Invalid account list');
      const next = value.users.map(raw => { const user = carRecord(raw); return { id: carText(user.id, 200, 'account'), name: carText(user.displayName || user.username, 250, 'account name') }; });
      if (!disposed && !aborter.signal.aborted) setUsers(next);
    }).catch(() => { if (!disposed) setError(true); }).finally(() => { clearTimeout(timeout); if (!disposed) setLoading(false); });
    return () => { disposed = true; clearTimeout(timeout); aborter.abort(); };
  }, [attempt]);
  return <form onSubmit={event => { event.preventDefault(); if (owner && users.some(user => user.id === owner)) void controller.mutate({ kind: 'owner', userId: owner }); }}>
    <h3>{t('reassignTracker')}</h3><p className={styles.hint}>{t('reassignHelp')}</p>
    {error && <p role="alert" className={styles.error}>{t('usersUnavailable')} <button type="button" className={styles.secondary} disabled={loading || controller.locked} onClick={() => setAttempt(value => value + 1)}>{t('retryUsers')}</button></p>}
    <label className={styles.field}>{t('trackerOwner')}<select value={owner} disabled={controller.locked || loading || error} required onChange={event => setOwner(event.target.value)}><option value="" disabled>{t('chooseOwner')}</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label>
    <button className={styles.secondary} disabled={controller.locked || loading || error || !owner || owner === controller.detail.tracker.userId}>{t('reassignTracker')}</button>
  </form>;
}

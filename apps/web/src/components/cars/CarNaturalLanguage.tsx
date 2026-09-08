'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { validateCarParseDraft, type CarParseDraft } from '@/lib/cars/parse-draft';
import { travelRequest } from '../travel/client';
import styles from './CarNaturalLanguage.module.css';

export function CarNaturalLanguage({ disabled, onBusy, onApply }: { disabled: boolean; onBusy: (busy: boolean) => void; onApply: (draft: CarParseDraft) => void }) {
  const t = useTranslations('Cars.Draft'), locale = useLocale(), id = useId();
  const [text, setText] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [draft, setDraft] = useState<CarParseDraft | null>(null);
  const request = useRef<{ controller: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null), generation = useRef(0);
  useEffect(() => {
    setDraft(null); setError(''); setBusy(false); onBusy(false);
    return () => { generation.current++; clearTimeout(request.current?.timer); request.current?.controller.abort(); request.current = null; onBusy(false); };
  }, [locale, onBusy]);
  useEffect(() => {
    if (!disabled) return;
    generation.current++; clearTimeout(request.current?.timer); request.current?.controller.abort(); request.current = null;
    setBusy(false); setDraft(null); onBusy(false);
  }, [disabled, onBusy]);

  function cancel(message = t('cancelled')) {
    generation.current++; clearTimeout(request.current?.timer); request.current?.controller.abort(); request.current = null;
    setBusy(false); onBusy(false); setError(message);
  }
  async function prepare() {
    if (disabled || request.current || !text.trim()) return;
    const controller = new AbortController(), current = ++generation.current;
    const timer = setTimeout(() => { if (generation.current === current) cancel(t('timedOut')); }, 280_000);
    request.current = { controller, timer };
    setBusy(true); onBusy(true); setError(''); setDraft(null);
    try {
      const result = await travelRequest<{ draft: unknown }>('/api/cars/parse', { method: 'POST', body: JSON.stringify({ text, locale }), signal: controller.signal });
      if (generation.current !== current || controller.signal.aborted) return;
      if (!result || !result.draft || typeof result.draft !== 'object' || Array.isArray(result.draft)) throw new Error('Invalid rental draft response');
      setDraft(validateCarParseDraft(result.draft));
    } catch {
      if (generation.current === current) setError(t(controller.signal.aborted ? 'timedOut' : 'failed'));
    } finally {
      clearTimeout(timer);
      if (generation.current === current) { request.current = null; setBusy(false); onBusy(false); }
    }
  }
  return <section className={styles.root} aria-labelledby={`${id}-heading`}>
    <div><h3 id={`${id}-heading`}>{t('title')}</h3><p id={`${id}-help`}>{t('help')}</p></div>
    <label htmlFor={id}>{t('description')}</label>
    <textarea id={id} rows={3} maxLength={4000} value={text} disabled={disabled || busy} aria-describedby={`${id}-help`} placeholder={t('example')} onChange={event => { setText(event.target.value); setDraft(null); setError(''); }} />
    <div className={styles.actions}><button type="button" disabled={disabled || busy || !text.trim()} onClick={() => void prepare()}>{t(busy ? 'preparing' : 'prepare')}</button>{busy && <button type="button" onClick={() => cancel()}>{t('cancel')}</button>}</div>
    {busy && <p role="status">{t('waiting')}</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {draft && !disabled && <div className={styles.ready} role="status"><p>{t('ready')}</p><button type="button" onClick={() => { onApply(draft); setDraft(null); }}>{t('apply')}</button></div>}
  </section>;
}

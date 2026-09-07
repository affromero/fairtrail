'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { assessCarPrice, MAX_CAR_OFFER_AGE_MS } from '@/lib/cars/pricing';
import { formatCarMoney } from '@/lib/cars/money';
import { CAR_PROVIDER_LABELS } from '@/lib/cars/preferences';
import type { CarOffer, CarSearch, CarSearchReport, CarTrackingOptions as Options } from '@/lib/cars/types';
import { CarOfferRow } from './CarOfferRow';
import { CarTrackingOptions } from './CarTrackingOptions';
import { CarProof, CarRequirements } from './CarEvidenceDetails';
import { carOptionsFromDraft, defaultCarOptionsDraft, safeCarLink } from './presentation';
import { useCarCreation } from './useCarCreation';
import styles from './Cars.module.css';

function useOfferClock(offers: CarOffer[]) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    function update() {
      clearTimeout(timer); const current = Date.now(); setNow(current);
      const next = Math.min(...offers.map(offer => Date.parse(offer.observedAt) + MAX_CAR_OFFER_AGE_MS + 1).filter(deadline => deadline > current));
      if (Number.isFinite(next)) timer = setTimeout(update, next - current);
    }
    update(); window.addEventListener('focus', update); document.addEventListener('visibilitychange', update);
    return () => { clearTimeout(timer); window.removeEventListener('focus', update); document.removeEventListener('visibilitychange', update); };
  }, [offers]);
  return now;
}

export function CarResults({ actorScope, searchId, search, report, status }: { actorScope: string; searchId: string; search: CarSearch; report: CarSearchReport; status: string }) {
  const t = useTranslations('Cars'), locale = useLocale(), now = useOfferClock(report.offers), creation = useCarCreation(actorScope, searchId);
  const [draft, setDraft] = useState(defaultCarOptionsDraft), [localError, setLocalError] = useState('');
  const complete = status === 'success' || status === 'partial', running = status === 'queued' || status === 'running';
  let options: Options | null = null;
  try { options = carOptionsFromDraft(draft, search.currency, locale); } catch { /* The form explains invalid input below. */ }
  const assessments = report.offers.map(offer => assessCarPrice(offer, search, new Date(now)));
  const pendingOffer = report.offers.find(offer => offer.id === creation.pending?.body.offerId);
  async function track(offer: CarOffer) {
    if (!complete || !options || creation.locked) return;
    if (!assessCarPrice(offer, search).eligible) { setLocalError(t('expired')); return; }
    setLocalError(''); await creation.create(offer.id, options);
  }
  return <section className={styles.root} aria-label={t('results')}>
    <header className={styles.resultsHeader}><div><p className={styles.eyebrow}>{t('rentalDesk')}</p><h2>{t('results')}</h2></div><p className={styles.hint}>{t('scope')}</p></header>
    <ol className={styles.progress} aria-label={t('providerProgress')}>{search.sources.map(source => {
      const provider = report.providers.find(entry => entry.source === source);
      return <li key={source}><strong>{CAR_PROVIDER_LABELS[source]}</strong><span>{t(provider?.status ?? 'queued')}</span>{provider && <span>{t('checked', { checked: provider.checked, visible: provider.discoveredVisible })}{provider.truncated && ` · ${t('limited', { count: provider.limit })}`}</span>}</li>;
    })}</ol>
    {running && <p role="status" className={styles.notice}>{t('searching')}</p>}
    {(status === 'cancelled' || status === 'failed') && <p role="status" className={styles.notice}>{t(status)}</p>}
    {report.errors.map((entry, index) => <p key={`${entry.source}-${index}`} role="alert" className={styles.error}>{CAR_PROVIDER_LABELS[entry.source]}: {entry.message}</p>)}
    {(localError || creation.error) && <p role="alert" className={styles.error}>{localError || creation.error}</p>}
    {creation.phase === 'sending' && <p role="status" className={styles.notice}>{t('saving')}</p>}
    {creation.phase === 'uncertain' && <div role="alert" className={styles.notice}><h3>{t('uncertainTitle')}</h3><p>{t('uncertainHelp')}</p><button type="button" className={styles.button} onClick={() => void creation.retry()}>{t('retryCreation')}</button></div>}
    {creation.phase === 'storage_error' && <p role="alert" className={styles.error}>{t('storageError')}</p>}
    {creation.phase === 'created' && creation.trackerId && <div role="status" className={styles.notice}><h3>{t('created')}</h3><Link className={styles.button} href={`/cars/${encodeURIComponent(creation.trackerId)}`}>{t('openTracker')}</Link></div>}
    {creation.pending && <dl className={styles.terms} aria-label={t('pendingSettings')}><div><dt>{t('selectedOffer')}</dt><dd>{pendingOffer && `${pendingOffer.supplier} · ${pendingOffer.contract.model} · `}{creation.pending.body.offerId}</dd></div><div><dt>{t('mode')}</dt><dd>{t(creation.pending.body.mode)}</dd></div><div><dt>{t('target', { currency: search.currency })}</dt><dd>{creation.pending.body.target ? formatCarMoney(creation.pending.body.target, locale) : t('noTarget')}</dd></div><div><dt>{t('interval')}</dt><dd>{creation.pending.body.scrapeInterval}</dd></div><div><dt>{t('notifyLows')}</dt><dd>{t(creation.pending.body.notifyLows ? 'yes' : 'no')}</dd></div></dl>}
    {report.offers.length > 0 && <>{!creation.pending && <CarTrackingOptions value={draft} currency={search.currency} disabled={creation.locked || !complete} invalid={options === null} onChange={setDraft} />}
      <div className={styles.offers}>{report.offers.map((offer, index) => <CarOfferRow key={offer.id} offer={offer} search={search} assessment={assessments[index]!} disabled={creation.locked || !complete || options === null} onTrack={() => void track(offer)} />)}</div></>}
    {!running && !report.offers.length && <p className={styles.notice}>{t('noVerified')}</p>}
    {report.candidates.length > 0 && <section className={styles.candidates} aria-label={t('candidates')}><h3>{t('candidates')}</h3><p className={styles.hint}>{t('candidateHelp')}</p>{report.candidates.map((candidate, index) => {
      const booking = safeCarLink(candidate.bookingUrl, candidate.source);
      return <article key={`${candidate.source}-${index}`} className={styles.candidate}><p className={styles.eyebrow}>{CAR_PROVIDER_LABELS[candidate.source]}{candidate.supplier && ` · ${candidate.supplier}`}</p><h4>{candidate.model ?? t('unknownVehicle')}</h4>
        {candidate.advertisedTotal?.value && <p className={styles.candidatePrice}>{formatCarMoney(candidate.advertisedTotal.value, locale)} <span>{t('advertised')}</span></p>}
        <ul>{candidate.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
        {candidate.advertisedTotal && <CarProof label={t('advertised')} evidence={candidate.advertisedTotal} source={candidate.source} />}
        {candidate.requirements.length > 0 && <CarRequirements requirements={candidate.requirements} source={candidate.source} />}
        {booking && <a className={styles.secondary} href={booking} target="_blank" rel="noopener noreferrer">{t('viewProvider')}</a>}
      </article>;
    })}</section>}
  </section>;
}

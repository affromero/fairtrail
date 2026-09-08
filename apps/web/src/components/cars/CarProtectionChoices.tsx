'use client';
import { useId, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { formatCarMoney } from '@/lib/cars/money';
import { carProtectionPolicyUrl } from '@/lib/cars/protection-choice';
import type { CarProtectionDiscovery } from '@/lib/cars/protection-discovery';
import type { CarOffer } from '@/lib/cars/types';
import styles from './Cars.module.css';

export function CarProtectionChoices({ discovery, disabled, onRequest }: { discovery?: CarProtectionDiscovery; disabled: boolean; onRequest: (choiceId: string) => void }) {
  const t = useTranslations('Cars.Protection'), locale = useLocale(), id = useId();
  const [selected, setSelected] = useState(''), [reviewed, setReviewed] = useState('');
  const choice = discovery?.choices.find(choice => choice.id === selected);
  const identity = choice ? JSON.stringify(choice) : '';
  return <details className={styles.details}>
    <summary>{t('options')}</summary>
    <div className={styles.protection}>
      <p className={styles.hint}>{t('help')}</p>
      {!discovery && <p>{t('unchecked')}</p>}
      {discovery?.status === 'failed' && <p>{t('failed')}</p>}
      {discovery?.status === 'complete' && !discovery.choices.length && <p>{t('empty')}</p>}
      {discovery?.status === 'complete' && discovery.choices.length > 0 && <>
        <fieldset className={styles.protectionOptions} disabled={disabled}><legend>{t('choose')}</legend>
          {discovery.choices.map(option => <label key={option.id} className={styles.protectionOption}>
            <input type="radio" name={`${id}-product`} value={option.id} checked={selected === option.id} onChange={() => { setSelected(option.id); setReviewed(''); }} />
            <span><strong>{option.name}</strong><span className={styles.hint}>{t('observedExtra', { price: formatCarMoney(option.observedExtraPrice, locale) })}</span></span>
          </label>)}
        </fieldset>
        {choice && <section aria-label={t('terms')} className={styles.protectionTerms}>
          <h4>{choice.name}</h4><p className={styles.evidenceText}>{choice.termsSummary}</p>
          <p className={styles.hint}>{t('observedAt')} <time dateTime={choice.observedAt}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(choice.observedAt))} UTC</time></p>
          <div className={styles.actions}>{choice.policyLinks.map((url, index) => {
            let href: string; try { href = carProtectionPolicyUrl(url, choice.source); } catch { return null; }
            return <a key={url} className={styles.secondary} href={href} target="_blank" rel="noopener noreferrer">{t('policy', { number: index + 1 })}</a>;
          })}</div>
          <label className={styles.check}><input type="checkbox" checked={reviewed === identity} disabled={disabled} onChange={event => setReviewed(event.target.checked ? identity : '')} />{t('reviewOption')}</label>
        </section>}
        <p className={styles.hint}>{t('recheckHelp')}</p>
        <button type="button" className={styles.secondary} disabled={disabled || !choice || reviewed !== identity} onClick={() => { if (choice && reviewed === identity && !disabled) onRequest(choice.id); }}>{t('recheck')}</button>
      </>}
    </div>
  </details>;
}

export function CarProtectionReview({ offer, reviewed, disabled, onReview }: { offer: CarOffer; reviewed: boolean; disabled: boolean; onReview: (checked: boolean) => void }) {
  const t = useTranslations('Cars.Protection');
  return <section className={styles.protection} aria-label={t('freshTerms')}>
    <h4>{t('freshTerms')}</h4><p className={styles.hint}>{t('freshHelp')}</p>
    {offer.extras.filter(extra => extra.kind === 'protection').map(extra => <div key={extra.productId}>
      <h5>{extra.availability.text}</h5><p className={styles.evidenceText}>{extra.eligibility.text}</p>
    </div>)}
    <label className={styles.check}><input type="checkbox" checked={reviewed} disabled={disabled} onChange={event => onReview(event.target.checked)} />{t('reviewFresh')}</label>
  </section>;
}

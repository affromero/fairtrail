'use client';
import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { carDecimalSeparator, type CarOptionsDraft } from './presentation';
import { currencyPrecision } from '@/lib/cars/money';
import styles from './Cars.module.css';

export function CarTrackingOptions({ value, currency, disabled, invalid, onChange, edit = false }: { value: CarOptionsDraft; currency: string; disabled: boolean; invalid: boolean; onChange: (value: CarOptionsDraft) => void; edit?: boolean }) {
  const t = useTranslations('Cars'), locale = useLocale(), id = useId();
  const precision = currencyPrecision(currency), example = `1234${precision ? carDecimalSeparator(locale) + '5'.repeat(precision) : ''}`;
  return <fieldset className={styles.options} disabled={disabled} aria-describedby={`${id}-help${invalid ? ` ${id}-error` : ''}`}>
    <legend>{t('tracking')}</legend>
    <div className={styles.fields}>
      {edit ? <div className={styles.field}><span>{t('mode')}</span><p>{t(value.mode)}</p></div> : <label className={styles.field}>{t('mode')}<select value={value.mode} onChange={e => onChange({ ...value, mode: e.target.value as CarOptionsDraft['mode'] })}><option value="best">{t('best')}</option><option value="contract">{t('contract')}</option></select></label>}
      <div className={styles.field}><label htmlFor={`${id}-target`}>{t('target', { currency })}</label><input id={`${id}-target`} type="text" inputMode="decimal" maxLength={24} value={value.target} aria-describedby={`${id}-decimal`} onChange={e => onChange({ ...value, target: e.target.value })} /><span id={`${id}-decimal`} className={styles.hint}>{t('decimalHelp', { example })}</span></div>
      <label className={styles.field}>{t('interval')}<input type="number" min="1" max="24" step="1" required value={value.interval} onChange={e => onChange({ ...value, interval: e.target.value })} /></label>
    </div>
    <label className={styles.check}><input type="checkbox" checked={value.notifyLows} onChange={e => onChange({ ...value, notifyLows: e.target.checked })} />{t('notifyLows')}</label>
    <p id={`${id}-help`} className={styles.hint}>{t(value.mode === 'best' ? 'bestHelp' : 'contractHelp')}</p>
    {invalid && <p id={`${id}-error`} role="alert" className={styles.error}>{t('invalidOptions')}</p>}
  </fieldset>;
}

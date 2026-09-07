'use client';
import { useId, useLayoutEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { CAR_SOURCES, type CarSource } from '@/lib/cars/types';
import { CAR_PROVIDER_LABELS, effectiveCarProviders } from '@/lib/cars/preferences';
import styles from './CarProviderPicker.module.css';

export function CarProviderPicker({ value, onChange, disabled = false }: { value: CarSource[]; onChange: (value: CarSource[]) => void; disabled?: boolean }) {
  const t = useTranslations('AccountSettings'), hint = useId();
  const selected = effectiveCarProviders(value);
  const order = [...selected, ...CAR_SOURCES.filter(source => !selected.includes(source))];
  const inputs = useRef<Partial<Record<CarSource, HTMLInputElement | null>>>({});
  const focusAfterMove = useRef<CarSource | null>(null);
  useLayoutEffect(() => {
    if (focusAfterMove.current) inputs.current[focusAfterMove.current]?.focus();
    focusAfterMove.current = null;
  }, [value]);
  function move(source: CarSource, delta: -1 | 1) {
    const next = [...selected], index = next.indexOf(source), target = index + delta;
    if (index < 0 || target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    focusAfterMove.current = source;
    onChange(next);
  }
  return <fieldset className={styles.root} disabled={disabled} aria-describedby={hint}>
    <legend>{t('carProviderPreference')}</legend>
    <p id={hint} className={styles.hint}>{t(value.length ? 'carProviderExplicit' : 'carProviderInherited')}</p>
    <ol className={styles.list}>{order.map(source => {
      const index = selected.indexOf(source), checked = index >= 0, name = CAR_PROVIDER_LABELS[source];
      return <li key={source} className={styles.row}>
        <label className={styles.choice}><input ref={element => { inputs.current[source] = element; }} type="checkbox" checked={checked} disabled={checked && selected.length === 1}
          onChange={() => onChange(checked ? selected.filter(value => value !== source) : [...selected, source])} />{name}</label>
        <div className={styles.moves}><button type="button" onClick={() => move(source, -1)} disabled={!checked || index === 0} aria-label={t('moveUp', { name })}>↑</button><button type="button" onClick={() => move(source, 1)} disabled={!checked || index === selected.length - 1} aria-label={t('moveDown', { name })}>↓</button></div>
      </li>;
    })}</ol>
    <p className={styles.hint}>{t('carProviderMinimum')}</p>
    <button type="button" className={styles.reset} disabled={!value.length} onClick={() => onChange([])}>{t('carProviderReset')}</button>
  </fieldset>;
}

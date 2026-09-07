'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { validateCarLocationChoice, type CarLocationChoice } from '@/lib/cars/location-types';
import { travelRequest } from '../travel/client';
import styles from './CarSearchForm.module.css';

export function CarLocationInput({ label, value, onChange, initialQuery = '' }: { label: string; value: CarLocationChoice | null; onChange: (value: CarLocationChoice | null) => void; initialQuery?: string }) {
  const t = useTranslations('Cars.Search'), locale = useLocale(), id = useId();
  const [query, setQuery] = useState(value?.name ?? initialQuery), [options, setOptions] = useState<CarLocationChoice[]>([]);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [active, setActive] = useState(-1);
  const generation = useRef(0), chosen = useRef(value);
  useEffect(() => {
    if (chosen.current?.id === value?.id) return;
    chosen.current = value; setQuery(value?.name ?? ''); setOptions([]); setOpen(false);
  }, [value]);
  useEffect(() => {
    const current = ++generation.current, controller = new AbortController();
    if (value || query.trim().length < 2) { setBusy(false); setOptions([]); return; }
    setBusy(true); setError('');
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const timer = setTimeout(() => {
      void travelRequest<unknown>(`/api/cars/locations?q=${encodeURIComponent(query)}`, { signal: controller.signal, cache: 'no-store' }).then(raw => {
        if (current !== generation.current) return;
        if (!Array.isArray(raw) || raw.length > 12) throw new Error('Invalid location response');
        const next = raw.map(validateCarLocationChoice);
        if (new Set(next.map(place => place.id)).size !== next.length) throw new Error('Duplicate location suggestions');
        setOptions(next); setOpen(true); setActive(-1);
      }).catch(() => { if (current === generation.current) { setError(t('locationsFailed')); setOptions([]); } })
        .finally(() => { if (current === generation.current) setBusy(false); });
    }, 250);
    return () => { generation.current++; clearTimeout(timer); clearTimeout(timeout); controller.abort(); };
  }, [query, value, t]);
  const choose = (place: CarLocationChoice) => { chosen.current = place; onChange(place); setQuery(place.name); setOpen(false); setOptions([]); setError(''); };
  const regionNames = new Intl.DisplayNames([locale], { type: 'region' });
  return <div className={styles.location} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <label htmlFor={id}>{label}</label>
    <input id={id} role="combobox" autoComplete="off" required maxLength={100} value={query} aria-autocomplete="list" aria-expanded={open && options.length > 0} aria-controls={`${id}-options`} aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined} aria-describedby={`${id}-hint`} onFocus={() => { if (options.length) setOpen(true); }} onChange={event => { chosen.current = null; onChange(null); setQuery(event.target.value); setOpen(true); setActive(-1); }} onKeyDown={event => {
      if (event.key === 'Escape') { setOpen(false); return; }
      if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && options.length) { event.preventDefault(); setOpen(true); setActive(index => index < 0 ? (event.key === 'ArrowDown' ? 0 : options.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length); }
      if (event.key === 'Enter' && open && active >= 0 && options[active]) { event.preventDefault(); choose(options[active]!); }
    }} />
    {open && options.length > 0 && <ul id={`${id}-options`} role="listbox" aria-label={label} className={styles.suggestions}>{options.map((place, index) => <li id={`${id}-${index}`} key={place.id} role="option" aria-selected={index === active} onMouseDown={event => event.preventDefault()} onClick={() => choose(place)}>
      <strong>{place.iata ? `${place.iata} · ` : ''}{place.name}</strong><span>{[place.region, regionNames.of(place.country), t(place.kind)].filter(Boolean).join(' · ')}</span>
    </li>)}</ul>}
    <p id={`${id}-hint`} className={styles.hint} role={busy ? 'status' : undefined}>{value ? `${[value.region, regionNames.of(value.country)].filter(Boolean).join(' · ')} · ${value.timeZone}` : busy ? t('findingLocations') : error || (query.length >= 2 && !options.length ? t('noLocations') : t('chooseLocation'))}</p>
  </div>;
}

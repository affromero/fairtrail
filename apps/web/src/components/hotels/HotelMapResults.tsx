'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { HotelOffer } from '@/lib/hotels/types';
import { hotelMapProperties, hotelMapStayKey, hotelMapStayOffers } from '@/lib/hotels/map-results';
import { DEFAULT_HOTEL_MAP_CONFIG, DEFAULT_HOTEL_MAP_PREFERENCES, HOTEL_MAP_BROWSER_PREFERENCES_KEY, validateHotelMapPreferences, type HotelMapSettings } from '@/lib/hotels/map-config';
import { HotelMapPreferences } from './HotelMapPreferences';
import { HotelOfferCard } from './HotelOfferCard';
import { hotelMoney } from './client';
import styles from './HotelMap.module.css';
import hotelStyles from './Hotels.module.css';

const MapCanvas = dynamic(() => import('./HotelMapCanvas').then(module => module.HotelMapCanvas), { ssr: false });

export function HotelMapResults({ offers, busy, onTrack, settings }: { offers: HotelOffer[]; busy: boolean; onTrack: (id: string) => void; settings?: HotelMapSettings }) {
  const t = useTranslations('Hotels');
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stay, setStay] = useState('');
  const config = settings?.config ?? DEFAULT_HOTEL_MAP_CONFIG;
  const [preferences, setPreferences] = useState(settings?.preferences ?? DEFAULT_HOTEL_MAP_PREFERENCES);
  const [preferencesRevision, setPreferencesRevision] = useState(settings?.preferencesRevision ?? 0);
  const [preferenceError, setPreferenceError] = useState('');
  const preferenceFailure = t('mapSettingsError');
  const account = settings?.account ?? false;
  const enabled = config.enabled && preferences.enabled;
  const [mapStyle, setMapStyle] = useState<string>(preferences.style);
  useEffect(() => {
    if (account) return;
    try {
      const stored = window.localStorage.getItem(HOTEL_MAP_BROWSER_PREFERENCES_KEY);
      if (!stored) return;
      const next = validateHotelMapPreferences(JSON.parse(stored));
      setPreferences(next); setMapStyle(next.style);
    } catch { setPreferenceError(preferenceFailure); }
  }, [account, preferenceFailure]);
  const properties = useMemo(() => hotelMapProperties(offers), [offers]);
  const stays = useMemo(() => [...new Map(offers.map(offer => [hotelMapStayKey(offer), offer])).entries()], [offers]);
  const currentStay = stays.some(([key]) => key === stay) ? stay : stays[0]?.[0] ?? '';
  const pins = useMemo(() => properties.flatMap(property => {
    const matching = hotelMapStayOffers(property, currentStay);
    const cheapest = matching[0];
    if (!cheapest) return [];
    const price = hotelMoney(cheapest.totalPrice, cheapest.currency, locale);
    return [{ property, label: price, totalPrice: cheapest.totalPrice, description: `${property.name} · ${price} · ${cheapest.checkIn} → ${cheapest.checkOut}` }];
  }), [properties, currentStay, locale]);
  const selected = pins.find(pin => pin.property.id === selectedId)?.property;
  const unmapped = offers.filter(offer => !properties.some(property => property.offers.some(candidate => candidate.id === offer.id))).length;
  function focusOffer(id: string) {
    const element = document.getElementById(`hotel-offer-${id}`);
    element?.focus({ preventScroll: true });
    element?.scrollIntoView({ block: 'center', behavior: 'instant' });
  }

  return <div className={`${styles.results} ${open ? styles.split : ''}`}>
    <div className={styles.toolbar}><div><h3>{t('mapTitle')}</h3><p className={hotelStyles.muted}>{t('mapScope')}</p><p className={hotelStyles.muted}>{t('mapProviderPrivacy', { provider: config.providerName })} <a href={config.privacyUrl} target="_blank" rel="noopener noreferrer">{config.providerName}</a></p>{!enabled && <p className={hotelStyles.notice}>{t('mapDisabled')}</p>}{settings?.error && <p role="alert" className={hotelStyles.error}>{settings.error}</p>}</div><button type="button" disabled={!enabled} className={hotelStyles.secondary} aria-expanded={open} onClick={() => setOpen(value => !value)}>{t(open ? 'mapHide' : 'mapOpen')}</button></div>
    <details className={styles.preferences}><summary>{t('mapSavePreferences')}</summary>{preferenceError && <p role="alert" className={hotelStyles.error}>{preferenceError}</p>}<HotelMapPreferences key={JSON.stringify(preferences)} initial={preferences} initialRevision={preferencesRevision} account={account} actorScope={settings?.actorScope} onSaved={(next, revision) => { setPreferences(next); setPreferencesRevision(revision); setMapStyle(next.style); setPreferenceError(''); if (!next.enabled) setOpen(false); }} /></details>
    {open && enabled && <section aria-label={t('mapTitle')} className={styles.mapSection}>
      <div className={styles.controls}>
        <label className={hotelStyles.field}>{t('mapStay')}<select value={currentStay} onChange={event => { setStay(event.target.value); setSelectedId(null); }}>{stays.map(([key, offer]) => <option key={key} value={key}>{offer.checkIn} → {offer.checkOut} · {offer.currency} · {t('roomCount', { count: offer.rooms.length })}</option>)}</select></label>
        {config.provider === 'openfreemap' && <label className={hotelStyles.field}>{t('mapStyle')}<select value={mapStyle} onChange={event => setMapStyle(event.target.value)}><option value="liberty">Liberty</option><option value="positron">Positron</option><option value="bright">Bright</option></select></label>}
      </div>
      {pins.length ? <MapCanvas pins={pins} selectedId={selected?.id ?? null} onSelect={setSelectedId} config={config} styleUrl={config.provider === 'openfreemap' ? `https://tiles.openfreemap.org/styles/${mapStyle}` : config.styleUrl} loadingLabel={t('mapLoading')} errorLabel={t('mapError')} retryLabel={t('mapRetry')} mapLabel={t('mapTitle')} overlapLabel={t('mapOverlap')} closeLabel={t('mapCloseOverlap')} /> : <p role="status" className={hotelStyles.notice}>{t('mapNoLocations')}</p>}
      <p className={hotelStyles.muted}><a href={config.attributionUrl} target="_blank" rel="noopener noreferrer">{config.attribution}</a></p>
      <p className={hotelStyles.muted}>{t('mapPrices')}</p>
      {!!unmapped && <p className={hotelStyles.notice}>{t('mapMissing', { count: unmapped })}</p>}
      <div className={styles.propertyList} aria-label={t('mapProperties')}>{pins.map(pin => <button key={pin.property.id} type="button" aria-pressed={selected?.id === pin.property.id} className={hotelStyles.secondary} onClick={() => setSelectedId(pin.property.id)}>{pin.property.name} · {pin.label}</button>)}</div>
      {selected && <div className={styles.selection}><h3>{selected.name}</h3><p>{t('mapSelected')}</p>{hotelMapStayOffers(selected, currentStay).map(offer => <button type="button" className={hotelStyles.secondary} key={offer.id} onClick={() => focusOffer(offer.id)}>{offer.seller} · {offer.roomName ?? t('unknownRoom')} · {hotelMoney(offer.totalPrice, offer.currency, locale)}</button>)}</div>}
    </section>}
    <div className={`${hotelStyles.offers} ${styles.offerList}`}>{offers.map(offer => {
      const property = properties.find(candidate => candidate.offers.some(entry => entry.id === offer.id));
      return <div key={offer.id} id={`hotel-offer-${offer.id}`} tabIndex={-1} className={selected?.offers.some(candidate => candidate.id === offer.id) ? styles.selectedOffer : undefined}>
        <HotelOfferCard offer={offer} busy={busy} onTrack={() => onTrack(offer.id)} />
        {property && enabled && <button type="button" className={hotelStyles.secondary} aria-pressed={open && selected?.id === property.id} onClick={() => { setStay(hotelMapStayKey(offer)); setSelectedId(property.id); setOpen(true); }}>{t('mapShowHotel')}</button>}
      </div>;
    })}</div>
  </div>;
}

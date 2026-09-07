'use client';
import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { CAR_SOURCES, CHILD_SEAT_CATEGORIES, type CarSource } from '@/lib/cars/types';
import type { CarLocationChoice } from '@/lib/cars/location-types';
import { CAR_PROVIDER_LABELS } from '@/lib/cars/preferences';
import { carMoneyFromDraft } from './presentation';
import { validateCarSearch } from '@/lib/cars/validation';
import { CarLocationInput } from './CarLocationInput';
import { useCarSearchCreation } from './useCarSearchCreation';
import type { CarFormOptions } from '@/lib/cars/form-options';
import styles from './CarSearchForm.module.css';

interface DriverDraft { age: string; licenceYears: string; residenceCountry: string }
const blankDriver = (): DriverDraft => ({ age: '', licenceYears: '', residenceCountry: '' });

export function CarSearchForm({ actorScope, defaultCurrency, defaultSources, options }: { actorScope: string; defaultCurrency: string; defaultSources: CarSource[]; options: CarFormOptions }) {
  const t = useTranslations('Cars.Search'), car = useTranslations('Cars'), locale = useLocale();
  const creation = useCarSearchCreation(actorScope);
  const [pickup, setPickup] = useState<CarLocationChoice | null>(null), [dropoff, setDropoff] = useState<CarLocationChoice | null>(null), [same, setSame] = useState(true);
  const [pickupAt, setPickupAt] = useState({ date: '', time: '' }), [dropoffAt, setDropoffAt] = useState({ date: '', time: '' });
  const [driver, setDriver] = useState(blankDriver), [drivers, setDrivers] = useState<DriverDraft[]>([]);
  const [currency, setCurrency] = useState(defaultCurrency), [sources, setSources] = useState(defaultSources);
  const [seats, setSeats] = useState({ infant: 0, child: 0, booster: 0 });
  const [transmission, setTransmission] = useState('any'), [minSeats, setMinSeats] = useState('4'), [maxTotal, setMaxTotal] = useState('');
  const [unlimited, setUnlimited] = useState(false), [cancellation, setCancellation] = useState(false), [error, setError] = useState('');
  const [discardConfirmed, setDiscardConfirmed] = useState(false);
  const countryOptions = options.countries;
  const driverFields = (value: DriverDraft, update: (next: DriverDraft) => void) => <div className={styles.driverGrid}>
    <label>{t('driverAge')}<input required type="number" min="18" max="99" value={value.age} onChange={event => update({ ...value, age: event.target.value })} /></label>
    <label>{t('licenceYears')}<input required type="number" min="0" max={value.age ? Math.max(0, Number(value.age) - 16) : 83} value={value.licenceYears} onChange={event => update({ ...value, licenceYears: event.target.value })} /></label>
    <label>{t('residence')}<select required value={value.residenceCountry} onChange={event => update({ ...value, residenceCountry: event.target.value })}><option value="">{t('chooseCountry')}</option>{countryOptions.map(country => <option key={country.code} value={country.code}>{country.name}</option>)}</select></label>
  </div>;
  async function submit() {
    setError('');
    try {
      const destination = same ? pickup : dropoff;
      if (!pickup || !destination) throw new Error(t('chooseLocation'));
      const location = (place: CarLocationChoice) => ({ name: place.name, country: place.country, timeZone: place.timeZone, providerIds: {}, catalog: { id: place.id, version: place.version } });
      const confirmedDriver = (value: DriverDraft) => {
        if (!value.age || !value.licenceYears || !value.residenceCountry) throw new Error(t('driverRequired'));
        return { ...value, age: Number(value.age), licenceYears: Number(value.licenceYears) };
      };
      const body = { pickup: { id: pickup.id, version: pickup.version }, dropoff: { id: destination.id, version: destination.version }, pickupAt, dropoffAt, driver: confirmedDriver(driver), currency, sources,
        extras: { childSeats: CHILD_SEAT_CATEGORIES.filter(category => seats[category] > 0).map(category => ({ category, quantity: seats[category] })), additionalDrivers: drivers.map(confirmedDriver), protection: [] },
        filters: { transmission, minSeats: Number(minSeats), unlimitedMileage: unlimited, freeCancellation: cancellation, maxTotal: carMoneyFromDraft(maxTotal, currency, locale) } };
      validateCarSearch({ ...body, pickup: location(pickup), dropoff: location(destination) }, new Date(), { allowUnresolvedProviders: true });
      await creation.create(body);
    } catch (error) { setError(error instanceof Error ? error.message : t('invalidSearch')); }
  }
  return <section className={styles.root} aria-labelledby="car-search-heading"><div className={styles.heading}><p>{t('independent')}</p><h2 id="car-search-heading">{t('findCar')}</h2><p>{t('intro')}</p></div>
    <form onInvalidCapture={event => { const details = (event.target as HTMLElement).closest('details'); if (details) details.open = true; }} onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={creation.locked}><legend>{t('journey')}</legend>
        <div className={styles.locationGrid}><CarLocationInput label={t('pickupLocation')} value={pickup} onChange={setPickup} />{!same && <CarLocationInput label={t('returnLocation')} value={dropoff} onChange={setDropoff} />}</div>
        <label className={styles.check}><input type="checkbox" checked={same} onChange={event => setSame(event.target.checked)} />{t('sameLocation')}</label>
        <div className={styles.dateGrid}>{(['pickup', 'dropoff'] as const).map(field => {
          const value = field === 'pickup' ? pickupAt : dropoffAt, update = field === 'pickup' ? setPickupAt : setDropoffAt;
          return <div className={styles.datePair} key={field}><label>{t(field === 'pickup' ? 'pickupDate' : 'returnDate')}<input required type="date" value={value.date} onChange={event => update({ ...value, date: event.target.value })} /></label><label>{t('localTime')}<input required type="time" step="1800" value={value.time} onChange={event => update({ ...value, time: event.target.value })} /></label></div>;
        })}</div><p className={styles.hint}>{t('timeHelp')}</p>
      </fieldset>
      <fieldset disabled={creation.locked}><legend>{t('mainDriver')}</legend>{driverFields(driver, setDriver)}<p className={styles.hint}>{t('driverHelp')}</p></fieldset>
      <fieldset disabled={creation.locked}><legend>{t('providers')}</legend><div className={styles.providerRow}>{CAR_SOURCES.map(source => <label className={styles.check} key={source}><input type="checkbox" checked={sources.includes(source)} onChange={event => setSources(event.target.checked ? [...sources, source] : sources.filter(value => value !== source))} />{CAR_PROVIDER_LABELS[source]}</label>)}<label>{t('currency')}<select value={currency} onChange={event => { setCurrency(event.target.value); setMaxTotal(''); }}>{options.currencies.map(code => <option key={code}>{code}</option>)}</select></label></div>
        {sources.includes('discovercars') && driver.age && ((Number(driver.age) >= 30 && Number(driver.age) <= 65 && Number(driver.age) !== 35) || Number(driver.age) > 80) && <p className={styles.notice}>{t('exactAgeHelp')}</p>}
      </fieldset>
      <details className={styles.details}><summary>{t('filtersExtras')}</summary><fieldset disabled={creation.locked}><legend>{t('vehicle')}</legend><div className={styles.driverGrid}><label>{t('transmission')}<select value={transmission} onChange={event => setTransmission(event.target.value)}><option value="any">{t('any')}</option><option value="automatic">{car('automatic')}</option><option value="manual">{car('manual')}</option></select></label><label>{t('minimumSeats')}<input required type="number" min="2" max="9" value={minSeats} onChange={event => setMinSeats(event.target.value)} /></label><label>{t('maxTotal', { currency })}<input inputMode="decimal" value={maxTotal} onChange={event => setMaxTotal(event.target.value)} /></label></div>
        <label className={styles.check}><input type="checkbox" checked={unlimited} onChange={event => setUnlimited(event.target.checked)} />{car('unlimitedMileage')}</label><label className={styles.check}><input type="checkbox" checked={cancellation} onChange={event => setCancellation(event.target.checked)} />{car('freeCancellation')}</label>
      </fieldset><fieldset disabled={creation.locked}><legend>{t('childSeats')}</legend><div className={styles.driverGrid}>{CHILD_SEAT_CATEGORIES.map(category => <label key={category}>{car(category)}<input type="number" min="0" max="4" value={seats[category]} onChange={event => setSeats({ ...seats, [category]: Number(event.target.value) })} /></label>)}</div></fieldset>
        <fieldset disabled={creation.locked}><legend>{t('additionalDrivers')}</legend>{drivers.map((value, index) => <div className={styles.extraDriver} key={index}><h3>{t('driverNumber', { number: index + 2 })}</h3>{driverFields(value, next => setDrivers(drivers.map((previous, i) => i === index ? next : previous)))}<button className={styles.secondary} type="button" onClick={() => setDrivers(drivers.filter((_, i) => i !== index))}>{t('removeDriver')}</button></div>)}<button className={styles.secondary} type="button" disabled={drivers.length >= 4} onClick={() => setDrivers([...drivers, blankDriver()])}>{t('addDriver')}</button><p className={styles.hint}>{t('extrasHelp')}</p></fieldset>
      </details>
      {(error || creation.error) && <p role="alert" className={styles.error}>{error || creation.error}</p>}
      {creation.phase === 'storage_error' && <div role="alert" className={styles.error}><p>{car('storageError')}</p><button className={styles.secondary} type="button" onClick={creation.recoverStorage}>{t('retryStorage')}</button>
        {!creation.pending && <details><summary>{t('discardLabel')}</summary><p>{t('discardHelp')}</p><label className={styles.check}><input type="checkbox" checked={discardConfirmed} onChange={event => setDiscardConfirmed(event.target.checked)} />{t('discardConfirm')}</label><button className={styles.secondary} type="button" disabled={!discardConfirmed} onClick={() => { creation.discardUnreadable(); setDiscardConfirmed(false); }}>{t('confirmDiscard')}</button></details>}
      </div>}
      {creation.phase === 'uncertain' && <div role="status" className={styles.notice}><p>{t('searchUncertain')}</p><button type="button" className={styles.secondary} onClick={() => void creation.retry()}>{t('recoverSearch')}</button></div>}
      {creation.phase === 'created' && creation.id ? <div role="status" className={styles.notice}><p>{t('searchCreated')}</p><Link className={styles.button} href={`/cars/search/${encodeURIComponent(creation.id)}`}>{t('openSearch')}</Link></div> : <button className={styles.button} type="submit" disabled={creation.locked || !sources.length}>{t(creation.phase === 'sending' ? 'startingSearch' : 'search')}</button>}
    </form><p className={styles.attribution}><a href="/cars/location-data">{t('locationAttribution')}</a></p>
  </section>;
}

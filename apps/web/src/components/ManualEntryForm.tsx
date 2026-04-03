'use client';

import { useState } from 'react';
import type { ParsedQuery } from './ConfirmationCard';
import { AirportCombobox } from './AirportCombobox';
import { detectLocaleCurrency } from '@/lib/currency';
import styles from './ManualEntryForm.module.css';

interface ManualEntryFormProps {
  onSubmit: (query: ParsedQuery, rawInput: string) => void;
  onCancel: () => void;
  adminCurrency: string | null;
  cancelLabel?: string;
}

interface SelectedAirport {
  code: string;
  name: string;
}

function synthesizeRawInput(
  origin: SelectedAirport,
  destination: SelectedAirport,
  dateFrom: string,
  dateTo: string,
  tripType: 'one_way' | 'round_trip',
  cabinClass: string,
): string {
  const parts = [`${origin.code} ${origin.name} to ${destination.code} ${destination.name}`];
  parts.push(dateFrom);
  if (tripType === 'round_trip' && dateTo) {
    parts.push(`to ${dateTo}`);
  }
  parts.push(tripType === 'round_trip' ? 'round trip' : 'one way');
  if (cabinClass !== 'economy') {
    parts.push(cabinClass.replace('_', ' '));
  }
  return parts.join(' ');
}

export function ManualEntryForm({
  onSubmit,
  onCancel,
  adminCurrency,
  cancelLabel = 'Cancel',
}: ManualEntryFormProps) {
  const [origin, setOrigin] = useState<SelectedAirport | null>(null);
  const [destination, setDestination] = useState<SelectedAirport | null>(null);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [tripType, setTripType] = useState<'one_way' | 'round_trip'>('round_trip');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const [showAdvanced, setShowAdvanced] = useState(false);
  const [flexibility, setFlexibility] = useState(0);
  const [maxPrice, setMaxPrice] = useState('');
  const [maxStops, setMaxStops] = useState('');
  const [airlines, setAirlines] = useState('');
  const [timePreference, setTimePreference] = useState<'any' | 'morning' | 'afternoon' | 'evening' | 'redeye'>('any');
  const [cabinClass, setCabinClass] = useState<'economy' | 'premium_economy' | 'business' | 'first'>('economy');
  const [currency, setCurrency] = useState('');

  const clearError = (field: string) => {
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validate = (): Record<string, string> | null => {
    const errors: Record<string, string> = {};

    if (!origin) errors.origin = 'Select an origin airport';
    if (!destination) errors.destination = 'Select a destination airport';
    if (origin && destination && origin.code === destination.code) {
      errors.destination = 'Must differ from origin';
    }
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    if (!dateFrom) {
      errors.dateFrom = 'Select a departure date';
    } else if (dateFrom < todayStr) {
      errors.dateFrom = 'Date cannot be in the past';
    }
    if (tripType === 'round_trip') {
      if (!dateTo) {
        errors.dateTo = 'Select a return date';
      } else if (dateFrom && dateTo <= dateFrom) {
        errors.dateTo = 'Return must be after departure';
      }
    }

    return Object.keys(errors).length > 0 ? errors : null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validate();
    if (errors) {
      setFieldErrors(errors);
      return;
    }

    const o = origin!;
    const d = destination!;

    const query: ParsedQuery = {
      origin: o.code,
      originName: o.name,
      destination: d.code,
      destinationName: d.name,
      origins: [{ code: o.code, name: o.name }],
      destinations: [{ code: d.code, name: d.name }],
      dateFrom,
      dateTo: tripType === 'round_trip' ? dateTo : dateFrom,
      flexibility,
      maxPrice: maxPrice ? parseInt(maxPrice, 10) : null,
      maxStops: maxStops === '' ? null : parseInt(maxStops, 10),
      preferredAirlines: airlines ? airlines.split(',').map((s) => s.trim()).filter(Boolean) : [],
      timePreference,
      cabinClass,
      tripType,
      currency: currency || adminCurrency || detectLocaleCurrency(),
    };

    if (flexibility > 0) {
      const from = new Date(dateFrom + 'T00:00:00');
      from.setDate(from.getDate() - flexibility);
      query.dateFrom = from.toISOString().split('T')[0]!;
      const to = new Date((tripType === 'round_trip' ? dateTo : dateFrom) + 'T00:00:00');
      to.setDate(to.getDate() + flexibility);
      query.dateTo = to.toISOString().split('T')[0]!;
    }

    const rawInput = synthesizeRawInput(o, d, dateFrom, dateTo, tripType, cabinClass);
    onSubmit(query, rawInput);
  };

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return (
    <form className={styles.root} onSubmit={handleSubmit} noValidate>
      <AirportCombobox
        id="me-origin"
        label="Origin"
        placeholder="Search by city, airport, or code (e.g. JFK)"
        value={origin}
        onChange={(v) => { setOrigin(v); clearError('origin'); }}
        error={fieldErrors.origin}
        excludeCode={destination?.code}
        autoFocus
      />

      <AirportCombobox
        id="me-dest"
        label="Destination"
        placeholder="Search by city, airport, or code (e.g. CDG)"
        value={destination}
        onChange={(v) => { setDestination(v); clearError('destination'); }}
        error={fieldErrors.destination}
        excludeCode={origin?.code}
      />

      <div className={styles.tripToggle}>
        <button
          type="button"
          className={`${styles.tripOption} ${tripType === 'round_trip' ? styles.tripOptionActive : ''}`}
          onClick={() => setTripType('round_trip')}
        >
          Round trip
        </button>
        <button
          type="button"
          className={`${styles.tripOption} ${tripType === 'one_way' ? styles.tripOptionActive : ''}`}
          onClick={() => setTripType('one_way')}
        >
          One way
        </button>
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="me-date-from">Departure</label>
          <input
            id="me-date-from"
            className={`${styles.input} ${fieldErrors.dateFrom ? styles.inputError : ''}`}
            type="date"
            min={today}
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); clearError('dateFrom'); }}
            aria-required
            aria-invalid={!!fieldErrors.dateFrom}
          />
          {fieldErrors.dateFrom && <span className={styles.errorText}>{fieldErrors.dateFrom}</span>}
        </div>
        {tripType === 'round_trip' && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="me-date-to">Return</label>
            <input
              id="me-date-to"
              className={`${styles.input} ${fieldErrors.dateTo ? styles.inputError : ''}`}
              type="date"
              min={dateFrom || today}
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); clearError('dateTo'); }}
              aria-required
              aria-invalid={!!fieldErrors.dateTo}
            />
            {fieldErrors.dateTo && <span className={styles.errorText}>{fieldErrors.dateTo}</span>}
          </div>
        )}
      </div>

      <button
        type="button"
        className={styles.advancedToggle}
        onClick={() => setShowAdvanced(!showAdvanced)}
        aria-expanded={showAdvanced}
      >
        <span>Advanced options</span>
        <svg
          className={`${styles.chevron} ${showAdvanced ? styles.chevronOpen : ''}`}
          width="16" height="16" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {showAdvanced && (
        <div className={styles.advancedPanel}>
          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="me-flexibility">Flexibility (days)</label>
              <input
                id="me-flexibility"
                className={styles.input}
                type="number"
                min={0}
                max={7}
                value={flexibility}
                onChange={(e) => setFlexibility(Math.max(0, Math.min(7, parseInt(e.target.value, 10) || 0)))}
              />
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="me-max-price">Max price</label>
              <input
                id="me-max-price"
                className={styles.input}
                type="number"
                min={0}
                placeholder="No limit"
                value={maxPrice}
                onChange={(e) => setMaxPrice(e.target.value)}
              />
            </div>
          </div>

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="me-max-stops">Max stops</label>
              <select
                id="me-max-stops"
                className={styles.input}
                value={maxStops}
                onChange={(e) => setMaxStops(e.target.value)}
              >
                <option value="">Any</option>
                <option value="0">Nonstop only</option>
                <option value="1">Max 1 stop</option>
                <option value="2">Max 2 stops</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="me-cabin">Cabin class</label>
              <select
                id="me-cabin"
                className={styles.input}
                value={cabinClass}
                onChange={(e) => setCabinClass(e.target.value as typeof cabinClass)}
              >
                <option value="economy">Economy</option>
                <option value="premium_economy">Premium Economy</option>
                <option value="business">Business</option>
                <option value="first">First</option>
              </select>
            </div>
          </div>

          <div className={styles.fieldRow}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="me-time">Time preference</label>
              <select
                id="me-time"
                className={styles.input}
                value={timePreference}
                onChange={(e) => setTimePreference(e.target.value as typeof timePreference)}
              >
                <option value="any">Any</option>
                <option value="morning">Morning</option>
                <option value="afternoon">Afternoon</option>
                <option value="evening">Evening</option>
                <option value="redeye">Red-eye</option>
              </select>
            </div>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="me-currency">Currency</label>
              <input
                id="me-currency"
                className={styles.input}
                type="text"
                placeholder="Auto-detect"
                maxLength={3}
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </div>
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="me-airlines">Preferred airlines</label>
            <input
              id="me-airlines"
              className={styles.input}
              type="text"
              placeholder="e.g. Delta, United"
              value={airlines}
              onChange={(e) => setAirlines(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className={styles.actions}>
        <button type="submit" className={styles.submitButton}>
          Show available flights
        </button>
        <button type="button" className={styles.cancelButton} onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>
    </form>
  );
}

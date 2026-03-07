'use client';

import { useState } from 'react';
import type { PriceData } from '@/lib/scraper/extract-prices';
import styles from './FlightPicker.module.css';

const MAX_SELECTIONS = 10;

function formatStops(stops: number): string {
  if (stops === 0) return 'Nonstop';
  if (stops === 1) return '1 stop';
  return `${stops} stops`;
}

export function FlightPicker({
  flights,
  onTrack,
  onBack,
  onEdit,
  loading,
}: {
  flights: PriceData[];
  onTrack: (selected: PriceData[]) => void;
  onBack: () => void;
  onEdit: () => void;
  loading: boolean;
}) {
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(flights.slice(0, MAX_SELECTIONS).map((_, i) => i))
  );

  const toggle = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else if (next.size < MAX_SELECTIONS) {
        next.add(index);
      }
      return next;
    });
  };

  const selectAll = () => {
    const indices = flights.slice(0, MAX_SELECTIONS).map((_, i) => i);
    setSelected(new Set(indices));
  };

  const clearAll = () => setSelected(new Set());

  const handleTrack = () => {
    const selectedFlights = flights.filter((_, i) => selected.has(i));
    onTrack(selectedFlights);
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h3 className={styles.title}>Available flights</h3>
          <span className={styles.counter}>
            {selected.size} of {Math.min(flights.length, MAX_SELECTIONS)} selected
          </span>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.selectAction} onClick={selectAll} disabled={loading}>
            Select all
          </button>
          <button className={styles.selectAction} onClick={clearAll} disabled={loading || selected.size === 0}>
            Clear
          </button>
        </div>
      </div>
      <p className={styles.hint}>Select up to {MAX_SELECTIONS} flights to track daily price changes</p>

      {flights.length === 0 ? (
        <div className={styles.empty}>
          No flights found for this route and dates. Try adjusting your search.
        </div>
      ) : (
        <div className={styles.list}>
          {flights.map((flight, i) => {
            const isSelected = selected.has(i);
            const isDisabled = !isSelected && selected.size >= MAX_SELECTIONS;

            return (
              <button
                key={i}
                className={`${styles.row} ${isSelected ? styles.rowSelected : ''} ${isDisabled ? styles.rowDisabled : ''}`}
                onClick={() => toggle(i)}
                disabled={loading || isDisabled}
                type="button"
              >
                <div className={styles.checkbox}>
                  {isSelected && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                  )}
                </div>
                <div className={styles.airline}>{flight.airline}</div>
                <div className={styles.price}>${flight.price}</div>
                <div className={styles.meta}>
                  <span className={styles.stops}>{formatStops(flight.stops)}</span>
                  {flight.duration && (
                    <span className={styles.duration}>{flight.duration}</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className={styles.actions}>
        <button
          className={styles.trackButton}
          onClick={handleTrack}
          disabled={loading || selected.size === 0}
        >
          {loading ? 'Creating tracker...' : `Track ${selected.size} flight${selected.size !== 1 ? 's' : ''}`}
        </button>
        <button
          className={styles.backButton}
          onClick={onBack}
          disabled={loading}
        >
          Back
        </button>
        <button
          className={styles.backButton}
          onClick={onEdit}
          disabled={loading}
        >
          Edit search
        </button>
      </div>
    </div>
  );
}

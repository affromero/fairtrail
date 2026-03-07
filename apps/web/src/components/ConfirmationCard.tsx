'use client';

import styles from './ConfirmationCard.module.css';

export interface ParsedQuery {
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
  dateFrom: string;
  dateTo: string;
  flexibility: number;
  maxPrice: number | null;
  maxStops: number | null;
  preferredAirlines: string[];
  timePreference: string;
  cabinClass: string;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function hasFilters(p: ParsedQuery): boolean {
  return !!(
    p.maxPrice ||
    p.maxStops !== null ||
    p.preferredAirlines.length > 0 ||
    p.timePreference !== 'any' ||
    p.cabinClass !== 'economy'
  );
}

function computeExpiry(dateTo: string, flexibility: number): string {
  const d = new Date(dateTo + 'T00:00:00');
  d.setDate(d.getDate() + flexibility);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function ConfirmationCard({
  parsed,
  onTrack,
  onEdit,
  loading,
}: {
  parsed: ParsedQuery;
  onTrack: () => void;
  onEdit: () => void;
  loading: boolean;
}) {
  return (
    <div className={styles.root}>
      <div className={styles.route}>
        <div className={styles.airport}>
          <span className={styles.code}>{parsed.origin}</span>
          <span className={styles.city}>{parsed.originName}</span>
        </div>
        <div className={styles.arrow}>
          <svg width="32" height="16" viewBox="0 0 32 16" fill="none">
            <path d="M0 8h28M22 2l6 6-6 6" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </div>
        <div className={styles.airport}>
          <span className={styles.code}>{parsed.destination}</span>
          <span className={styles.city}>{parsed.destinationName}</span>
        </div>
      </div>

      <div className={styles.details}>
        <div className={styles.dateRange}>
          <span className={styles.label}>Travel window</span>
          <span className={styles.value}>
            {formatDate(parsed.dateFrom)} &mdash; {formatDate(parsed.dateTo)}
          </span>
        </div>

        {parsed.flexibility > 0 && (
          <div className={styles.flexibility}>
            <span className={styles.label}>Flexibility</span>
            <span className={styles.value}>&plusmn; {parsed.flexibility} days</span>
          </div>
        )}

        <div className={styles.expiry}>
          <span className={styles.label}>Link expires</span>
          <span className={styles.value}>
            {computeExpiry(parsed.dateTo, parsed.flexibility)}
          </span>
        </div>
      </div>

      {hasFilters(parsed) && (
        <div className={styles.filters}>
          {parsed.maxPrice && (
            <span className={styles.tag}>Under ${parsed.maxPrice}</span>
          )}
          {parsed.maxStops !== null && (
            <span className={styles.tag}>
              {parsed.maxStops === 0 ? 'Nonstop only' : `Max ${parsed.maxStops} stop${parsed.maxStops > 1 ? 's' : ''}`}
            </span>
          )}
          {parsed.preferredAirlines.length > 0 && (
            <span className={styles.tag}>{parsed.preferredAirlines.join(', ')}</span>
          )}
          {parsed.timePreference !== 'any' && (
            <span className={styles.tag}>{parsed.timePreference}</span>
          )}
          {parsed.cabinClass !== 'economy' && (
            <span className={styles.tag}>{parsed.cabinClass.replace('_', ' ')}</span>
          )}
        </div>
      )}

      <div className={styles.actions}>
        <button
          className={styles.trackButton}
          onClick={onTrack}
          disabled={loading}
        >
          {loading ? 'Creating tracker...' : 'Track this flight'}
        </button>
        <button
          className={styles.editButton}
          onClick={onEdit}
          disabled={loading}
        >
          Edit
        </button>
      </div>
    </div>
  );
}

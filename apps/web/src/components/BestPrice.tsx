import { currencySymbol } from '@/lib/currency';
import styles from './BestPrice.module.css';

interface Snapshot {
  price: number;
  currency: string;
  airline: string;
  bookingUrl: string | null;
  stops: number;
  departureTime: string | null;
  arrivalTime: string | null;
  duration: string | null;
  vpnCountry: string | null;
  scrapedAt: string;
}

export function BestPrice({ snapshots }: { snapshots: Snapshot[] }) {
  if (snapshots.length === 0) return null;

  const best = snapshots.reduce((min, s) => (s.price < min.price ? s : min), snapshots[0]!);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.label}>Best price found</span>
      </div>
      <div className={styles.content}>
        <span className={styles.price}>
          {currencySymbol(best.currency)}{best.price.toLocaleString('en-US', { minimumFractionDigits: 0 })}
        </span>
        <div className={styles.details}>
          <span className={styles.airline}>{best.airline}</span>
          <span className={styles.meta}>
            {best.stops === 0 ? 'Nonstop' : `${best.stops} stop${best.stops > 1 ? 's' : ''}`}
            {best.duration && ` · ${best.duration}`}
            {(best.departureTime || best.arrivalTime) && ` · ${best.departureTime ?? '?'} - ${best.arrivalTime ?? '?'}`}
          </span>
        </div>
        {best.bookingUrl && (
          <a
            href={best.bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={styles.bookButton}
          >
            Book on {best.airline}
          </a>
        )}
      </div>
    </div>
  );
}

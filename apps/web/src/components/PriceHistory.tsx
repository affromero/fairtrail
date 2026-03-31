import { currencySymbol } from '@/lib/currency';
import styles from './PriceHistory.module.css';

interface Snapshot {
  id: string;
  price: number;
  currency: string;
  airline: string;
  bookingUrl: string | null;
  stops: number;
  duration: string | null;
  flightId: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  seatsLeft: number | null;
  status: string;
  airlineDirectPrice: number | null;
  vpnCountry: string | null;
  scrapedAt: string;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getTrend(
  snapshot: Snapshot,
  allSnapshots: Snapshot[]
): { direction: 'up' | 'down' | 'stable'; diff: number } {
  const sameAirline = allSnapshots
    .filter(
      (s) =>
        s.airline === snapshot.airline &&
        new Date(s.scrapedAt) < new Date(snapshot.scrapedAt)
    )
    .sort((a, b) => new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime());

  if (sameAirline.length === 0) return { direction: 'stable', diff: 0 };

  const prev = sameAirline[0]!;
  const diff = snapshot.price - prev.price;

  if (Math.abs(diff) < 1) return { direction: 'stable', diff: 0 };
  return { direction: diff > 0 ? 'up' : 'down', diff };
}

export function PriceHistory({ snapshots }: { snapshots: Snapshot[] }) {
  if (snapshots.length === 0) return null;

  const recent = [...snapshots]
    .sort((a, b) => new Date(b.scrapedAt).getTime() - new Date(a.scrapedAt).getTime())
    .slice(0, 50);

  const hasCountryData = snapshots.some((s) => s.vpnCountry);

  // Group by country for sectioned display
  const countryGroups = hasCountryData
    ? (() => {
        const groups = new Map<string, typeof recent>();
        for (const s of recent) {
          const key = s.vpnCountry ?? 'local';
          const arr = groups.get(key) ?? [];
          arr.push(s);
          groups.set(key, arr);
        }
        // Local first, then alphabetical
        const sorted = Array.from(groups.entries()).sort(([a], [b]) =>
          a === 'local' ? -1 : b === 'local' ? 1 : a.localeCompare(b)
        );
        return sorted;
      })()
    : [['all', recent] as const];

  function countryLabel(key: string): string {
    if (key === 'local' || key === 'all') return 'Local';
    return String.fromCodePoint(...key.split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) + ' ' + key;
  }

  function renderRow(s: Snapshot) {
    const trend = getTrend(s, snapshots);
    return (
      <tr key={s.id}>
        <td className={styles.date}>{formatDateTime(s.scrapedAt)}</td>
        <td>{s.airline}</td>
        <td className={styles.times}>
          {s.departureTime || s.arrivalTime
            ? `${s.departureTime ?? '?'} - ${s.arrivalTime ?? '?'}`
            : null}
        </td>
        <td className={styles.price}>{currencySymbol(s.currency)}{s.price.toLocaleString()}</td>
        <td>
          {trend.direction === 'up' && (
            <span className={styles.trendUp}>+{currencySymbol(s.currency)}{Math.abs(trend.diff).toFixed(0)}</span>
          )}
          {trend.direction === 'down' && (
            <span className={styles.trendDown}>-{currencySymbol(s.currency)}{Math.abs(trend.diff).toFixed(0)}</span>
          )}
          {trend.direction === 'stable' && (
            <span className={styles.trendStable}>&mdash;</span>
          )}
        </td>
        <td className={styles.stops}>
          {s.stops === 0 ? 'Direct' : `${s.stops} stop${s.stops > 1 ? 's' : ''}`}
        </td>
        <td className={styles.seats}>
          {s.status === 'sold_out' ? (
            <span className={styles.soldOut}>Sold out</span>
          ) : s.seatsLeft !== null ? (
            <span className={s.seatsLeft <= 3 ? styles.seatsLow : styles.seatsNormal}>
              {s.seatsLeft} left
            </span>
          ) : null}
        </td>
        <td>
          {s.status === 'sold_out' || !s.bookingUrl ? (
            <span className={styles.soldOutLabel}>&mdash;</span>
          ) : (
            <a href={s.bookingUrl} target="_blank" rel="noopener noreferrer" className={styles.bookLink}>
              Book
            </a>
          )}
        </td>
      </tr>
    );
  }

  return (
    <div className={styles.root}>
      <h3 className={styles.title}>Price History</h3>
      {countryGroups.map(([key, items]) => (
        <div key={key}>
          {hasCountryData && (
            <div className={styles.countryHeader}>{countryLabel(key as string)}</div>
          )}
          <div className={styles.tableWrapper}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Airline</th>
                  <th>Times</th>
                  <th>Price</th>
                  <th>Change</th>
                  <th>Stops</th>
                  <th>Seats</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(items as Snapshot[]).map(renderRow)}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

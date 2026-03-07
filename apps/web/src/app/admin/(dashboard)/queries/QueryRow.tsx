'use client';

import { useRouter } from 'next/navigation';
import styles from './page.module.css';

interface QueryData {
  id: string;
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
  dateFrom: string;
  dateTo: string;
  active: boolean;
  expiresAt: string;
  scrapeInterval: number;
  snapshotCount: number;
  runCount: number;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function QueryRow({ query }: { query: QueryData }) {
  const router = useRouter();
  const expired = new Date() > new Date(query.expiresAt);

  const handleToggle = async () => {
    await fetch(`/api/admin/queries/${query.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: !query.active }),
    });
    router.refresh();
  };

  const handleDelete = async () => {
    if (!confirm(`Delete tracker for ${query.origin} → ${query.destination}?`)) return;
    await fetch(`/api/admin/queries/${query.id}`, { method: 'DELETE' });
    router.refresh();
  };

  const handleIntervalChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    await fetch(`/api/admin/queries/${query.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scrapeInterval: Number(e.target.value) }),
    });
    router.refresh();
  };

  return (
    <div className={styles.row}>
      <div className={styles.rowRoute}>
        <span className={styles.rowCode}>{query.origin}</span>
        <span className={styles.rowArrow}>→</span>
        <span className={styles.rowCode}>{query.destination}</span>
      </div>
      <div className={styles.rowMeta}>
        <span>{formatDate(query.dateFrom)} — {formatDate(query.dateTo)}</span>
        <span className={styles.rowSep}>·</span>
        <span>{query.snapshotCount} snapshots</span>
        <span className={styles.rowSep}>·</span>
        <span>{query.runCount} runs</span>
      </div>
      <div className={styles.rowActions}>
        <select
          className={styles.intervalSelect}
          value={query.scrapeInterval}
          onChange={handleIntervalChange}
        >
          <option value={1}>Every 1h</option>
          <option value={3}>Every 3h</option>
          <option value={6}>Every 6h</option>
          <option value={12}>Every 12h</option>
          <option value={24}>Every 24h</option>
        </select>
        <button
          className={query.active ? styles.pauseButton : styles.resumeButton}
          onClick={handleToggle}
          disabled={expired}
        >
          {expired ? 'Expired' : query.active ? 'Pause' : 'Resume'}
        </button>
        <a href={`/q/${query.id}`} className={styles.viewLink} target="_blank" rel="noopener noreferrer">
          View
        </a>
        <button className={styles.deleteButton} onClick={handleDelete}>
          Delete
        </button>
      </div>
    </div>
  );
}

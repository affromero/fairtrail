'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { getSavedTrackers, removeSavedTracker, type SavedTracker } from '@/lib/tracker-storage';
import styles from './SavedTrackers.module.css';

type TrackerStatus = 'active' | 'expired' | 'deleted';

interface TrackerWithStatus extends SavedTracker {
  status: TrackerStatus;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

export function SavedTrackers() {
  const [trackers, setTrackers] = useState<TrackerWithStatus[]>([]);

  useEffect(() => {
    const saved = getSavedTrackers();
    if (saved.length === 0) return;

    // Fetch statuses
    fetch('/api/queries/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: saved.map((t) => t.id) }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (!data.ok) return;
        const statusMap = data.data as Record<string, TrackerStatus>;
        setTrackers(
          saved.map((t) => ({
            ...t,
            status: statusMap[t.id] ?? 'deleted',
          }))
        );
      })
      .catch(() => {
        // Show without status on network error
        setTrackers(saved.map((t) => ({ ...t, status: 'active' })));
      });
  }, []);

  const handleRemove = (id: string) => {
    removeSavedTracker(id);
    setTrackers((prev) => prev.filter((t) => t.id !== id));
  };

  if (trackers.length === 0) return null;

  return (
    <div className={styles.root}>
      <h3 className={styles.title}>Your Trackers</h3>
      <div className={styles.list}>
        {trackers.map((t) => (
          <div key={t.id} className={styles.card}>
            <button
              className={styles.remove}
              onClick={() => handleRemove(t.id)}
              title="Remove"
              aria-label="Remove tracker"
            >
              &times;
            </button>

            {t.status === 'deleted' ? (
              <div className={styles.content}>
                <div className={styles.route}>
                  <span className={styles.code}>{t.origin}</span>
                  <span className={styles.arrow}>→</span>
                  <span className={styles.code}>{t.destination}</span>
                </div>
                <span className={`${styles.badge} ${styles.badgeDeleted}`}>Unavailable</span>
              </div>
            ) : (
              <Link href={`/q/${t.id}`} className={styles.link}>
                <div className={styles.content}>
                  <div className={styles.route}>
                    <span className={styles.code}>{t.origin}</span>
                    <span className={styles.arrow}>→</span>
                    <span className={styles.code}>{t.destination}</span>
                  </div>
                  <span className={styles.dates}>
                    {formatDate(t.dateFrom)} — {formatDate(t.dateTo)}
                  </span>
                  <span className={`${styles.badge} ${t.status === 'active' ? styles.badgeActive : styles.badgeExpired}`}>
                    {t.status === 'active' ? 'Active' : 'Expired'}
                  </span>
                </div>
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

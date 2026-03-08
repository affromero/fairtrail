'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './page.module.css';

export function SeedRouteForm() {
  const router = useRouter();
  const [origin, setOrigin] = useState('');
  const [destination, setDestination] = useState('');
  const [originName, setOriginName] = useState('');
  const [destinationName, setDestinationName] = useState('');
  const [cabinClass, setCabinClass] = useState('economy');
  const [airlines, setAirlines] = useState('');
  const [lookAheadDays, setLookAheadDays] = useState(14);
  const [scrapeInterval, setScrapeInterval] = useState(3);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');

    const res = await fetch('/api/admin/seed-routes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        origin: origin.trim(),
        destination: destination.trim(),
        originName: originName.trim() || undefined,
        destinationName: destinationName.trim() || undefined,
        cabinClass,
        preferredAirlines: airlines ? airlines.split(',').map((a) => a.trim()).filter(Boolean) : [],
        lookAheadDays,
        scrapeInterval,
      }),
    });

    const data = await res.json();
    setSaving(false);

    if (data.ok) {
      setOrigin('');
      setDestination('');
      setOriginName('');
      setDestinationName('');
      setAirlines('');
      setMessage('Seed route created');
      router.refresh();
    } else {
      setMessage(data.error ?? 'Failed to create');
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <h2 className={styles.formTitle}>Add Seed Route</h2>
      <div className={styles.formGrid}>
        <div className={styles.field}>
          <label className={styles.label}>Origin (IATA)</label>
          <input
            className={styles.input}
            value={origin}
            onChange={(e) => setOrigin(e.target.value.toUpperCase())}
            placeholder="JFK"
            maxLength={3}
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Destination (IATA)</label>
          <input
            className={styles.input}
            value={destination}
            onChange={(e) => setDestination(e.target.value.toUpperCase())}
            placeholder="LAX"
            maxLength={3}
            required
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Origin Name</label>
          <input
            className={styles.input}
            value={originName}
            onChange={(e) => setOriginName(e.target.value)}
            placeholder="New York"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Destination Name</label>
          <input
            className={styles.input}
            value={destinationName}
            onChange={(e) => setDestinationName(e.target.value)}
            placeholder="Los Angeles"
          />
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Cabin Class</label>
          <select className={styles.select} value={cabinClass} onChange={(e) => setCabinClass(e.target.value)}>
            <option value="economy">Economy</option>
            <option value="premium_economy">Premium Economy</option>
            <option value="business">Business</option>
            <option value="first">First</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Look-Ahead</label>
          <select className={styles.select} value={lookAheadDays} onChange={(e) => setLookAheadDays(Number(e.target.value))}>
            <option value={7}>7 days</option>
            <option value={14}>14 days</option>
            <option value={21}>21 days</option>
            <option value={30}>30 days</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Scrape Interval</label>
          <select className={styles.select} value={scrapeInterval} onChange={(e) => setScrapeInterval(Number(e.target.value))}>
            <option value={1}>Every 1h</option>
            <option value={3}>Every 3h</option>
            <option value={6}>Every 6h</option>
            <option value={12}>Every 12h</option>
            <option value={24}>Every 24h</option>
          </select>
        </div>
        <div className={styles.field}>
          <label className={styles.label}>Airlines (comma-sep)</label>
          <input
            className={styles.input}
            value={airlines}
            onChange={(e) => setAirlines(e.target.value)}
            placeholder="Delta, United, AA"
          />
        </div>
      </div>
      <div className={styles.formActions}>
        <button className={styles.createButton} type="submit" disabled={saving}>
          {saving ? 'Creating...' : 'Create Seed Route'}
        </button>
        {message && <span className={styles.message}>{message}</span>}
      </div>
    </form>
  );
}

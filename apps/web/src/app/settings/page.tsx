'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { EXTRACTION_PROVIDERS } from '@/lib/scraper/ai-registry';
import styles from './page.module.css';

interface Config {
  provider: string;
  model: string;
  enabled: boolean;
  scrapeInterval: number;
  communitySharing: boolean;
  communityApiKey: string | null;
}

export default function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [provider, setProvider] = useState('anthropic');
  const [model, setModel] = useState('claude-haiku-4-5-20251001');
  const [scrapeInterval, setScrapeInterval] = useState(3);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    fetch('/api/admin/config')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setConfig(d.data);
          setProvider(d.data.provider);
          setModel(d.data.model);
          setScrapeInterval(d.data.scrapeInterval);
        }
      });
  }, []);

  const providerConfig = EXTRACTION_PROVIDERS[provider];
  const models = providerConfig?.models ?? [];

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    const newModels = EXTRACTION_PROVIDERS[newProvider]?.models ?? [];
    if (newModels.length > 0) {
      setModel(newModels[0]!.id);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage('');

    const res = await fetch('/api/admin/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model, scrapeIntervalHours: scrapeInterval }),
    });

    const data = await res.json();
    if (data.ok) {
      setConfig(data.data);
      setMessage('Saved');
    } else {
      setMessage(data.error || 'Failed to save');
    }
    setSaving(false);
  };

  if (!config) return null;

  return (
    <div className={styles.root}>
      <div className={styles.content}>
        <div className={styles.header}>
          <Link href="/" className={styles.backLink} title="Back to home">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 12L6 8l4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <h1 className={styles.title}>Settings</h1>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Extraction</h2>

          <div className={styles.field}>
            <label className={styles.label}>Provider</label>
            <select
              className={styles.select}
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value)}
            >
              {Object.entries(EXTRACTION_PROVIDERS).map(([key, p]) => (
                <option key={key} value={key}>{p.displayName}</option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Model</label>
            <select
              className={styles.select}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} ({m.costPer1kInput === 0 ? 'Free (CLI)' : `$${m.costPer1kInput}/1k in`})
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Scrape Interval</label>
            <select
              className={styles.select}
              value={scrapeInterval}
              onChange={(e) => setScrapeInterval(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 6, 8, 12, 24].map((h) => (
                <option key={h} value={h}>Every {h} hour{h !== 1 ? 's' : ''}</option>
              ))}
            </select>
          </div>

          <p className={styles.providerHint}>
            Env key: <code className={styles.code}>{providerConfig?.envKey ?? 'N/A'}</code>
          </p>

          <div className={styles.actions}>
            <button className={styles.saveButton} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            {message && <span className={styles.message}>{message}</span>}
          </div>
        </div>

        <div className={styles.section}>
          <h2 className={styles.sectionTitle}>Community Data Sharing</h2>

          <div className={styles.toggleRow}>
            <button
              type="button"
              className={`${styles.toggle} ${config.communitySharing ? styles.toggleOn : ''}`}
              onClick={async () => {
                const newValue = !config.communitySharing;
                const res = await fetch('/api/admin/config', {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ communitySharing: newValue }),
                });
                const data = await res.json();
                if (data.ok) setConfig(data.data);
              }}
            >
              <span className={styles.toggleKnob} />
            </button>
            <div>
              <span className={styles.toggleLabel}>
                {config.communitySharing ? 'Sharing enabled' : 'Sharing disabled'}
              </span>
              <p className={styles.toggleHint}>
                Share anonymized price data (route, price, airline, date) with the Fairtrail community.
              </p>
            </div>
          </div>

          {config.communityApiKey && (
            <div className={styles.field}>
              <label className={styles.label}>API Key</label>
              <code className={styles.code}>
                {config.communityApiKey.slice(0, 8)}...{config.communityApiKey.slice(-4)}
              </code>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

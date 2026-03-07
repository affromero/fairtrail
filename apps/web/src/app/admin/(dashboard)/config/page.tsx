'use client';

import { useState, useEffect } from 'react';
import { EXTRACTION_PROVIDERS } from '@/lib/scraper/ai-registry';
import styles from './page.module.css';

interface Config {
  provider: string;
  model: string;
  enabled: boolean;
  scrapeInterval: number;
}

export default function ConfigPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [provider, setProvider] = useState('anthropic');
  const [model, setModel] = useState('claude-haiku-4-5-20251001');
  const [scrapeInterval, setScrapeInterval] = useState(6);
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
      setMessage('Config saved');
    } else {
      setMessage(data.error || 'Failed to save');
    }
    setSaving(false);
  };

  if (!config) {
    return <div className={styles.root}><p className={styles.loading}>Loading config...</p></div>;
  }

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>Extraction Config</h1>

      <div className={styles.form}>
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
                {m.name} ({m.costPer1kInput === 0 ? 'Free (Max)' : `$${m.costPer1kInput}/1k in`})
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
              <option key={h} value={h}>Every {h}h</option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.label}>Status</label>
          <span className={config.enabled ? styles.enabled : styles.disabled}>
            {config.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>

        <div className={styles.actions}>
          <button className={styles.saveButton} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Config'}
          </button>
          {message && <span className={styles.message}>{message}</span>}
        </div>
      </div>

      <div className={styles.info}>
        <h2 className={styles.infoTitle}>Provider Details</h2>
        <p className={styles.infoText}>
          <strong>Env key:</strong>{' '}
          <code className={styles.code}>{providerConfig?.envKey ?? 'N/A'}</code>
        </p>
        <p className={styles.infoText}>
          <strong>Available models:</strong> {models.length}
        </p>
      </div>
    </div>
  );
}

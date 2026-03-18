'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { EXTRACTION_PROVIDERS, LOCAL_PROVIDERS } from '@/lib/scraper/ai-registry';
import styles from './page.module.css';

interface Config {
  provider: string;
  model: string;
  enabled: boolean;
  scrapeInterval: number;
  communitySharing: boolean;
  communityApiKey: string | null;
  customBaseUrl: string | null;
  defaultCurrency: string | null;
  defaultCountry: string | null;
}

export default function SettingsPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [provider, setProvider] = useState('anthropic');
  const [model, setModel] = useState('claude-haiku-4-5-20251001');
  const [customModel, setCustomModel] = useState('');
  const [scrapeInterval, setScrapeInterval] = useState(3);
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [defaultCurrency, setDefaultCurrency] = useState('');
  const [defaultCountry, setDefaultCountry] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [localModels, setLocalModels] = useState<{ id: string; name: string; size: string }[]>([]);
  const [localModelsLoading, setLocalModelsLoading] = useState(false);
  const [localModelsError, setLocalModelsError] = useState('');

  const fetchLocalModels = useCallback((p: string) => {
    if (!LOCAL_PROVIDERS.has(p)) {
      setLocalModels([]);
      setLocalModelsError('');
      return;
    }
    setLocalModelsLoading(true);
    setLocalModelsError('');
    setLocalModels([]); // clear stale data to avoid showing old list during fetch
    fetch(`/api/admin/local-models?provider=${p}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setLocalModels(d.data);
        } else {
          setLocalModels([]);
          setLocalModelsError(d.error || 'Failed to fetch models');
        }
      })
      .catch(() => {
        setLocalModels([]);
        setLocalModelsError('Could not connect');
      })
      .finally(() => setLocalModelsLoading(false));
  }, []);

  useEffect(() => {
    fetch('/api/admin/config')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setConfig(d.data);
          setProvider(d.data.provider);
          setScrapeInterval(d.data.scrapeInterval);
          setCustomBaseUrl(d.data.customBaseUrl || '');
          setDefaultCurrency(d.data.defaultCurrency || '');
          setDefaultCountry(d.data.defaultCountry || '');
          const pc = EXTRACTION_PROVIDERS[d.data.provider];
          const knownModel = pc?.models.find((m) => m.id === d.data.model);
          if (knownModel) {
            setModel(d.data.model);
            setCustomModel('');
          } else {
            setModel(pc?.models[0]?.id ?? '');
            setCustomModel(d.data.model);
          }
          fetchLocalModels(d.data.provider);
        }
      });
  }, [fetchLocalModels]);

  const providerConfig = EXTRACTION_PROVIDERS[provider];
  const models = providerConfig?.models ?? [];

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    setCustomModel('');
    setCustomBaseUrl(EXTRACTION_PROVIDERS[newProvider]?.defaultBaseUrl ?? '');
    const newModels = EXTRACTION_PROVIDERS[newProvider]?.models ?? [];
    if (newModels.length > 0) {
      setModel(newModels[0]!.id);
    } else {
      setModel('');
    }
    fetchLocalModels(newProvider);
  };

  const effectiveModel = customModel.trim() || model || (localModels.length > 0 ? localModels[0]!.id : '');

  const handleSave = async () => {
    if (!effectiveModel) {
      setMessage('Enter a model ID before saving');
      return;
    }
    setSaving(true);
    setMessage('');

    const res = await fetch('/api/admin/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider,
        model: effectiveModel,
        scrapeIntervalHours: scrapeInterval,
        customBaseUrl: customBaseUrl.trim() || null,
        defaultCurrency: defaultCurrency.trim().toUpperCase() || null,
        defaultCountry: defaultCountry.trim().toUpperCase() || null,
      }),
    });

    const data = await res.json();
    if (data.ok) {
      setConfig(data.data);
      setMessage('Saved');
      if (LOCAL_PROVIDERS.has(provider)) {
        fetchLocalModels(provider);
      }
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
            {models.length > 0 && (
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
            )}
            {models.length === 0 && localModels.length > 0 && (
              <select
                className={styles.select}
                value={customModel || localModels[0]!.id}
                onChange={(e) => setCustomModel(e.target.value)}
              >
                {localModels.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}{m.size ? ` (${m.size})` : ''}
                  </option>
                ))}
              </select>
            )}
            {models.length === 0 && localModelsLoading && (
              <span className={styles.modelHint}>Fetching models...</span>
            )}
            {models.length === 0 && localModelsError && (
              <span className={styles.modelHintError}>{localModelsError}</span>
            )}
            {providerConfig?.allowCustomModel && (
              <input
                type="text"
                className={styles.input}
                placeholder={models.length === 0 && localModels.length === 0
                  ? 'Model ID (e.g. llama3.1:8b, mistral:7b)'
                  : 'Or type a custom model ID'}
                value={customModel}
                onChange={(e) => setCustomModel(e.target.value)}
              />
            )}
          </div>

          {providerConfig?.allowCustomBaseUrl && (
            <div className={styles.field}>
              <label className={styles.label}>API Base URL</label>
              <input
                type="url"
                className={styles.input}
                placeholder={providerConfig.defaultBaseUrl || 'https://...'}
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
              />
              <span className={styles.toggleHint}>
                {providerConfig.defaultBaseUrl
                  ? `Default: ${providerConfig.defaultBaseUrl}`
                  : 'Leave empty for default'}
              </span>
            </div>
          )}

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

          <div className={styles.field}>
            <label className={styles.label}>Default Currency (ISO 4217)</label>
            <input
              type="text"
              className={styles.input}
              placeholder="e.g. EUR, GBP — empty = auto-detect"
              value={defaultCurrency}
              onChange={(e) => setDefaultCurrency(e.target.value.toUpperCase())}
              maxLength={3}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Default Country (ISO 3166-1)</label>
            <input
              type="text"
              className={styles.input}
              placeholder="e.g. DE, GB — empty = auto-detect"
              value={defaultCountry}
              onChange={(e) => setDefaultCountry(e.target.value.toUpperCase())}
              maxLength={2}
            />
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

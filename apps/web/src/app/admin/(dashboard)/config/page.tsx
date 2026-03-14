'use client';

import { useState, useEffect, useCallback } from 'react';
import { EXTRACTION_PROVIDERS } from '@/lib/scraper/ai-registry';
import styles from './page.module.css';

interface Config {
  provider: string;
  model: string;
  enabled: boolean;
  scrapeInterval: number;
  hasAdminPassword: boolean;
  communitySharing: boolean;
  communityApiKey: string | null;
}

interface InviteCode {
  id: string;
  code: string;
  label: string | null;
  usesCount: number;
  active: boolean;
  createdAt: string;
  expiresAt: string | null;
}

export default function ConfigPage() {
  const [config, setConfig] = useState<Config | null>(null);
  const [provider, setProvider] = useState('anthropic');
  const [model, setModel] = useState('claude-haiku-4-5-20251001');
  const [customModel, setCustomModel] = useState('');
  const [scrapeInterval, setScrapeInterval] = useState(3);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [adminPassword, setAdminPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState('');

  const [invites, setInvites] = useState<InviteCode[]>([]);
  const [newLabel, setNewLabel] = useState('');
  const [generatingInvite, setGeneratingInvite] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadInvites = useCallback(() => {
    fetch('/api/admin/invites')
      .then((r) => r.json())
      .then((d) => { if (d.ok) setInvites(d.data); });
  }, []);

  useEffect(() => {
    fetch('/api/admin/config')
      .then((r) => r.json())
      .then((d) => {
        if (d.ok) {
          setConfig(d.data);
          setProvider(d.data.provider);
          setScrapeInterval(d.data.scrapeInterval);
          const pc = EXTRACTION_PROVIDERS[d.data.provider];
          const knownModel = pc?.models.find((m) => m.id === d.data.model);
          if (knownModel) {
            setModel(d.data.model);
            setCustomModel('');
          } else {
            setModel(pc?.models[0]?.id ?? '');
            setCustomModel(d.data.model);
          }
        }
      });
    loadInvites();
  }, [loadInvites]);

  const providerConfig = EXTRACTION_PROVIDERS[provider];
  const models = providerConfig?.models ?? [];

  const handleProviderChange = (newProvider: string) => {
    setProvider(newProvider);
    setCustomModel('');
    const newModels = EXTRACTION_PROVIDERS[newProvider]?.models ?? [];
    if (newModels.length > 0) {
      setModel(newModels[0]!.id);
    }
  };

  const effectiveModel = customModel.trim() || model;

  const handleSave = async () => {
    setSaving(true);
    setMessage('');

    const res = await fetch('/api/admin/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model: effectiveModel, scrapeIntervalHours: scrapeInterval }),
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

  const handleSavePassword = async () => {
    if (!adminPassword) return;
    setSavingPassword(true);
    setPasswordMessage('');

    const res = await fetch('/api/admin/config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword }),
    });

    const data = await res.json();
    if (data.ok) {
      setConfig(data.data);
      setAdminPassword('');
      setPasswordMessage('Password updated');
    } else {
      setPasswordMessage(data.error || 'Failed to save');
    }
    setSavingPassword(false);
  };

  const handleGenerateInvite = async () => {
    setGeneratingInvite(true);

    const res = await fetch('/api/admin/invites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newLabel.trim() || null }),
    });

    const data = await res.json();
    if (data.ok) {
      setNewLabel('');
      loadInvites();
    }
    setGeneratingInvite(false);
  };

  const handleToggleInvite = async (id: string, active: boolean) => {
    await fetch(`/api/admin/invites/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active }),
    });
    loadInvites();
  };

  const handleDeleteInvite = async (id: string) => {
    await fetch(`/api/admin/invites/${id}`, { method: 'DELETE' });
    loadInvites();
  };

  const handleCopyCode = (invite: InviteCode) => {
    navigator.clipboard.writeText(invite.code);
    setCopiedId(invite.id);
    setTimeout(() => setCopiedId(null), 2000);
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
          {providerConfig?.allowCustomModel && (
            <input
              type="text"
              className={styles.input}
              placeholder="Or type a custom model ID (e.g. llama-3.1-70b)"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
            />
          )}
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

      <div className={styles.form}>
        <h2 className={styles.sectionTitle}>Invite Codes</h2>

        <div className={styles.inviteGenRow}>
          <input
            type="text"
            className={styles.input}
            placeholder="Label (optional, e.g. 'for John')"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
          />
          <button
            className={styles.saveButton}
            onClick={handleGenerateInvite}
            disabled={generatingInvite}
          >
            {generatingInvite ? 'Generating...' : 'Generate Code'}
          </button>
        </div>

        {invites.length > 0 && (
          <div className={styles.inviteList}>
            {invites.map((inv) => (
              <div key={inv.id} className={`${styles.inviteRow} ${!inv.active ? styles.inviteInactive : ''}`}>
                <div className={styles.inviteMain}>
                  <button
                    className={styles.inviteCode}
                    onClick={() => handleCopyCode(inv)}
                    title="Click to copy"
                  >
                    {copiedId === inv.id ? 'Copied!' : inv.code.slice(0, 8) + '...'}
                  </button>
                  {inv.label && <span className={styles.inviteLabel}>{inv.label}</span>}
                </div>
                <div className={styles.inviteMeta}>
                  <span className={styles.inviteUses}>{inv.usesCount} uses</span>
                  <button
                    type="button"
                    className={`${styles.toggle} ${inv.active ? styles.toggleOn : ''}`}
                    onClick={() => handleToggleInvite(inv.id, !inv.active)}
                  >
                    <span className={styles.toggleKnob} />
                  </button>
                  <button
                    className={styles.inviteDelete}
                    onClick={() => handleDeleteInvite(inv.id)}
                    title="Delete"
                  >
                    &times;
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={styles.form}>
        <h2 className={styles.sectionTitle}>Admin Password</h2>

        <div className={styles.field}>
          <label className={styles.label}>
            Password {config.hasAdminPassword && <span className={styles.passwordSet}>(set)</span>}
          </label>
          <input
            type="password"
            className={styles.input}
            placeholder={config.hasAdminPassword ? 'Leave blank to keep current' : 'Set admin password'}
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
          />
        </div>

        <div className={styles.actions}>
          <button className={styles.saveButton} onClick={handleSavePassword} disabled={savingPassword || !adminPassword}>
            {savingPassword ? 'Saving...' : 'Save Password'}
          </button>
          {passwordMessage && <span className={styles.message}>{passwordMessage}</span>}
        </div>
      </div>

      <div className={styles.form}>
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

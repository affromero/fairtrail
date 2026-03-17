'use client';

import { useState, useEffect } from 'react';
import styles from './page.module.css';
import { EXTRACTION_PROVIDERS, LOCAL_PROVIDERS } from '@/lib/scraper/ai-registry';

interface SetupStatus {
  setupComplete: boolean;
  isSelfHosted: boolean;
  detectedProviders: string[];
  currentProvider: string | null;
  currentModel: string | null;
}

export default function SetupPage() {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [step, setStep] = useState(0);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [provider, setProvider] = useState('');
  const [model, setModel] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [communitySharing, setCommunitySharing] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/setup/status')
      .then((r) => r.json())
      .then((data: SetupStatus) => {
        if (data.setupComplete) {
          window.location.href = '/';
          return;
        }
        setStatus(data);
        if (data.isSelfHosted) {
          setStep(1);
        }
        if (data.detectedProviders.length > 0) {
          const defaultProvider = data.detectedProviders[0]!;
          setProvider(defaultProvider);
          const providerConfig = EXTRACTION_PROVIDERS[defaultProvider];
          if (providerConfig?.models[0]) {
            setModel(providerConfig.models[0].id);
          }
        }
      });
  }, []);

  const handleSubmit = async () => {
    setError('');

    if (step === 0) {
      if (password.length < 8) {
        setError('Password must be at least 8 characters');
        return;
      }
      if (password !== confirmPassword) {
        setError('Passwords do not match');
        return;
      }
      setStep(1);
      return;
    }

    if (step === 1) {
      if (!provider || !model) {
        setError('Select a provider and model');
        return;
      }
      setStep(2);
      return;
    }

    // Step 2: complete setup
    setLoading(true);
    const res = await fetch('/api/setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPassword: password, provider, model, communitySharing, customBaseUrl: customBaseUrl.trim() || null }),
    });

    if (res.ok) {
      window.location.href = '/';
    } else {
      const data = await res.json();
      setError(data.error || 'Setup failed');
      setLoading(false);
    }
  };

  if (!status) {
    return (
      <main className={styles.root}>
        <div className={styles.card}>
          <p className={styles.loading}>Loading...</p>
        </div>
      </main>
    );
  }

  const CLI_PROVIDERS = new Set(['claude-code', 'codex']);
  const hasCliProvider = status.detectedProviders.some((p) => CLI_PROVIDERS.has(p));

  const providerEntries = Object.entries(EXTRACTION_PROVIDERS);
  const isSelfHosted = status.isSelfHosted;
  const subtitles = [
    'Set your admin password',
    'Choose your LLM provider',
    'Join the community',
  ];

  return (
    <main className={styles.root}>
      <div className={styles.card}>
        <h1 className={styles.title}>Fairtrail Setup</h1>
        <p className={styles.subtitle}>{subtitles[step]}</p>

        <div className={styles.steps}>
          {!isSelfHosted && (
            <>
              <span className={`${styles.step} ${step >= 0 ? styles.active : ''}`}>1. Password</span>
              <span className={styles.stepDivider}>/</span>
            </>
          )}
          <span className={`${styles.step} ${step >= 1 ? styles.active : ''}`}>{isSelfHosted ? '1' : '2'}. Provider</span>
          <span className={styles.stepDivider}>/</span>
          <span className={`${styles.step} ${step >= 2 ? styles.active : ''}`}>{isSelfHosted ? '2' : '3'}. Community</span>
        </div>

        {step === 0 && (
          <div className={styles.fields}>
            <input
              type="password"
              className={styles.input}
              placeholder="Admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
            <input
              type="password"
              className={styles.input}
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
        )}

        {step === 1 && (
          <div className={styles.fields}>
            {hasCliProvider && (
              <p className={styles.cliHint}>
                Using your existing CLI subscription — no API key needed, no extra cost.
              </p>
            )}
            <div className={styles.providers}>
              {providerEntries.map(([key, config]) => {
                const detected = status.detectedProviders.includes(key);
                return (
                  <button
                    key={key}
                    className={`${styles.providerCard} ${provider === key ? styles.selected : ''} ${!detected ? styles.unavailable : ''}`}
                    onClick={() => {
                      setProvider(key);
                      setCustomBaseUrl(config.defaultBaseUrl ?? '');
                      if (config.models[0]) setModel(config.models[0].id);
                      else setModel('');
                    }}
                  >
                    <span className={styles.providerName}>{config.displayName}</span>
                    <span className={styles.providerStatus}>
                      {detected
                        ? CLI_PROVIDERS.has(key)
                          ? 'Your subscription'
                          : LOCAL_PROVIDERS.has(key)
                            ? 'Local'
                            : 'Ready'
                        : CLI_PROVIDERS.has(key)
                          ? 'Not installed'
                          : LOCAL_PROVIDERS.has(key)
                            ? 'Local'
                            : 'No key'}
                    </span>
                  </button>
                );
              })}
            </div>

            {provider && EXTRACTION_PROVIDERS[provider] && (
              <>
                {EXTRACTION_PROVIDERS[provider]!.models.length > 0 && (
                  <select
                    className={styles.input}
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  >
                    {EXTRACTION_PROVIDERS[provider]!.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                        {m.costPer1kInput === 0 ? ' (free)' : ` ($${m.costPer1kInput}/1k in)`}
                      </option>
                    ))}
                  </select>
                )}
                {EXTRACTION_PROVIDERS[provider]!.allowCustomModel && (
                  <input
                    type="text"
                    className={styles.input}
                    placeholder="Model ID (e.g. llama3.1:8b, mistral:7b)"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                  />
                )}
                {EXTRACTION_PROVIDERS[provider]!.allowCustomBaseUrl && (
                  <input
                    type="url"
                    className={styles.input}
                    placeholder={EXTRACTION_PROVIDERS[provider]!.defaultBaseUrl || 'https://...'}
                    value={customBaseUrl}
                    onChange={(e) => setCustomBaseUrl(e.target.value)}
                  />
                )}
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <div className={styles.fields}>
            <div className={styles.communityCard}>
              <h3 className={styles.communityTitle}>
                Help build the world&apos;s first open flight price database
              </h3>
              <p className={styles.communityText}>
                Share anonymized price data (route, price, airline, date) with the
                Fairtrail community. No personal info is ever sent.
              </p>
              <button
                className={`${styles.communityToggle} ${communitySharing ? styles.communityActive : ''}`}
                onClick={() => setCommunitySharing(!communitySharing)}
              >
                {communitySharing ? 'Sharing enabled' : 'Not sharing'}
              </button>
            </div>
            <p className={styles.communityHint}>
              You can change this anytime in the admin panel.
            </p>
          </div>
        )}

        {error && <p className={styles.error}>{error}</p>}

        <div className={styles.actions}>
          {step > (isSelfHosted ? 1 : 0) && (
            <button
              className={styles.backButton}
              onClick={() => setStep(step - 1)}
            >
              Back
            </button>
          )}
          <button
            className={styles.button}
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? 'Setting up...' : step < 2 ? 'Next' : 'Complete Setup'}
          </button>
        </div>
      </div>
    </main>
  );
}

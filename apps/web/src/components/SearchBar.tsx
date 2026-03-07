'use client';

import { useState, useCallback, useRef } from 'react';
import styles from './SearchBar.module.css';
import { ConfirmationCard, type ParsedQuery } from './ConfirmationCard';

export function SearchBar() {
  const [query, setQuery] = useState('');
  const [parsed, setParsed] = useState<ParsedQuery | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleParse = useCallback(async () => {
    if (!query.trim() || query.trim().length < 5) return;

    setLoading(true);
    setError(null);
    setParsed(null);

    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: query.trim() }),
      });

      const data = await res.json();

      if (!data.ok) {
        setError(data.error || 'Failed to parse query');
        return;
      }

      setParsed(data.data);
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      handleParse();
    }
  };

  const handleTrack = async () => {
    if (!parsed) return;

    setLoading(true);
    try {
      const res = await fetch('/api/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...parsed, rawInput: query.trim() }),
      });

      const data = await res.json();

      if (!data.ok) {
        setError(data.error || 'Failed to create tracker');
        return;
      }

      window.location.href = `/q/${data.data.id}`;
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setParsed(null);
    setError(null);
    inputRef.current?.focus();
  };

  return (
    <div className={styles.root}>
      <div className={styles.inputWrapper}>
        <input
          ref={inputRef}
          type="text"
          className={styles.input}
          placeholder='NYC to Paris around June 15 ± 3 days'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          autoFocus
        />
        <button
          className={styles.searchButton}
          onClick={handleParse}
          disabled={loading || query.trim().length < 5}
        >
          {loading ? (
            <span className={styles.spinner} />
          ) : (
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7" />
            </svg>
          )}
        </button>
      </div>

      <div className={styles.hints}>
        <span className={styles.hint}>JFK to CDG June 15-20</span>
        <span className={styles.hintSep}>&middot;</span>
        <span className={styles.hint}>London to Tokyo next month flexible</span>
        <span className={styles.hintSep}>&middot;</span>
        <span className={styles.hint}>SFO &rarr; LAX March 20 &plusmn; 2 days</span>
      </div>

      {error && (
        <div className={styles.error}>
          {error}
        </div>
      )}

      {parsed && (
        <ConfirmationCard
          parsed={parsed}
          onTrack={handleTrack}
          onEdit={handleReset}
          loading={loading}
        />
      )}
    </div>
  );
}

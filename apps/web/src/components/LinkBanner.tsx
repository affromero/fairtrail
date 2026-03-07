'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './LinkBanner.module.css';

interface LinkBannerProps {
  queryId: string;
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
  onDismiss: () => void;
}

export function LinkBanner({
  queryId,
  origin,
  originName,
  destination,
  destinationName,
  onDismiss,
}: LinkBannerProps) {
  const [copied, setCopied] = useState(false);
  const url = `${typeof window !== 'undefined' ? window.location.origin : ''}/q/${queryId}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onDismiss();
  }, [onDismiss]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className={styles.backdrop} onClick={onDismiss}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()}>
        <div className={styles.route}>
          <div className={styles.airport}>
            <span className={styles.code}>{origin}</span>
            <span className={styles.city}>{originName}</span>
          </div>
          <span className={styles.arrow}>→</span>
          <div className={styles.airport}>
            <span className={styles.code}>{destination}</span>
            <span className={styles.city}>{destinationName}</span>
          </div>
        </div>

        <div className={styles.success}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className={styles.checkIcon}>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.5" />
            <path d="M8 12l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Tracker created</span>
        </div>

        <div className={styles.urlBox}>
          <span className={styles.urlLabel}>Your shareable link</span>
          <div className={styles.urlRow}>
            <input
              className={styles.urlInput}
              value={url}
              readOnly
              onClick={(e) => (e.target as HTMLInputElement).select()}
            />
            <button className={styles.copyButton} onClick={handleCopy}>
              {copied ? (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M5 12l5 5L20 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                  Copy Link
                </>
              )}
            </button>
          </div>
        </div>

        <div className={styles.warning}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.warningIcon}>
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div>
            <p className={styles.warningBold}>Save this link! It&apos;s the only way to access your tracker.</p>
            <p className={styles.warningText}>If you don&apos;t visit this link within 24 hours, it will be automatically deleted.</p>
          </div>
        </div>

        <div className={styles.actions}>
          <a href={`/q/${queryId}`} className={styles.goButton}>
            Go to Tracker
          </a>
          <button className={styles.dismissButton} onClick={onDismiss}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

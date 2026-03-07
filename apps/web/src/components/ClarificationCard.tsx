'use client';

import { useState } from 'react';
import type { ParseAmbiguity, ParsedFlightQuery } from '@/lib/scraper/parse-query';
import styles from './ClarificationCard.module.css';

export function ClarificationCard({
  ambiguities,
  partialParsed,
  onAnswer,
  onReset,
  loading,
}: {
  ambiguities: ParseAmbiguity[];
  partialParsed: ParsedFlightQuery | null;
  onAnswer: (answer: string) => void;
  onReset: () => void;
  loading: boolean;
}) {
  const [freeText, setFreeText] = useState('');

  const handleSubmit = () => {
    const trimmed = freeText.trim();
    if (!trimmed) return;
    setFreeText('');
    onAnswer(trimmed);
  };

  return (
    <div className={styles.root}>
      {partialParsed && (
        <div className={styles.partialRoute}>
          <span className={styles.code}>{partialParsed.origin}</span>
          <span className={styles.arrow}>→</span>
          <span className={styles.code}>{partialParsed.destination}</span>
          <span className={styles.narrowing}>narrowing...</span>
        </div>
      )}

      <div className={styles.questions}>
        {ambiguities.map((amb, i) => (
          <div key={i} className={styles.question}>
            <p className={styles.questionText}>{amb.question}</p>
            {amb.options && amb.options.length > 0 && (
              <div className={styles.options}>
                {amb.options.map((opt) => (
                  <button
                    key={opt}
                    className={styles.option}
                    onClick={() => onAnswer(opt)}
                    disabled={loading}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className={styles.freeInput}>
        <input
          type="text"
          className={styles.input}
          placeholder="Or type your answer..."
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !loading && handleSubmit()}
          disabled={loading}
        />
      </div>

      <button className={styles.resetLink} onClick={onReset} disabled={loading}>
        Start over
      </button>
    </div>
  );
}

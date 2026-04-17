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
  const [answers, setAnswers] = useState<Record<number, string>>({});

  const setAnswer = (index: number, value: string) => {
    setAnswers((prev) => ({ ...prev, [index]: value }));
  };

  const allAnswered = ambiguities.every((_, i) => (answers[i] ?? '').trim() !== '');

  const handleSubmit = () => {
    if (!allAnswered || loading) return;
    const combined = ambiguities
      .map((amb, i) => `${amb.question} ${answers[i]!.trim()}`)
      .join('\n');
    setAnswers({});
    onAnswer(combined);
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
        {ambiguities.map((amb, i) => {
          const current = answers[i] ?? '';
          const hasOptions = !!(amb.options && amb.options.length > 0);
          const matchesOption = hasOptions && amb.options!.includes(current);
          const textValue = matchesOption ? '' : current;

          return (
            <div key={i} className={styles.question}>
              <p className={styles.questionText}>{amb.question}</p>
              {hasOptions && (
                <div className={styles.options}>
                  {amb.options!.map((opt) => {
                    const selected = current === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        className={`${styles.option} ${selected ? styles.optionSelected : ''}`}
                        onClick={() => setAnswer(i, opt)}
                        disabled={loading}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}
              <input
                type="text"
                className={styles.input}
                placeholder={hasOptions ? 'Or type your answer...' : 'Type your answer...'}
                value={textValue}
                onChange={(e) => setAnswer(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && allAnswered && !loading) {
                    handleSubmit();
                  }
                }}
                disabled={loading}
              />
            </div>
          );
        })}
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.submit}
          onClick={handleSubmit}
          disabled={loading || !allAnswered}
        >
          {loading ? 'Submitting...' : 'Submit answers'}
        </button>
        <button
          type="button"
          className={styles.resetLink}
          onClick={onReset}
          disabled={loading}
        >
          Start over
        </button>
      </div>
    </div>
  );
}

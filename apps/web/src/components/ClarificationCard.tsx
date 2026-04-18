'use client';

import { useId, useRef, useState } from 'react';
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
  onAnswer: (answer: string) => Promise<boolean>;
  onReset: () => void;
  loading: boolean;
}) {
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const submittingRef = useRef(false);
  const baseId = useId();

  const setAnswer = (index: number, value: string) => {
    setAnswers((prev) => ({ ...prev, [index]: value }));
  };

  const allAnswered = ambiguities.every((_, i) => (answers[i] ?? '').trim() !== '');

  const handleSubmit = async () => {
    if (submittingRef.current || !allAnswered || loading) return;
    submittingRef.current = true;
    try {
      const combined = ambiguities
        .map((_, i) => answers[i]!.trim())
        .join('\n');
      const ok = await onAnswer(combined);
      if (ok) setAnswers({});
    } finally {
      submittingRef.current = false;
    }
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
          const questionId = `${baseId}-q${i}`;
          const inputId = `${baseId}-input${i}`;

          return (
            <div key={i} className={styles.question}>
              <p id={questionId} className={styles.questionText}>{amb.question}</p>
              {hasOptions && (
                <div
                  className={styles.options}
                  role="group"
                  aria-labelledby={questionId}
                >
                  {amb.options!.map((opt) => {
                    const selected = current === opt;
                    return (
                      <button
                        key={opt}
                        type="button"
                        className={`${styles.option} ${selected ? styles.optionSelected : ''}`}
                        onClick={() => setAnswer(i, opt)}
                        disabled={loading}
                        aria-pressed={selected}
                      >
                        {opt}
                      </button>
                    );
                  })}
                </div>
              )}
              <label htmlFor={inputId} className={styles.visuallyHidden}>
                {amb.question}
              </label>
              <input
                id={inputId}
                type="text"
                className={styles.input}
                placeholder={hasOptions ? 'Or type your answer...' : 'Type your answer...'}
                value={textValue}
                onChange={(e) => setAnswer(i, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && allAnswered && !loading) {
                    void handleSubmit();
                  }
                }}
                disabled={loading}
                aria-labelledby={questionId}
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

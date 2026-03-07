'use client';

import { useState, useCallback, useRef } from 'react';
import type { ParseAmbiguity, ParsedFlightQuery } from '@/lib/scraper/parse-query';
import { addSavedTracker } from '@/lib/tracker-storage';
import styles from './SearchBar.module.css';
import { ConfirmationCard, type ParsedQuery } from './ConfirmationCard';
import { ClarificationCard } from './ClarificationCard';
import { LinkBanner } from './LinkBanner';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface CreatedQuery {
  id: string;
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
}

export function SearchBar() {
  const [query, setQuery] = useState('');
  const [parsed, setParsed] = useState<ParsedQuery | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Narrowing state
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [ambiguities, setAmbiguities] = useState<ParseAmbiguity[]>([]);
  const [partialParsed, setPartialParsed] = useState<ParsedFlightQuery | null>(null);

  // Link banner state
  const [createdQuery, setCreatedQuery] = useState<CreatedQuery | null>(null);

  const doParse = useCallback(async (input: string, history: ConversationMessage[]) => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: input,
          conversationHistory: history.length > 0 ? history : undefined,
        }),
      });

      const data = await res.json();

      if (!data.ok) {
        setError(data.error || 'Failed to parse query');
        return;
      }

      const { parsed: p, confidence, ambiguities: ambs } = data.data;

      if (confidence === 'high' && p) {
        setParsed(p);
        setAmbiguities([]);
        setPartialParsed(null);
      } else {
        setParsed(null);
        setAmbiguities(ambs || []);
        setPartialParsed(p);

        const assistantMsg = ambs?.map((a: ParseAmbiguity) => a.question).join(' ') || 'Can you be more specific?';
        setConversation((prev) => [...prev, { role: 'assistant', content: assistantMsg }]);
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleParse = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 5) return;

    const history: ConversationMessage[] = [];
    setConversation(history);
    setAmbiguities([]);
    setPartialParsed(null);
    setParsed(null);

    await doParse(trimmed, history);
  }, [query, doParse]);

  const handleAnswer = useCallback(async (answer: string) => {
    const newHistory: ConversationMessage[] = [...conversation, { role: 'user', content: answer }];
    setConversation(newHistory);
    await doParse(answer, newHistory);
  }, [conversation, doParse]);

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

      // Save to localStorage
      addSavedTracker({
        id: data.data.id,
        origin: parsed.origin,
        destination: parsed.destination,
        originName: parsed.originName,
        destinationName: parsed.destinationName,
        dateFrom: parsed.dateFrom,
        dateTo: parsed.dateTo,
        createdAt: new Date().toISOString(),
      });

      // Show link banner instead of redirecting
      setCreatedQuery({
        id: data.data.id,
        origin: parsed.origin,
        originName: parsed.originName,
        destination: parsed.destination,
        destinationName: parsed.destinationName,
      });
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setParsed(null);
    setError(null);
    setConversation([]);
    setAmbiguities([]);
    setPartialParsed(null);
    setCreatedQuery(null);
    inputRef.current?.focus();
  };

  const showClarification = ambiguities.length > 0 && !parsed;

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

      {showClarification && (
        <ClarificationCard
          ambiguities={ambiguities}
          partialParsed={partialParsed}
          onAnswer={handleAnswer}
          onReset={handleReset}
          loading={loading}
        />
      )}

      {parsed && !createdQuery && (
        <ConfirmationCard
          parsed={parsed}
          onTrack={handleTrack}
          onEdit={handleReset}
          loading={loading}
        />
      )}

      {createdQuery && (
        <LinkBanner
          queryId={createdQuery.id}
          origin={createdQuery.origin}
          originName={createdQuery.originName}
          destination={createdQuery.destination}
          destinationName={createdQuery.destinationName}
          onDismiss={handleReset}
        />
      )}
    </div>
  );
}

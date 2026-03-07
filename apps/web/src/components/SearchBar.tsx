'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ParseAmbiguity, ParsedFlightQuery } from '@/lib/scraper/parse-query';
import type { PriceData } from '@/lib/scraper/extract-prices';
import { addSavedTracker } from '@/lib/tracker-storage';
import styles from './SearchBar.module.css';
import { ConfirmationCard, type ParsedQuery } from './ConfirmationCard';
import { ClarificationCard } from './ClarificationCard';
import { FlightPicker } from './FlightPicker';
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
  const [inviteValid, setInviteValid] = useState<boolean | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [parsed, setParsed] = useState<ParsedQuery | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/invite/status')
      .then((r) => r.json())
      .then((d) => setInviteValid(d.ok ? d.data.valid : false))
      .catch(() => setInviteValid(false));
  }, []);

  const handleInviteSubmit = async () => {
    const code = inviteCode.trim();
    if (!code) return;

    setInviteLoading(true);
    setInviteError(null);

    try {
      const res = await fetch('/api/invite/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.ok) {
        setInviteValid(true);
      } else {
        setInviteError(data.error || 'Invalid code');
      }
    } catch {
      setInviteError('Network error — please try again');
    } finally {
      setInviteLoading(false);
    }
  };

  const handleInviteKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !inviteLoading) {
      handleInviteSubmit();
    }
  };

  // Narrowing state
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [ambiguities, setAmbiguities] = useState<ParseAmbiguity[]>([]);
  const [partialParsed, setPartialParsed] = useState<ParsedFlightQuery | null>(null);

  // Preview state
  const [previewFlights, setPreviewFlights] = useState<PriceData[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

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
    setPreviewFlights(null);

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

  const handlePreview = async () => {
    if (!parsed) return;

    setPreviewLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });

      const data = await res.json();

      if (!data.ok) {
        setError(data.error || 'Failed to search flights');
        return;
      }

      setPreviewFlights(data.data.flights);
    } catch {
      setError('Network error — please try again');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleTrackSelected = async (selectedFlights: PriceData[]) => {
    if (!parsed) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...parsed,
          rawInput: query.trim(),
          selectedFlights,
        }),
      });

      const data = await res.json();

      if (!data.ok) {
        setError(data.error || 'Failed to create tracker');
        return;
      }

      addSavedTracker({
        id: data.data.id,
        origin: parsed.origin,
        destination: parsed.destination,
        originName: parsed.originName,
        destinationName: parsed.destinationName,
        dateFrom: parsed.dateFrom,
        dateTo: parsed.dateTo,
        createdAt: new Date().toISOString(),
        deleteToken: data.data.deleteToken,
      });

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

  const handleBackFromPicker = () => {
    setPreviewFlights(null);
  };

  const handleReset = () => {
    setParsed(null);
    setError(null);
    setConversation([]);
    setAmbiguities([]);
    setPartialParsed(null);
    setPreviewFlights(null);
    setPreviewLoading(false);
    setCreatedQuery(null);
    inputRef.current?.focus();
  };

  const showClarification = ambiguities.length > 0 && !parsed;
  const showConfirmation = parsed && !previewFlights && !createdQuery && !previewLoading;
  const showPreviewLoading = parsed && previewLoading && !previewFlights;
  const showPicker = parsed && previewFlights && !createdQuery;

  if (inviteValid === null) {
    return <div className={styles.root} />;
  }

  if (!inviteValid) {
    return (
      <div className={styles.root}>
        <div className={styles.inputWrapper}>
          <input
            type="text"
            className={styles.input}
            placeholder="Enter your invite code"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            onKeyDown={handleInviteKeyDown}
            disabled={inviteLoading}
            autoFocus
          />
          <button
            className={styles.searchButton}
            onClick={handleInviteSubmit}
            disabled={inviteLoading || !inviteCode.trim()}
          >
            {inviteLoading ? (
              <span className={styles.spinner} />
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7" />
              </svg>
            )}
          </button>
        </div>
        <p className={styles.inviteHint}>
          You need an invite code to search flights
        </p>
        {inviteError && (
          <div className={styles.error}>{inviteError}</div>
        )}
      </div>
    );
  }

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

      {showConfirmation && (
        <ConfirmationCard
          parsed={parsed}
          onTrack={handlePreview}
          onEdit={handleReset}
          loading={loading}
        />
      )}

      {showPreviewLoading && parsed && (
        <div className={styles.previewLoading}>
          <span className={styles.previewRoute}>
            {parsed.origin} → {parsed.destination}
          </span>
          <span className={styles.previewStatus}>Searching Google Flights&hellip;</span>
        </div>
      )}

      {showPicker && (
        <FlightPicker
          flights={previewFlights}
          onTrack={handleTrackSelected}
          onBack={handleBackFromPicker}
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

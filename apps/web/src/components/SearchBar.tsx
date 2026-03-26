'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ParseAmbiguity, ParsedFlightQuery } from '@/lib/scraper/parse-query';
import { addSavedTracker } from '@/lib/tracker-storage';
import styles from './SearchBar.module.css';
import { ConfirmationCard, type ParsedQuery } from './ConfirmationCard';
import { ClarificationCard } from './ClarificationCard';
import { FlightPicker, type RouteFlights } from './FlightPicker';
import { LinkBanner, type CreatedTracker } from './LinkBanner';
import type { PriceData } from '@/lib/scraper/extract-prices';
import { detectLocaleCurrency } from '@/lib/currency';

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function SearchBar({ initialQuery }: { initialQuery?: string } = {}) {
  const [inviteValid, setInviteValid] = useState<boolean | null>(null);
  const [inviteCode, setInviteCode] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);

  const [query, setQuery] = useState(initialQuery ?? '');
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

  // Preview state — routes instead of flat flights
  const [previewRoutes, setPreviewRoutes] = useState<RouteFlights[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Link banner state — multiple trackers
  const [createdTrackers, setCreatedTrackers] = useState<CreatedTracker[] | null>(null);

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

      // If the LLM didn't detect a currency (null = user didn't mention one),
      // use the browser's locale currency instead
      if (p && !p.currency) {
        const localeCurrency = detectLocaleCurrency();
        p.currency = localeCurrency;
      }

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

    const history: ConversationMessage[] = [{ role: 'user', content: trimmed }];
    setConversation(history);
    setAmbiguities([]);
    setPartialParsed(null);
    setParsed(null);
    setPreviewRoutes(null);

    await doParse(trimmed, []);
  }, [query, doParse]);

  const handleAnswer = useCallback(async (answer: string) => {
    const newConversation: ConversationMessage[] = [...conversation, { role: 'user', content: answer }];
    setConversation(newConversation);
    await doParse(answer, conversation);
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

      // Handle both new (routes array) and legacy (flat flights) responses
      if (data.data.routes) {
        setPreviewRoutes(data.data.routes);
      } else if (data.data.flights) {
        // Legacy single-route: wrap in a route object
        setPreviewRoutes([{
          origin: parsed.origin,
          originName: parsed.originName,
          destination: parsed.destination,
          destinationName: parsed.destinationName,
          flights: data.data.flights,
        }]);
      }
    } catch {
      setError('Network error — please try again');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleTrackSelected = async (routeSelections: Array<{ route: RouteFlights; flights: PriceData[] }>) => {
    if (!parsed) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawInput: query.trim(),
          dateFrom: parsed.dateFrom,
          dateTo: parsed.dateTo,
          flexibility: parsed.flexibility,
          maxPrice: parsed.maxPrice,
          maxStops: parsed.maxStops,
          preferredAirlines: parsed.preferredAirlines,
          timePreference: parsed.timePreference,
          currency: parsed.currency,
          cabinClass: parsed.cabinClass,
          tripType: parsed.tripType,
          routes: routeSelections.map((rs) => ({
            origin: rs.route.origin,
            originName: rs.route.originName,
            destination: rs.route.destination,
            destinationName: rs.route.destinationName,
            date: rs.route.date,
            returnDate: rs.route.returnDate,
            selectedFlights: rs.flights,
          })),
        }),
      });

      const data = await res.json();

      if (!data.ok) {
        setError(data.error || 'Failed to create tracker');
        return;
      }

      const queries: Array<{ id: string; origin: string; originName: string; destination: string; destinationName: string; date?: string; returnDate?: string; deleteToken: string }> = data.data.queries;

      for (const q of queries) {
        addSavedTracker({
          id: q.id,
          origin: q.origin,
          destination: q.destination,
          originName: q.originName,
          destinationName: q.destinationName,
          dateFrom: q.date || parsed.dateFrom,
          dateTo: q.returnDate || parsed.dateTo,
          createdAt: new Date().toISOString(),
          deleteToken: q.deleteToken,
        });
      }

      setCreatedTrackers(queries.map((q) => ({
        id: q.id,
        origin: q.origin,
        originName: q.originName,
        destination: q.destination,
        destinationName: q.destinationName,
        date: q.date,
      })));
    } catch {
      setError('Network error — please try again');
    } finally {
      setLoading(false);
    }
  };

  const handleBackFromPicker = () => {
    setPreviewRoutes(null);
  };

  const handleReset = () => {
    setParsed(null);
    setError(null);
    setConversation([]);
    setAmbiguities([]);
    setPartialParsed(null);
    setPreviewRoutes(null);
    setPreviewLoading(false);
    setCreatedTrackers(null);
    inputRef.current?.focus();
  };

  const showClarification = ambiguities.length > 0 && !parsed;
  const showConfirmation = parsed && !previewRoutes && !createdTrackers && !previewLoading;
  const showPreviewLoading = parsed && previewLoading && !previewRoutes;
  const showPicker = parsed && previewRoutes && !createdTrackers;

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
        {['JFK to CDG June 15-20', 'London to Tokyo next month flexible', 'SFO to LAX March 20 ± 2 days'].map((example, i) => (
          <span key={i}>
            {i > 0 && <span className={styles.hintSep}>&middot; </span>}
            <button
              type="button"
              className={styles.hintBtn}
              onClick={() => { setQuery(example); inputRef.current?.focus(); }}
            >
              {example}
            </button>
          </span>
        ))}
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
            {parsed.origins.map((a) => a.code).join(', ')} → {parsed.destinations.map((a) => a.code).join(', ')}
          </span>
          <span className={styles.previewStatus}>Searching Google Flights&hellip;</span>
        </div>
      )}

      {showPicker && previewRoutes && (
        <FlightPicker
          routes={previewRoutes}
          onTrack={handleTrackSelected}
          onBack={handleBackFromPicker}
          onEdit={handleReset}
          loading={loading}
        />
      )}

      {createdTrackers && (
        <LinkBanner
          trackers={createdTrackers}
          onDismiss={handleReset}
        />
      )}
    </div>
  );
}

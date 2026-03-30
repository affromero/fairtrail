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

function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Audio not available
  }
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export function SearchBar({ initialQuery }: { initialQuery?: string } = {}) {
  const [query, setQuery] = useState(initialQuery ?? '');
  const [parsed, setParsed] = useState<ParsedQuery | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch('/api/admin/config')
      .then((r) => r.json())
      .then((d) => { if (d.ok && d.data.defaultCurrency) setAdminCurrency(d.data.defaultCurrency); })
      .catch(() => {});
  }, []);



  // Narrowing state
  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [ambiguities, setAmbiguities] = useState<ParseAmbiguity[]>([]);
  const [partialParsed, setPartialParsed] = useState<ParsedFlightQuery | null>(null);

  // Preview state — routes instead of flat flights
  const [previewRoutes, setPreviewRoutes] = useState<RouteFlights[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // VPN country comparison
  const [vpnCountries, setVpnCountries] = useState<string[]>([]);
  const [adminCurrency, setAdminCurrency] = useState<string | null>(null);

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
      // use admin default currency, then browser locale as last resort
      if (p && !p.currency) {
        p.currency = adminCurrency || detectLocaleCurrency();
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
      playNotificationSound();
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
          vpnCountries,
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

      {!parsed && !loading && (
        <button
          type="button"
          className={styles.randomFlight}
          onClick={() => {
            // Generate dates 3-6 weeks from now for realistic searches
            const base = new Date();
            base.setDate(base.getDate() + 21 + Math.floor(Math.random() * 21));
            const dep = base.toISOString().split('T')[0]!;
            const ret = new Date(base);
            ret.setDate(ret.getDate() + 5 + Math.floor(Math.random() * 5));
            const retStr = ret.toISOString().split('T')[0]!;

            const routes = [
              `JFK to CDG ${dep} to ${retStr} round trip economy`,
              `LAX to NRT ${dep} to ${retStr} round trip economy`,
              `ORD to FCO ${dep} to ${retStr} round trip economy`,
              `MIA to BOG ${dep} one way economy`,
              `SFO to LHR ${dep} to ${retStr} round trip economy`,
              `BOS to BCN ${dep} to ${retStr} round trip economy`,
              `SEA to ICN ${dep} to ${retStr} round trip economy`,
              `DEN to AMS ${dep} to ${retStr} round trip economy`,
              `DFW to CUN ${dep} to ${retStr} round trip economy`,
              `ATL to DUB ${dep} to ${retStr} round trip economy`,
            ];
            const pick = routes[Math.floor(Math.random() * routes.length)]!;
            setQuery(pick);
            doParse(pick, []);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22M22 6l-4-4M22 6l-4 4M2 6h1.4c1.3 0 2.5.6 3.3 1.7l6.1 8.6c.7 1.1 2 1.7 3.3 1.7H22M22 18l-4-4M22 18l-4 4" />
          </svg>
          Try a random flight
        </button>
      )}

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
          vpnCountries={vpnCountries}
          onVpnCountriesChange={setVpnCountries}
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

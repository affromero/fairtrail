import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import { parseFlightQuery, type ParsedFlightQuery, type ParseAmbiguity } from '../../../../apps/web/src/lib/scraper/parse-query.js';
import type { PriceData } from '../../../../apps/web/src/lib/scraper/extract-prices.js';
import { previewFlights, type RouteResult } from '../lib/preview.js';
import { createTrackedQueries, type CreatedQuery } from '../lib/create-queries.js';
import { ParsedQueryCard } from '../components/ParsedQueryCard.js';
import { FlightTable } from '../components/FlightTable.js';

type Step = 'input' | 'parsing' | 'confirm' | 'clarify' | 'previewing' | 'select' | 'tracking' | 'done';

export function SearchWizard() {
  const [step, setStep] = useState<Step>('input');
  const [rawInput, setRawInput] = useState('');
  const [inputValue, setInputValue] = useState('');
  const [parsed, setParsed] = useState<ParsedFlightQuery | null>(null);
  const [ambiguities, setAmbiguities] = useState<ParseAmbiguity[]>([]);
  const [conversation, setConversation] = useState<Array<{ role: string; content: string }>>([]);
  const [routes, setRoutes] = useState<RouteResult[]>([]);
  const [progressMsg, setProgressMsg] = useState('');
  const [error, setError] = useState('');
  const [createdQueries, setCreatedQueries] = useState<CreatedQuery[]>([]);
  const [currentRouteIdx, setCurrentRouteIdx] = useState(0);

  const handleParse = useCallback(async (input: string, history?: Array<{ role: string; content: string }>) => {
    setStep('parsing');
    setError('');
    try {
      const { response } = await parseFlightQuery(input, history);

      if (response.parsed) {
        setParsed(response.parsed);
      }

      if (response.confidence === 'high' && response.parsed) {
        setStep('confirm');
      } else if (response.ambiguities.length > 0) {
        setAmbiguities(response.ambiguities);
        setStep('clarify');
      } else if (response.parsed) {
        setStep('confirm');
      } else {
        setError('Could not parse your query. Please try again.');
        setStep('input');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parse failed');
      setStep('input');
    }
  }, []);

  const handleSubmitQuery = useCallback(() => {
    if (!inputValue.trim()) return;
    setRawInput(inputValue);
    handleParse(inputValue);
  }, [inputValue, handleParse]);

  const handleClarify = useCallback((item: { label: string; value: string }) => {
    const answer = item.value;
    const newConvo = [
      ...conversation,
      { role: 'user' as const, content: rawInput },
      { role: 'assistant' as const, content: ambiguities.map((a) => a.question).join('\n') },
      { role: 'user' as const, content: answer },
    ];
    setConversation(newConvo);
    handleParse(answer, newConvo);
  }, [conversation, rawInput, ambiguities, handleParse]);

  const handleConfirm = useCallback(async () => {
    if (!parsed) return;
    setStep('previewing');
    setProgressMsg('Starting search...');
    try {
      const result = await previewFlights({
        parsed,
        onProgress: setProgressMsg,
      });
      setRoutes(result);

      const withFlights = result.filter((r) => r.flights.length > 0);
      if (withFlights.length === 0) {
        setError(result.find((r) => r.error)?.error ?? 'No flights found');
        setStep('input');
      } else {
        setCurrentRouteIdx(0);
        setStep('select');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview failed');
      setStep('input');
    }
  }, [parsed]);

  const handleFlightSelect = useCallback(async (selectedFlights: PriceData[]) => {
    if (!parsed) return;

    const routesWithFlights = routes.filter((r) => r.flights.length > 0);
    const currentRoute = routesWithFlights[currentRouteIdx];
    if (!currentRoute) return;

    const selections = [{ route: currentRoute, flights: selectedFlights }];

    // If there are more routes, we could cycle through them.
    // For now, track the current route's selections.
    if (currentRouteIdx < routesWithFlights.length - 1) {
      setCurrentRouteIdx((i) => i + 1);
      return;
    }

    setStep('tracking');
    try {
      const queries = await createTrackedQueries(parsed, rawInput, selections);
      setCreatedQueries(queries);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create tracker');
      setStep('input');
    }
  }, [parsed, routes, currentRouteIdx, rawInput]);

  return (
    <Box flexDirection="column">
      {error && (
        <Box marginBottom={1}>
          <Text color="red">{'⚠ '}{error}</Text>
        </Box>
      )}

      {step === 'input' && (
        <Box flexDirection="column">
          <Text bold color="cyan">Where are you flying?</Text>
          <Text dimColor>Describe your trip in natural language</Text>
          <Box marginTop={1}>
            <Text color="cyan">{'▸ '}</Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              placeholder="NYC to Tokyo next month under $800 nonstop"
              onSubmit={handleSubmitQuery}
            />
          </Box>
        </Box>
      )}

      {step === 'parsing' && (
        <Box>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text>{' '}Parsing your query...</Text>
        </Box>
      )}

      {step === 'confirm' && parsed && (
        <Box flexDirection="column">
          <ParsedQueryCard parsed={parsed} />
          <Box marginTop={1}>
            <SelectInput
              items={[
                { label: 'Search flights', value: 'search' },
                { label: 'Edit query', value: 'edit' },
              ]}
              onSelect={(item) => {
                if (item.value === 'search') handleConfirm();
                else {
                  setStep('input');
                  setError('');
                }
              }}
            />
          </Box>
        </Box>
      )}

      {step === 'clarify' && ambiguities.length > 0 && (
        <Box flexDirection="column">
          {parsed && <ParsedQueryCard parsed={parsed} />}
          <Box marginTop={1} flexDirection="column">
            <Text bold color="yellow">{'? '}{ambiguities[0]!.question}</Text>
            {ambiguities[0]!.options ? (
              <SelectInput
                items={ambiguities[0]!.options.map((o) => ({ label: o, value: o }))}
                onSelect={handleClarify}
              />
            ) : (
              <Box marginTop={1}>
                <Text color="cyan">{'▸ '}</Text>
                <TextInput
                  value={inputValue}
                  onChange={setInputValue}
                  placeholder="Type your answer..."
                  onSubmit={() => handleClarify({ label: inputValue, value: inputValue })}
                />
              </Box>
            )}
          </Box>
        </Box>
      )}

      {step === 'previewing' && (
        <Box flexDirection="column">
          {parsed && <ParsedQueryCard parsed={parsed} />}
          <Box marginTop={1}>
            <Text color="cyan"><Spinner type="dots" /></Text>
            <Text>{' '}{progressMsg || 'Searching flights...'}</Text>
          </Box>
          <Text dimColor>This may take 30-60 seconds per route (Playwright + AI extraction)</Text>
        </Box>
      )}

      {step === 'select' && (() => {
        const routesWithFlights = routes.filter((r) => r.flights.length > 0);
        const route = routesWithFlights[currentRouteIdx];
        if (!route) return null;
        return (
          <Box flexDirection="column">
            <Box marginBottom={1}>
              <Text bold color="white">{route.originName}</Text>
              <Text dimColor> → </Text>
              <Text bold color="white">{route.destinationName}</Text>
              {route.date && <Text dimColor> ({route.date})</Text>}
              {routesWithFlights.length > 1 && (
                <Text dimColor> [{currentRouteIdx + 1}/{routesWithFlights.length}]</Text>
              )}
            </Box>
            <FlightTable
              flights={route.flights}
              currency={parsed?.currency ?? 'USD'}
              onConfirm={handleFlightSelect}
              onBack={() => setStep('confirm')}
            />
          </Box>
        );
      })()}

      {step === 'tracking' && (
        <Box>
          <Text color="cyan"><Spinner type="dots" /></Text>
          <Text>{' '}Creating tracker...</Text>
        </Box>
      )}

      {step === 'done' && (
        <Box flexDirection="column">
          <Text bold color="green">{'✓ '}Tracking {createdQueries.length} route{createdQueries.length !== 1 ? 's' : ''}!</Text>
          <Box marginTop={1} flexDirection="column">
            {createdQueries.map((q) => (
              <Box key={q.id}>
                <Text color="cyan">{'  '}{q.origin} → {q.destination}</Text>
                <Text dimColor>  ID: </Text>
                <Text bold>{q.id}</Text>
              </Box>
            ))}
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text dimColor>View with: <Text color="white">fairtrail --view {'<id>'}</Text></Text>
            <Text dimColor>List all:  <Text color="white">fairtrail --list</Text></Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}

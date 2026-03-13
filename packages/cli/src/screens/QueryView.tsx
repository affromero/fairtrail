import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { prisma } from '@/lib/prisma';
import { PriceChart } from '../components/PriceChart.js';
import { BestPriceCard } from '../components/BestPriceCard.js';
import { formatDate, formatCurrency, formatStops, formatTimeAgo } from '../lib/format.js';

interface Snapshot {
  id: string;
  price: number;
  currency: string;
  airline: string;
  stops: number;
  duration: string | null;
  bookingUrl: string;
  travelDate: Date;
  scrapedAt: Date;
  status: string;
}

interface QueryData {
  id: string;
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
  dateFrom: Date;
  dateTo: Date;
  currency: string;
  active: boolean;
  expiresAt: Date | null;
  createdAt: Date;
  snapshots: Snapshot[];
  lastScraped: Date | null;
}

interface QueryViewProps {
  id: string;
  onBack?: () => void;
}

export function QueryView({ id, onBack }: QueryViewProps) {
  const { exit } = useApp();
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState<QueryData | null>(null);
  const [error, setError] = useState('');
  const isTTY = process.stdin.isTTY ?? false;

  useInput((input, key) => {
    if (input === 'q') exit();
    if ((input === 'b' || key.escape) && onBack) onBack();
  }, { isActive: isTTY });

  useEffect(() => {
    (async () => {
      try {
        const row = await prisma.query.findUnique({
          where: { id },
          include: {
            snapshots: {
              where: { status: 'available' },
              orderBy: { scrapedAt: 'desc' },
            },
            fetchRuns: {
              orderBy: { startedAt: 'desc' },
              take: 1,
              select: { startedAt: true },
            },
          },
        });

        if (!row) {
          setError(`Query "${id}" not found`);
          return;
        }

        setQuery({
          id: row.id,
          origin: row.origin,
          originName: row.originName,
          destination: row.destination,
          destinationName: row.destinationName,
          dateFrom: row.dateFrom,
          dateTo: row.dateTo,
          currency: row.currency,
          active: row.active,
          expiresAt: row.expiresAt,
          createdAt: row.createdAt,
          snapshots: row.snapshots.map((s) => ({
            id: s.id,
            price: s.price,
            currency: s.currency,
            airline: s.airline,
            stops: s.stops,
            duration: s.duration,
            bookingUrl: s.bookingUrl,
            travelDate: s.travelDate,
            scrapedAt: s.scrapedAt,
            status: s.status,
          })),
          lastScraped: row.fetchRuns[0]?.startedAt ?? null,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load query');
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  if (loading) {
    return (
      <Box>
        <Text color="cyan"><Spinner type="dots" /></Text>
        <Text>{' '}Loading query {id}...</Text>
      </Box>
    );
  }

  if (error) {
    return <Text color="red">{'⚠ '}{error}</Text>;
  }

  if (!query) return null;

  const available = query.snapshots.filter((s) => s.status === 'available');

  // Price history: latest per airline, sorted by price
  const latestByAirline = new Map<string, Snapshot>();
  for (const s of available) {
    if (!latestByAirline.has(s.airline) || s.scrapedAt > latestByAirline.get(s.airline)!.scrapedAt) {
      latestByAirline.set(s.airline, s);
    }
  }
  const priceHistory = [...latestByAirline.values()].sort((a, b) => a.price - b.price);

  return (
    <Box flexDirection="column">
      {/* Route header */}
      <Box marginBottom={1}>
        <Text bold color="white">{query.originName}</Text>
        <Text color="cyan">{' → '}</Text>
        <Text bold color="white">{query.destinationName}</Text>
        <Text dimColor>{'  '}{formatDate(query.dateFrom)} – {formatDate(query.dateTo)}</Text>
      </Box>

      {/* Chart */}
      <PriceChart snapshots={available} currency={query.currency} />

      {/* Best price */}
      <Box marginTop={1}>
        <BestPriceCard snapshots={available} />
      </Box>

      {/* Price history table */}
      {priceHistory.length > 0 && (
        <Box marginTop={1} flexDirection="column">
          <Text bold color="cyan">Current Prices</Text>
          <Box>
            <Text dimColor bold>{'Airline'.padEnd(16)}</Text>
            <Text dimColor bold>{'Price'.padEnd(10)}</Text>
            <Text dimColor bold>{'Stops'.padEnd(10)}</Text>
            <Text dimColor bold>{'Duration'.padEnd(10)}</Text>
            <Text dimColor bold>{'Seen'}</Text>
          </Box>
          {priceHistory.map((s) => (
            <Box key={s.id}>
              <Text>{s.airline.padEnd(16)}</Text>
              <Text color="green" bold>{formatCurrency(s.price, s.currency).padEnd(10)}</Text>
              <Text>{formatStops(s.stops).padEnd(10)}</Text>
              <Text dimColor>{(s.duration ?? '—').padEnd(10)}</Text>
              <Text dimColor>{formatTimeAgo(s.scrapedAt)}</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Status */}
      <Box marginTop={1}>
        <Text dimColor>
          ID: {query.id}  ·  {query.active ? 'Active' : 'Paused'}
          {query.lastScraped ? `  ·  Last scraped: ${formatTimeAgo(query.lastScraped)}` : ''}
          {available.length > 0 ? `  ·  ${available.length} snapshots` : ''}
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>{onBack ? 'b: back  ' : ''}q: quit</Text>
      </Box>
    </Box>
  );
}

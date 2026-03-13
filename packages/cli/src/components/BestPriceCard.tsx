import React from 'react';
import { Box, Text } from 'ink';
import { formatCurrency, formatStops } from '../lib/format.js';

interface Snapshot {
  price: number;
  currency: string;
  airline: string;
  stops: number;
  duration: string | null;
  bookingUrl: string;
  scrapedAt: Date;
}

interface BestPriceCardProps {
  snapshots: Snapshot[];
}

export function BestPriceCard({ snapshots }: BestPriceCardProps) {
  if (snapshots.length === 0) return null;

  const best = snapshots.reduce((min, s) => (s.price < min.price ? s : min), snapshots[0]!);

  return (
    <Box flexDirection="column">
      <Text color="cyan">{'┌─ Best Price ─────────────────────────┐'}</Text>
      <Text color="cyan">{'│'} <Text color="green" bold>{formatCurrency(best.price, best.currency)}</Text>{'  '}<Text color="white">{best.airline}</Text>{' · '}<Text dimColor>{formatStops(best.stops)}</Text>{best.duration ? ` · ${best.duration}` : ''}{'                                      '.slice(0, Math.max(0, 36 - formatCurrency(best.price, best.currency).length - best.airline.length - formatStops(best.stops).length - (best.duration?.length ?? 0) - 7))}<Text color="cyan">{'│'}</Text></Text>
      <Text color="cyan">{'│'} <Text dimColor>Book: {best.bookingUrl.slice(0, 33)}</Text><Text color="cyan">{' │'}</Text></Text>
      <Text color="cyan">{'└──────────────────────────────────────┘'}</Text>
    </Box>
  );
}

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { PriceData } from '../../../../apps/web/src/lib/scraper/extract-prices.js';

interface FlightTableProps {
  flights: PriceData[];
  currency: string;
  onConfirm: (selected: PriceData[]) => void;
  onBack: () => void;
}

function formatStops(stops: number): string {
  if (stops === 0) return 'Nonstop';
  if (stops === 1) return '1 stop';
  return `${stops} stops`;
}

export function FlightTable({ flights, currency, onConfirm, onBack }: FlightTableProps) {
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(() => {
    const initial = new Set<number>();
    flights.slice(0, 10).forEach((_, i) => initial.add(i));
    return initial;
  });

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((c) => Math.max(0, c - 1));
    } else if (key.downArrow) {
      setCursor((c) => Math.min(flights.length - 1, c + 1));
    } else if (input === ' ') {
      setSelected((s) => {
        const next = new Set(s);
        if (next.has(cursor)) {
          next.delete(cursor);
        } else if (next.size < 10) {
          next.add(cursor);
        }
        return next;
      });
    } else if (key.return) {
      const picked = flights.filter((_, i) => selected.has(i));
      if (picked.length > 0) onConfirm(picked);
    } else if (key.escape || input === 'b') {
      onBack();
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">Select flights to track</Text>
        <Text dimColor> ({selected.size}/10 selected)</Text>
      </Box>

      <Box>
        <Text dimColor>{'  '}</Text>
        <Text dimColor bold>{'Airline'.padEnd(16)}</Text>
        <Text dimColor bold>{'Price'.padEnd(10)}</Text>
        <Text dimColor bold>{'Stops'.padEnd(10)}</Text>
        <Text dimColor bold>{'Duration'.padEnd(10)}</Text>
        <Text dimColor bold>{'Date'}</Text>
      </Box>

      {flights.map((f, i) => {
        const isCursor = i === cursor;
        const isSelected = selected.has(i);
        const check = isSelected ? '◉' : '○';
        const checkColor = isSelected ? 'cyan' : 'gray';

        return (
          <Box key={`${f.airline}-${f.price}-${f.travelDate}-${i}`}>
            <Text color={isCursor ? 'cyan' : undefined}>{isCursor ? '▸ ' : '  '}</Text>
            <Text color={checkColor}>{check} </Text>
            <Text color={isCursor ? 'white' : undefined} bold={isCursor}>
              {f.airline.padEnd(14)}
            </Text>
            <Text color="green" bold>
              {`${currency} ${f.price}`.padEnd(10)}
            </Text>
            <Text>{formatStops(f.stops ?? 0).padEnd(10)}</Text>
            <Text dimColor>{(f.duration ?? '—').padEnd(10)}</Text>
            <Text dimColor>{f.travelDate}</Text>
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>↑↓: navigate  space: toggle  enter: confirm  b: back</Text>
      </Box>
    </Box>
  );
}

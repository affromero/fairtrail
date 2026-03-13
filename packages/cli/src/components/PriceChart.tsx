import React from 'react';
import { Box, Text } from 'ink';
import { renderBrailleChart, type ChartSeries } from '../lib/chart.js';
import { currencySymbol, formatDateShort } from '../lib/format.js';

interface Snapshot {
  price: number;
  currency: string;
  airline: string;
  scrapedAt: Date;
}

interface PriceChartProps {
  snapshots: Snapshot[];
  currency: string;
  width?: number;
  height?: number;
}

export function PriceChart({ snapshots, currency, width, height }: PriceChartProps) {
  const termWidth = width ?? Math.min(process.stdout.columns || 80, 120);
  const termHeight = height ?? Math.max(8, Math.min(Math.floor((process.stdout.rows || 24) * 0.4), 18));
  if (snapshots.length === 0) {
    return <Text dimColor>No price data yet — waiting for first scrape.</Text>;
  }

  // Group by airline
  const byAirline = new Map<string, Array<{ x: number; y: number }>>();
  for (const s of snapshots) {
    const t = s.scrapedAt.getTime();
    if (!byAirline.has(s.airline)) byAirline.set(s.airline, []);
    byAirline.get(s.airline)!.push({ x: t, y: s.price });
  }

  const series: ChartSeries[] = [];
  for (const [airline, points] of byAirline) {
    series.push({ label: airline, points });
  }

  // X-axis labels: spread across the date range
  const allTimes = snapshots.map((s) => s.scrapedAt.getTime());
  const minT = Math.min(...allTimes);
  const maxT = Math.max(...allTimes);
  const labelCount = Math.min(5, snapshots.length);
  const xLabels: string[] = [];
  for (let i = 0; i < labelCount; i++) {
    const t = minT + (i / (labelCount - 1 || 1)) * (maxT - minT);
    xLabels.push(formatDateShort(new Date(t)));
  }

  const chart = renderBrailleChart(series, {
    width: termWidth,
    height: termHeight,
    yLabel: currencySymbol(currency),
    xLabels,
  });

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">Price Evolution</Text>
      </Box>
      <Text>{chart}</Text>
    </Box>
  );
}

'use client';

import { useMemo } from 'react';
import dynamic from 'next/dynamic';
import { currencySymbol } from '@/lib/currency';
import styles from './PriceChart.module.css';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

interface Snapshot {
  id: string;
  travelDate: string;
  price: number;
  currency: string;
  airline: string;
  bookingUrl: string | null;
  stops: number;
  duration: string | null;
  flightId: string | null;
  departureTime: string | null;
  arrivalTime: string | null;
  seatsLeft: number | null;
  status: string;
  airlineDirectPrice: number | null;
  scrapedAt: string;
}

const AIRLINE_COLORS: Record<string, string> = {
  Delta: '#e31837',
  United: '#002244',
  American: '#0078d2',
  'Air France': '#002157',
  Southwest: '#ffbf27',
  JetBlue: '#003876',
  Spirit: '#ffe600',
  Alaska: '#01426a',
  British: '#2e5c99',
  Lufthansa: '#05164d',
  Emirates: '#d71a21',
  KLM: '#00a1de',
};

function getAirlineColor(airline: string, index: number): string {
  for (const [key, color] of Object.entries(AIRLINE_COLORS)) {
    if (airline.toLowerCase().includes(key.toLowerCase())) return color;
  }
  const fallback = ['#06b6d4', '#3b82f6', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#f0a500'];
  return fallback[index % fallback.length]!;
}

export function PriceChart({ snapshots, currency = 'USD' }: { snapshots: Snapshot[]; currency?: string }) {
  const sym = currencySymbol(currency);

  const traces = useMemo(() => {
    const available = snapshots.filter((s) => s.status !== 'sold_out');
    const soldOut = snapshots.filter((s) => s.status === 'sold_out');

    const byAirline = new Map<string, Snapshot[]>();
    for (const s of available) {
      const existing = byAirline.get(s.airline) ?? [];
      existing.push(s);
      byAirline.set(s.airline, existing);
    }

    let idx = 0;
    const result = Array.from(byAirline.entries()).map(([airline, points]) => {
      const color = getAirlineColor(airline, idx++);
      return {
        x: points.map((p) => p.scrapedAt),
        y: points.map((p) => p.price),
        type: 'scatter' as const,
        mode: 'lines+markers' as const,
        name: airline,
        line: { color, width: 2 },
        marker: { color, size: 6 },
        customdata: points.map((p) => [p.bookingUrl]),
        text: points.map((p) => {
          const lines = [
            `<b>${sym}${p.price.toFixed(2)}</b> ${p.currency}`,
            new Date(p.scrapedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
          ];
          if (p.departureTime || p.arrivalTime) {
            lines.push(`${p.departureTime ?? '?'} - ${p.arrivalTime ?? '?'}`);
          }
          if (p.duration) lines.push(p.duration);
          if (p.seatsLeft) lines.push(`${p.seatsLeft} seats left`);
          return lines.join('<br>');
        }),
        hovertemplate: '%{text}<extra>%{fullData.name}</extra>',
      };
    });

    if (soldOut.length > 0) {
      result.push({
        x: soldOut.map((p) => p.scrapedAt),
        y: soldOut.map((p) => p.price),
        type: 'scatter' as const,
        mode: 'lines+markers' as const,
        name: 'Sold out',
        line: { color: '#ef4444', width: 0 },
        marker: { color: '#ef4444', size: 10 },
        customdata: soldOut.map((p) => [p.bookingUrl]),
        text: soldOut.map((p) => {
          const lines = [
            `<b>${sym}${p.price.toFixed(2)}</b> (sold out)`,
            new Date(p.scrapedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
          ];
          if (p.departureTime || p.arrivalTime) {
            lines.push(`${p.departureTime ?? '?'} - ${p.arrivalTime ?? '?'}`);
          }
          return lines.join('<br>');
        }),
        hovertemplate: '%{text}<extra>Sold out</extra>',
      });
    }

    return result;
  }, [snapshots, sym]);

  if (snapshots.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>No price data yet</p>
        <p className={styles.emptyHint}>
          Prices will appear after the first scrape runs. Check back soon.
        </p>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <Plot
        data={traces}
        layout={{
          paper_bgcolor: 'transparent',
          plot_bgcolor: 'transparent',
          font: { family: 'IBM Plex Mono, monospace', color: '#8b9ec2', size: 11 },
          margin: { t: 20, r: 20, b: 50, l: 60 },
          xaxis: {
            gridcolor: '#243049',
            tickformat: '%b %d',
            title: { text: '' },
          },
          yaxis: {
            gridcolor: '#243049',
            tickprefix: sym,
            title: { text: '' },
          },
          legend: {
            orientation: 'h',
            y: -0.15,
            font: { size: 11 },
          },
          hovermode: 'closest',
          autosize: true,
        }}
        config={{
          responsive: true,
          displayModeBar: false,
        }}
        style={{ width: '100%', height: '400px' }}
        onClick={(data) => {
          const point = data.points[0];
          if (point?.customdata) {
            const url = (point.customdata as string[])[0];
            if (url) window.open(url, '_blank');
          }
        }}
      />
    </div>
  );
}

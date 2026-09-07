import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Box, Text, useApp, useInput, useStdout } from 'ink';
import { CarBrowser as Browser, carTerminalText } from '../lib/car-browser.js';
import { formatCarMoney } from '../../../../apps/web/src/lib/cars/money.js';

export function CarBrowser({ browser, signal }: { browser: Browser; signal: AbortSignal }) {
  const state = useSyncExternalStore(browser.subscribe, browser.getSnapshot);
  const { exit } = useApp(), { stdout } = useStdout();
  const [selected, setSelected] = useState(0), [offset, setOffset] = useState(0);
  const [rows, setRows] = useState(stdout.rows || 24);
  const available = Math.max(1, rows - (state.detail ? 14 : 9));
  const selection = Math.min(selected, Math.max(0, state.trackers.length - 1));
  const snapshots = state.detail?.snapshots ?? [];
  const historyOffset = Math.min(offset, Math.max(0, snapshots.length - available));
  useEffect(() => {
    const resize = () => setRows(stdout.rows || 24);
    stdout.on('resize', resize);
    return () => { stdout.off('resize', resize); };
  }, [stdout]);
  useEffect(() => {
    const stop = () => { browser.close(); exit(); };
    signal.addEventListener('abort', stop, { once: true });
    if (signal.aborted) stop(); else void browser.reload();
    return () => { signal.removeEventListener('abort', stop); browser.close(); };
  }, [browser, signal, exit]);
  useInput((input, key) => {
    if (input === 'q' || key.ctrl && input === 'c') { browser.close(); exit(); return; }
    if (input === 'r') { void browser.reload(); return; }
    if (state.busy) return;
    if (key.escape && state.detail) { setOffset(0); void browser.back(); return; }
    if (state.detail) {
      if (key.downArrow) setOffset(Math.min(historyOffset + 1, Math.max(0, snapshots.length - available)));
      if (key.upArrow) setOffset(Math.max(0, historyOffset - 1));
      return;
    }
    if (key.downArrow) setSelected(Math.min(selection + 1, state.trackers.length - 1));
    if (key.upArrow) setSelected(Math.max(0, selection - 1));
    if (key.return && state.trackers[selection]) { setOffset(0); void browser.open(state.trackers[selection].id); }
    if (input === 'n') { setSelected(0); void browser.nextPage(); }
    if (input === 'b') { setSelected(0); void browser.previousPage(); }
  });
  const price = (minor: number | null, currency: string) => minor === null ? 'No eligible price' : formatCarMoney({ minor, currency });
  const start = Math.max(0, selection - available + 1);
  return <Box flexDirection="column" paddingX={1}>
    <Text bold color="#80a8a5">FLIGHT FINDER / CARS</Text>
    <Text dimColor>Whole-rental prices · independent of flights and hotels</Text>
    {state.error && <Text color="#c1272d" wrap="truncate-end">{carTerminalText(state.error)}</Text>}
    {state.busy && <Text color="#80a8a5">Loading verified rental data…</Text>}
    {!state.hidden && !state.detail && <>
      <Text color="#ecdfc0">YOUR TRACKERS · PAGE {state.page + 1}</Text>
      {!state.busy && state.trackers.length === 0 && <Text>No car trackers. Use cars search, then cars track to save an offer.</Text>}
      {state.trackers.slice(start, start + available).map((tracker, index) => <Text key={tracker.id} color={start + index === selection ? '#80a8a5' : '#ecdfc0'} wrap="truncate-end">
        {start + index === selection ? '› ' : '  '}{carTerminalText(tracker.label)} · {tracker.active ? 'Active' : 'Paused'} · {price(tracker.latestPriceMinor, tracker.currency)}
      </Text>)}
      <Text dimColor>↑↓ select · Enter history · {state.nextCursor ? 'n next page · ' : ''}{state.page > 0 ? 'b previous page · ' : ''}r reload</Text>
    </>}
    {!state.hidden && state.detail && <>
      <Text bold color="#ecdfc0" wrap="truncate-end">{carTerminalText(state.detail.tracker.label)}</Text>
      <Text>{state.detail.tracker.active ? 'Active' : 'Paused'} · revision {state.detail.tracker.revision} · {carTerminalText(state.detail.tracker.id)}</Text>
      <Text color="#80a8a5">Latest: {price(state.detail.tracker.latestPriceMinor, state.detail.tracker.currency)} · Low: {price(state.detail.tracker.historicalLowMinor, state.detail.tracker.currency)}</Text>
      <Text dimColor>{state.detail.notificationsConfigured ? 'Notification channel configured; delivery is not guaranteed.' : 'No notification channel configured. Configure one in server settings.'}</Text>
      {state.detail.tracker.lastError && <Text color="#c1272d" wrap="truncate-end">Last check: {carTerminalText(state.detail.tracker.lastError)}</Text>}
      <Text bold>PRICE EVIDENCE · {snapshots.length ? `${historyOffset + 1}–${Math.min(historyOffset + available, snapshots.length)} of ${snapshots.length}` : 'No observations yet'}</Text>
      {snapshots.slice(historyOffset, historyOffset + available).map(snapshot => <Text key={snapshot.id} wrap="truncate-end">
        {snapshot.observedAt.slice(0, 16).replace('T', ' ')} UTC · {price(snapshot.totalMinor, snapshot.currency)} · {snapshot.eligible ? 'Eligible' : `Excluded: ${carTerminalText(snapshot.reasons.join('; '))}`} · {carTerminalText(snapshot.source)}
      </Text>)}
      <Text dimColor>↑↓ history · Esc trackers · r reload status</Text>
    </>}
    <Text dimColor>q quit (server work continues) · Commands and recovery: cars --help</Text>
  </Box>;
}

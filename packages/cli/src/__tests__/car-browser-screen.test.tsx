import React from 'react';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';
import { stripVTControlCharacters } from 'node:util';
import { render } from 'ink';
import { expect, it, vi } from 'vitest';
import { CarBrowser as Browser } from '../lib/car-browser.js';
import { CarClient } from '../lib/car-client.js';
import { CarBrowser } from '../screens/CarBrowser.js';
import { carTrackerViewFixture } from '../../../../apps/web/src/test/car-fixtures.js';

it('renders exact prices, opens history by keyboard, resizes, and quits without mutating server work', async () => {
  const methods: string[] = [];
  const tracker = { ...carTrackerViewFixture(), label: 'Heathrow rental', latestPriceMinor: 12345 };
  const server = createServer((request, response) => {
    methods.push(request.method!);
    const data = request.url === '/api/cars/session' ? { scope: 'user:alice', isAdmin: false }
      : request.url === `/api/cars/${tracker.id}` ? { tracker, snapshots: [], runs: [], latestObservation: null, notificationsConfigured: false, canReassign: false }
        : { trackers: [tracker], nextCursor: null };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, data }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local server');
  const stdout = Object.assign(new PassThrough(), { columns: 90, rows: 24, isTTY: true }) as unknown as NodeJS.WriteStream;
  const stdin = Object.assign(new PassThrough(), { isTTY: true, setRawMode: () => stdin, ref: () => stdin, unref: () => stdin }) as unknown as NodeJS.ReadStream;
  const stderr = new PassThrough() as unknown as NodeJS.WriteStream;
  let output = '';
  stdout.on('data', chunk => { output += String(chunk); });
  const browser = new Browser(new CarClient(`http://127.0.0.1:${address.port}`));
  const instance = render(<CarBrowser browser={browser} signal={new AbortController().signal} />, {
    stdout, stdin, stderr, interactive: true, exitOnCtrlC: false, patchConsole: false,
  });
  try {
    await vi.waitFor(() => expect(stripVTControlCharacters(output)).toContain('Heathrow rental'));
    expect(stripVTControlCharacters(output)).toContain('123.45');
    output = ''; stdin.push('\r');
    await vi.waitFor(() => expect(stripVTControlCharacters(output)).toContain('PRICE EVIDENCE'));
    expect(stripVTControlCharacters(output)).toContain('No observations yet');
    expect(stripVTControlCharacters(output)).toContain('No notification channel configured');
    stdout.rows = 16; stdout.columns = 42; stdout.emit('resize');
    await instance.waitUntilRenderFlush();
    output = ''; stdin.push('\u001b');
    await vi.waitFor(() => expect(stripVTControlCharacters(output)).toContain('YOUR TRACKERS'));
    stdin.push('q'); await instance.waitUntilExit();
    expect(browser.getSnapshot()).toMatchObject({ hidden: true, trackers: [], detail: null });
    expect(methods.every(method => method === 'GET')).toBe(true);
  } finally {
    instance.unmount(); instance.cleanup(); browser.close();
    stdin.destroy(); stdout.destroy(); stderr.destroy();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

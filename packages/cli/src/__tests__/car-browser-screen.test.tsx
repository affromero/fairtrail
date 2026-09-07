import React from 'react';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';
import { stripVTControlCharacters } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink';
import { expect, it, vi } from 'vitest';
import { CarBrowser as Browser } from '../lib/car-browser.js';
import { CarClient } from '../lib/car-client.js';
import { CarBrowser } from '../screens/CarBrowser.js';
import { carTrackerViewFixture } from '../../../../apps/web/src/test/car-fixtures.js';

it.each([
  { editing: false, behavior: 'renders exact prices, opens history, resizes, and exits without server mutations' },
  { editing: true, behavior: 'requires confirmation, recovers a lost refresh reply, and cancels an unsubmitted pause by keyboard' },
])('$behavior', async ({ editing }) => {
  const methods: string[] = [];
  const directory = await mkdtemp(join(tmpdir(), 'car-browser-screen-'));
  const jobs = new Set<string>(); let loseRefreshReply = true;
  let tracker = { ...carTrackerViewFixture(), label: 'Heathrow rental', latestPriceMinor: 12345 };
  const server = createServer(async (request, response) => {
    methods.push(request.method!);
    if (request.method === 'POST') {
      const refreshKey = String(request.headers['idempotency-key']); jobs.add(refreshKey);
      if (loseRefreshReply) { loseRefreshReply = false; response.destroy(); return; }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, data: { id: 'run-one', status: 'success', trackerId: tracker.id, refreshKey } })); return;
    }
    if (request.method === 'PATCH') {
      let body = ''; for await (const chunk of request) body += String(chunk);
      tracker = { ...tracker, active: Boolean(JSON.parse(body).active), revision: tracker.revision + 1 };
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, data: { tracker } })); return;
    }
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
  let diagnostics = '';
  stdout.on('data', chunk => { output += String(chunk); });
  stderr.on('data', chunk => { diagnostics += String(chunk); });
  const browser = new Browser(new CarClient(`http://127.0.0.1:${address.port}`), false, directory);
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
    if (editing) {
      output = ''; stdin.push('c');
      await vi.waitFor(() => expect(stripVTControlCharacters(output)).toContain('CONFIRM CHANGE / Check prices'));
      expect(methods.every(method => method === 'GET')).toBe(true);
      stdin.push('yes'); await vi.waitFor(() => expect(stripVTControlCharacters(output)).toContain('Enter: yes'));
      stdin.push('\r');
      await vi.waitFor(() => expect(browser.getSnapshot().recoveries[0]?.outcome).toBe('unconfirmed'));
      expect(diagnostics).toContain(browser.getReceiptPaths()[0]);
      output = ''; stdin.push('t');
      await vi.waitFor(() => expect(stripVTControlCharacters(output)).toContain('RECOVER A SAVED REQUEST'));
      stdin.push('1'); await vi.waitFor(() => expect(stripVTControlCharacters(output)).toContain('Receipt: 1')); stdin.push('\r');
      await vi.waitFor(() => expect(stripVTControlCharacters(output)).toContain('RETRY SAVED REQUEST'));
      output = ''; stdin.push('yes'); await vi.waitFor(() => expect(stripVTControlCharacters(output)).toContain('Enter: yes')); stdin.push('\r');
      await vi.waitFor(() => expect(browser.getSnapshot().recoveries[0]?.outcome).toBe('confirmed'));
      await vi.waitFor(() => expect(browser.getSnapshot().busy).toBe(false));
      expect(jobs.size).toBe(1);
      output = ''; stdin.push('p');
      await vi.waitFor(() => expect(stripVTControlCharacters(output)).toContain('Pause tracking'));
      stdin.push('\u001b');
      await vi.waitFor(() => expect(browser.getSnapshot().confirmation).toBeNull());
      expect(methods).not.toContain('PATCH');
      stdin.push('p'); await vi.waitFor(() => expect(browser.getSnapshot().confirmation).not.toBeNull());
      output = ''; stdin.push('yes'); await vi.waitFor(() => expect(stripVTControlCharacters(output)).toContain('Enter: yes')); stdin.push('\r');
      await vi.waitFor(() => expect(browser.getSnapshot().detail?.tracker.active).toBe(false));
    }
    stdout.rows = 16; stdout.columns = 42; stdout.emit('resize');
    await instance.waitUntilRenderFlush();
    output = ''; stdin.push('\u001b');
    await vi.waitFor(() => expect(stripVTControlCharacters(output)).toContain('YOUR TRACKERS'));
    stdin.push('q'); await instance.waitUntilExit();
    expect(browser.getSnapshot()).toMatchObject({ hidden: true, trackers: [], detail: null });
    expect(methods.filter(method => method !== 'GET')).toEqual(editing ? ['POST', 'POST', 'PATCH'] : []);
  } finally {
    instance.unmount(); instance.cleanup(); browser.close(); await browser.settle();
    stdin.destroy(); stdout.destroy(); stderr.destroy();
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

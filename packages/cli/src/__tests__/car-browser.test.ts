import { createServer, type Server, type ServerResponse, type IncomingMessage } from 'node:http';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { CarClient } from '../lib/car-client.js';
import { CarBrowser, carTerminalText } from '../lib/car-browser.js';
import { carTrackerViewFixture } from '../../../../apps/web/src/test/car-fixtures.js';

let server: Server, browser: CarBrowser, scope: string;
let handler: (request: IncomingMessage, response: ServerResponse) => void;
function reply(response: ServerResponse, data: unknown, status = 200) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(status === 200 ? { ok: true, data } : { ok: false, error: 'Access unavailable' }));
}
beforeEach(async () => {
  scope = 'user:alice';
  handler = (request, response) => reply(response, { trackers: [carTrackerViewFixture()], nextCursor: null });
  server = createServer((request, response) => {
    if (request.url === '/api/cars/session') return reply(response, { scope, isAdmin: false });
    handler(request, response);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No local server');
  browser = new CarBrowser(new CarClient(`http://127.0.0.1:${address.port}`));
});
afterEach(async () => {
  browser.close(); server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
});

it('browses pages in both directions and stops at the first and last page', async () => {
  handler = (request, response) => reply(response, {
    trackers: [{ ...carTrackerViewFixture(), id: request.url?.includes('cursor=second') ? 'tracker-two' : 'tracker-one' }],
    nextCursor: request.url?.includes('cursor=second') ? null : 'second',
  });
  await browser.reload(); await browser.previousPage();
  expect(browser.getSnapshot().trackers[0]?.id).toBe('tracker-one');
  await browser.nextPage(); await browser.nextPage();
  expect(browser.getSnapshot()).toMatchObject({ page: 1, trackers: [{ id: 'tracker-two' }] });
  await browser.previousPage();
  expect(browser.getSnapshot()).toMatchObject({ page: 0, trackers: [{ id: 'tracker-one' }] });
});

it('hides prior private data when the account changes during a response', async () => {
  await browser.reload();
  handler = (request, response) => {
    scope = 'user:bob';
    reply(response, { trackers: [carTrackerViewFixture()], nextCursor: null });
  };
  await browser.reload();
  expect(browser.getSnapshot()).toMatchObject({ hidden: true, trackers: [], detail: null, scope: null });
  await browser.reload();
  expect(browser.getSnapshot()).toMatchObject({ hidden: false, scope: 'user:bob' });
});

it('clears private data on revoked access without claiming the tracker was deleted', async () => {
  await browser.reload();
  handler = (request, response) => reply(response, null, 404);
  await browser.open('tracker-one');
  expect(browser.getSnapshot()).toMatchObject({ hidden: true, trackers: [], detail: null });
  expect(browser.getSnapshot().error).toMatch(/access/i);
});

it('does not let an old response replace a newer page', async () => {
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { started = resolve; });
  handler = (request, response) => {
    release = () => reply(response, { trackers: [{ ...carTrackerViewFixture(), label: 'Old private result' }], nextCursor: null });
    started!();
  };
  const old = browser.reload(); await pending;
  handler = (request, response) => reply(response, { trackers: [], nextCursor: null });
  await browser.reload(); release!(); await old;
  expect(browser.getSnapshot()).toMatchObject({ trackers: [], busy: false, error: null });
});

it('closing aborts local reads and prevents late private data from appearing', async () => {
  let started: (() => void) | undefined;
  const pending = new Promise<void>(resolve => { started = resolve; });
  handler = () => { started!(); };
  const read = browser.reload(); await pending; browser.close(); await read;
  expect(browser.getSnapshot()).toMatchObject({ trackers: [], detail: null, scope: null, hidden: true, busy: false });
});

it('removes remote terminal commands and invisible direction overrides', () => {
  expect(carTerminalText('\x1b[31mSupplier\x1b[0m\u202eevil\nname')).toBe('Supplier evil name');
});

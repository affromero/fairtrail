import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CarClient } from '../lib/car-client.js';

let server: Server, origin: string;
let handle: (request: IncomingMessage, response: ServerResponse) => void;
beforeEach(async () => {
  handle = (request, response) => response.end(JSON.stringify({ ok: true, data: { path: request.url, headers: request.headers } }));
  server = createServer((request, response) => handle(request, response));
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing local server');
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

describe('car CLI HTTP boundary', () => {
  it('sends account credentials and revision-bound retry identity only to the selected server', async () => {
    const value = await new CarClient(origin, 'account-session', 'machine-token').request('/api/cars/tracker/scrape', { method: 'POST', idempotencyKey: 'original-request', revision: 4 });
    expect(value).toMatchObject({ path: '/api/cars/tracker/scrape', headers: { cookie: 'ft-session=account-session', authorization: 'Bearer machine-token', 'idempotency-key': 'original-request', 'x-car-revision': '4' } });
  });
  it.each(['/api/cars-other', '/api/cars/../admin/config', '/api/cars/%2e%2e/admin', '/api/cars/%252e%252e/admin', '/api/cars\\..\\admin', '//example.com/api/cars', 'https://example.com/api/cars'])('rejects an out-of-scope destination before sending credentials: %s', async path => {
    let received = false; handle = (request, response) => { received = true; response.end(); };
    await expect(new CarClient(origin, 'secret').request(path)).rejects.toThrow(/Invalid car API/);
    expect(received).toBe(false);
  });
  it('does not follow redirects or forward credentials to the redirect target', async () => {
    const paths: string[] = [];
    handle = (request, response) => { paths.push(request.url!); response.writeHead(302, { Location: '/api/cars/other' }); response.end(); };
    await expect(new CarClient(origin, 'secret').request('/api/cars')).rejects.toThrow();
    expect(paths).toEqual(['/api/cars']);
  });
  it.each([401, 403, 404, 409, 410, 412])('preserves structured HTTP %i rejection semantics for recovery', async status => {
    handle = (request, response) => { response.writeHead(status); response.end(JSON.stringify({ ok: false, error: 'Request unavailable' })); };
    await expect(new CarClient(origin).request('/api/cars')).rejects.toMatchObject({ status, definitive: true, message: 'Request unavailable' });
  });
  it('retains uncertain semantics for a malformed acknowledgement', async () => {
    handle = (request, response) => { response.writeHead(503); response.end('<html>Unavailable</html>'); };
    await expect(new CarClient(origin).request('/api/cars')).rejects.toMatchObject({ status: 503, definitive: false });
  });
  it('bounds a chunked response without trusting Content-Length', async () => {
    handle = (request, response) => { response.writeHead(200); response.write('x'.repeat(256)); };
    await expect(new CarClient(origin).request('/api/cars', { maxResponseBytes: 128 })).rejects.toMatchObject({ definitive: false, message: expect.stringContaining('size') });
  });
  it('cancels a stalled response without issuing a server cancellation mutation', async () => {
    const abort = new AbortController(), methods: string[] = [];
    handle = (request, response) => { methods.push(request.method!); response.writeHead(200); response.write('{'); abort.abort(); };
    await expect(new CarClient(origin).request('/api/cars', { signal: abort.signal })).rejects.toThrow();
    expect(methods).toEqual(['GET']);
  });
  it('bounds a server that never sends response headers', async () => {
    handle = () => undefined;
    await expect(new CarClient(origin).request('/api/cars', { timeoutMs: 25 })).rejects.toThrow();
  });
});

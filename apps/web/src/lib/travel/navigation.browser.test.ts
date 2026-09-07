import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { launchBrowser } from '../scraper/browser';
import { guardTravelNavigation } from './navigation';

describe.skipIf(process.env.TRAVEL_BROWSER_TESTS !== '1')('guarded browser redirects', () => {
  let server: Server;
  let browser: Browser;
  let origin: string;
  let forbiddenRequests = 0;
  beforeAll(async () => {
    server = createServer((request, response) => {
      if (request.url === '/forbidden') forbiddenRequests++;
      const paths: Record<string, string> = { '/redirect': '/success', '/error-redirect': '/unavailable', '/unsafe': '/forbidden', '/malformed': 'http://[' };
      if (request.url && paths[request.url]) {
        response.writeHead(302, { location: paths[request.url]! }); response.end(); return;
      }
      if (request.url === '/unavailable') {
        setTimeout(() => { response.writeHead(503); response.end('<h1>Rental results</h1><a href="/options?rate_reference=stale">Select car</a>'); }, 100); return;
      }
      response.writeHead(200, { 'content-type': 'text/html' }); response.end('<h1>Rental results</h1>');
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server port');
    origin = `http://127.0.0.1:${address.port}`;
    browser = await launchBrowser();
  });
  afterAll(async () => {
    await browser?.close();
    if (server) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  });
  const allowed = (url: URL) => url.origin === origin && url.pathname !== '/forbidden';
  it('follows allowed redirects and supports repeated independent navigation', async () => {
    const page = await browser.newPage();
    try {
      const guard = await guardTravelNavigation(page, 'fixture', allowed);
      for (let run = 0; run < 2; run++) {
        guard.reset();
        await page.goto(`${origin}/redirect`);
        await guard.settle();
        expect(await page.locator('h1').textContent()).toBe('Rental results');
        expect(page.url()).toBe(`${origin}/success`);
      }
      await expect(guardTravelNavigation(page, 'different-provider', allowed)).rejects.toThrow(/policy/);
    } finally { await page.close(); }
  });
  it.each(['/unsafe', '/malformed'])('rejects an unsafe redirect without requesting its destination: %s', async path => {
    const page = await browser.newPage();
    try {
      await guardTravelNavigation(page, 'fixture', allowed);
      await expect(page.goto(`${origin}${path}`)).rejects.toThrow(/ERR_BLOCKED_BY_CLIENT/);
      expect(forbiddenRequests).toBe(0);
    } finally { await page.close(); }
  });
  it('rejects a delayed terminal HTTP error even when it contains selectable offer markup', async () => {
    const page = await browser.newPage();
    try {
      const guard = await guardTravelNavigation(page, 'fixture', allowed);
      await page.goto(`${origin}/error-redirect`);
      await expect(guard.settle()).rejects.toThrow(/503/);
    } finally { await page.close(); }
  });
});

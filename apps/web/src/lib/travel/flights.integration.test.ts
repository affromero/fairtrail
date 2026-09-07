import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { prisma } from '@/lib/prisma';
import { runFullScrapeForQuery, runScrapeAll, runScrapeForQuery } from '../scraper/run-scrape';
import { getTravelAdmission } from './admission';

const boundary = vi.hoisted(() => ({ navigate: vi.fn(), extract: vi.fn() }));
vi.mock('../scraper/navigate', async original => ({ ...await original<typeof import('../scraper/navigate')>(), navigateGoogleFlights: boundary.navigate }));
vi.mock('../scraper/extract-prices', async original => ({ ...await original<typeof import('../scraper/extract-prices')>(), extractPrices: boundary.extract }));

describe.skipIf(process.env.TRAVEL_FLIGHT_INTEGRATION_TESTS !== '1')('canonical flight execution through shared PostgreSQL admission', () => {
  let previous: { vpnProvider: string | null; vpnCountries: string[]; enabled: boolean; aggregatorsEnabled: string[]; defaultCurrency: string | null; defaultCountry: string | null } | null;
  let owner = '', connected = false;
  const seen: { query: string; country: string | null; tunnel: boolean }[] = [];
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
    if (url.hostname !== '127.0.0.1' || url.port !== '55440' || url.pathname !== '/travel_flight_test') throw new Error('Flight cutover tests require disposable localhost:55440/travel_flight_test');
    if (await prisma.query.count({ where: { active: true } })) throw new Error('Flight cutover tests require no unrelated active queries in the disposable database');
    previous = await prisma.extractionConfig.findUnique({ where: { id: 'singleton' }, select: { vpnProvider: true, vpnCountries: true, enabled: true, aggregatorsEnabled: true, defaultCurrency: true, defaultCountry: true } });
    owner = (await prisma.user.create({ data: { username: `flight-cutover-${crypto.randomUUID()}` } })).id;
  });
  beforeEach(async () => {
    await prisma.travelJob.deleteMany(); await prisma.travelLease.deleteMany(); await prisma.travelAdmission.deleteMany();
    await prisma.extractionConfig.upsert({ where: { id: 'singleton' }, create: { enabled: true, vpnProvider: 'expressvpn', vpnCountries: ['US'], aggregatorsEnabled: ['google_flights'], defaultCurrency: 'GBP', defaultCountry: 'GB' }, update: { enabled: true, vpnProvider: 'expressvpn', vpnCountries: ['US'], aggregatorsEnabled: ['google_flights'], defaultCurrency: 'GBP', defaultCountry: 'GB' } });
    connected = false; seen.length = 0;
    vi.stubEnv('EXPRESSVPN_API_URL', 'http://vpn.test'); vi.stubEnv('EXPRESSVPN_SOCKS_URL', '');
    vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
      if (url.endsWith('/v1/status')) return new Response(connected ? 'Connected to USA - New York' : 'Not connected');
      if (url.endsWith('/v1/publicip/ip')) return new Response('8.8.8.8');
      if (url.endsWith('/v1/connect/usny') && init.method === 'POST') { connected = true; return new Response('Connected'); }
      if (url.endsWith('/v1/disconnect') && init.method === 'POST') { connected = false; return new Response('Disconnected'); }
      throw new Error('Unexpected external request');
    });
    boundary.navigate.mockReset().mockImplementation(async params => {
      seen.push({ query: params.origin, country: params.country, tunnel: connected });
      return { html: '<html>Provider result</html>', url: 'https://www.google.com/travel/flights', resultsFound: true, source: 'google_flights' };
    });
    boundary.extract.mockReset().mockImplementation(async (...args) => ({ prices: [{ travelDate: args[2], price: 350, currency: args[7], airline: 'Delta', bookingUrl: '', stops: 0, duration: '5h' }], usage: { inputTokens: 0, outputTokens: 0 } }));
  });
  afterEach(async () => {
    await prisma.travelJob.deleteMany();
    await prisma.query.deleteMany({ where: { userId: owner } });
    await prisma.travelLease.deleteMany(); await prisma.travelAdmission.deleteMany();
    vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks();
  });
  afterAll(async () => {
    if (!owner) return;
    await prisma.user.delete({ where: { id: owner } });
    if (previous) await prisma.extractionConfig.update({ where: { id: 'singleton' }, data: previous });
    else await prisma.extractionConfig.delete({ where: { id: 'singleton' } });
    await prisma.$disconnect();
  });
  async function query(origin = 'LHR') {
    return prisma.query.create({ data: { userId: owner, rawInput: 'Flight cutover regression', origin, originName: origin, destination: 'JFK', destinationName: 'New York', dateFrom: new Date('2027-05-01'), dateTo: new Date('2027-05-10'), expiresAt: new Date('2027-05-01'), currency: 'GBP', cabinClass: 'business', scrapeInterval: 6 } });
  }
  it('keeps the manual FetchRun across local and verified VPN passes without changing query preferences', async () => {
    const row = await query();
    const first = await prisma.fetchRun.create({ data: { queryId: row.id, status: 'in_progress' } });
    const results = await runFullScrapeForQuery(row.id, { fetchRunId: first.id });
    expect(results.map(result => result.status)).toEqual(['success', 'success']);
    expect(seen).toEqual([{ query: 'LHR', country: 'GB', tunnel: false }, { query: 'LHR', country: 'US', tunnel: true }]);
    expect(connected).toBe(false);
    const runs = await prisma.fetchRun.findMany({ where: { queryId: row.id }, orderBy: { startedAt: 'asc' } });
    expect(runs).toHaveLength(2); expect(runs[0]?.id).toBe(first.id);
    expect(runs.every(run => run.status === 'success' && run.travelJobId !== null)).toBe(true);
    expect(await prisma.query.findUnique({ where: { id: row.id } })).toMatchObject({ currency: 'GBP', cabinClass: 'business', scrapeInterval: 6, vpnCountries: [] });
  }, 20_000);
  it('preserves country-grouped batch execution and does not recheck queries before their configured interval', async () => {
    await query('LHR'); await query('CDG');
    expect(await runScrapeAll()).toHaveLength(4);
    expect(seen.map(value => ({ country: value.country, tunnel: value.tunnel }))).toEqual([{ country: 'GB', tunnel: false }, { country: 'GB', tunnel: false }, { country: 'US', tunnel: true }, { country: 'US', tunnel: true }]);
    expect(new Set(seen.slice(0, 2).map(value => value.query))).toEqual(new Set(['LHR', 'CDG']));
    expect(await runScrapeAll()).toEqual([]);
    expect(seen).toHaveLength(4);
  }, 45_000);
  it('establishes the requested VPN country for a standalone single-country check', async () => {
    const row = await query();
    expect((await runScrapeForQuery(row.id, 'US')).status).toBe('success');
    expect(seen).toEqual([{ query: 'LHR', country: 'US', tunnel: true }]);
    expect((await prisma.priceSnapshot.findFirstOrThrow({ where: { queryId: row.id } })).vpnCountry).toBe('US');
    expect(connected).toBe(false);
  }, 15_000);
  it('rejects stale observations after a query changes during extraction', async () => {
    const row = await query();
    boundary.navigate.mockImplementation(async () => {
      await prisma.query.update({ where: { id: row.id }, data: { label: 'Updated by owner' } });
      return { html: '<html>Old result</html>', url: 'https://www.google.com/travel/flights', resultsFound: true, source: 'google_flights' };
    });
    await expect(runFullScrapeForQuery(row.id)).rejects.toThrow(/changed/);
    expect(await prisma.priceSnapshot.count({ where: { queryId: row.id } })).toBe(0);
    expect(await prisma.fetchRun.findMany({ where: { queryId: row.id } })).toMatchObject([{ status: 'failed', completedAt: expect.any(Date) }]);
    expect((await getTravelAdmission()).quarantinedAt).toBeNull();
  }, 15_000);
});

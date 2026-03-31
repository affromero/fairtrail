import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const { mockPrisma, mockNavigateGoogleFlights, mockExtractPrices } = vi.hoisted(() => {
  const mockPrisma = {
    query: { findUnique: vi.fn() },
    fetchRun: { create: vi.fn(), update: vi.fn() },
    extractionConfig: { findFirst: vi.fn() },
    priceSnapshot: { createMany: vi.fn(), findMany: vi.fn() },
    apiUsageLog: { create: vi.fn() },
  };
  const mockNavigateGoogleFlights = vi.fn();
  const mockExtractPrices = vi.fn();
  return { mockPrisma, mockNavigateGoogleFlights, mockExtractPrices };
});

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

vi.mock('./navigate', () => ({
  navigateGoogleFlights: (...args: unknown[]) => mockNavigateGoogleFlights(...args),
  navigateAirlineDirect: vi.fn(),
}));

vi.mock('./extract-prices', () => ({
  extractPrices: (...args: unknown[]) => mockExtractPrices(...args),
}));

vi.mock('./ai-registry', () => ({
  getModelCosts: vi.fn().mockReturnValue({ costPer1kInput: 0, costPer1kOutput: 0 }),
}));

vi.mock('./airline-urls', () => ({
  isKnownAirline: vi.fn().mockReturnValue(false),
}));

vi.mock('./country-profiles', () => ({
  getCountryProfile: vi.fn().mockReturnValue(undefined),
}));

vi.mock('./vpn', () => ({
  createVpnProvider: vi.fn().mockReturnValue({
    type: 'none',
    getStatus: vi.fn().mockResolvedValue({ connected: false, currentLocation: null, currentCountry: null }),
    connect: vi.fn().mockResolvedValue(true),
    disconnect: vi.fn().mockResolvedValue(undefined),
    listLocations: vi.fn().mockResolvedValue([]),
    isSystemWide: vi.fn().mockReturnValue(false),
  }),
}));

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { runScrapeForQuery } from './run-scrape';

const BASE_QUERY = {
  id: 'q1',
  active: true,
  isSeed: false,
  origin: 'JFK',
  destination: 'LAX',
  dateFrom: new Date('2026-06-15'),
  dateTo: new Date('2026-06-20'),
  cabinClass: 'economy',
  tripType: 'round_trip',
  currency: null,
  preferredAirlines: [],
  maxPrice: null,
  maxStops: null,
  timePreference: 'any',
  lookAheadDays: 14,
  expiresAt: new Date('2027-01-01'),
};

describe('runScrapeForQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.query.findUnique.mockResolvedValue(BASE_QUERY);
    mockPrisma.fetchRun.create.mockResolvedValue({ id: 'run1' });
    mockPrisma.fetchRun.update.mockResolvedValue({});
    mockPrisma.extractionConfig.findFirst.mockResolvedValue({
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      scrapeInterval: 3,
      defaultCurrency: null,
      defaultCountry: null,
      vpnProvider: null,
      vpnCountries: [],
    });
    mockPrisma.priceSnapshot.findMany.mockResolvedValue([]);
    mockPrisma.priceSnapshot.createMany.mockResolvedValue({ count: 1 });
    mockPrisma.apiUsageLog.create.mockResolvedValue({});
    mockNavigateGoogleFlights.mockResolvedValue({
      html: '<html>flights</html>',
      url: 'https://flights.google.com',
      resultsFound: true,
      source: 'google_flights',
    });
  });

  it('stores empty-string bookingUrl when extractPrices coerced null to empty string', async () => {
    mockExtractPrices.mockResolvedValue({
      prices: [{
        travelDate: '2026-06-15',
        price: 350,
        currency: 'USD',
        airline: 'Delta',
        bookingUrl: '',
        stops: 0,
        duration: '5h',
        departureTime: null,
        arrivalTime: null,
        seatsLeft: null,
      }],
      usage: { inputTokens: 100, outputTokens: 20 },
    });

    const result = await runScrapeForQuery('q1');

    expect(result.status).toBe('success');
    expect(result.snapshotsCount).toBe(1);
    expect(mockPrisma.priceSnapshot.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ bookingUrl: '' }),
      ]),
    });
  });

  it('marks previously available flight as sold_out when it disappears', async () => {
    mockPrisma.priceSnapshot.findMany.mockResolvedValue([{
      flightId: 'Delta-1025-JFK-LAX-2026-06-15',
      price: 350,
      airline: 'Delta',
      travelDate: new Date('2026-06-15'),
      currency: 'USD',
      bookingUrl: 'https://example.com',
      stops: 0,
      duration: '5h',
      departureTime: '10:25 AM',
      arrivalTime: '3:25 PM',
      status: 'available',
    }]);

    // Extraction returns a different flight — the previous one disappeared
    mockExtractPrices.mockResolvedValue({
      prices: [{
        travelDate: '2026-06-15',
        price: 400,
        currency: 'USD',
        airline: 'United',
        bookingUrl: '',
        stops: 1,
        duration: '7h',
        departureTime: '2:00 PM',
        arrivalTime: '5:30 PM',
        seatsLeft: null,
      }],
      usage: { inputTokens: 100, outputTokens: 20 },
    });

    const result = await runScrapeForQuery('q1');

    expect(result.status).toBe('success');
    // createMany is called twice: once for available flights, once for sold-out
    expect(mockPrisma.priceSnapshot.createMany).toHaveBeenCalledTimes(2);
    expect(mockPrisma.priceSnapshot.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          flightId: 'Delta-1025-JFK-LAX-2026-06-15',
          status: 'sold_out',
        }),
      ]),
    });
  });

  it('does not create duplicate sold_out snapshot for already sold-out flight', async () => {
    mockPrisma.priceSnapshot.findMany.mockResolvedValue([{
      flightId: 'Delta-1025-JFK-LAX-2026-06-15',
      price: 350,
      airline: 'Delta',
      travelDate: new Date('2026-06-15'),
      currency: 'USD',
      bookingUrl: 'https://example.com',
      stops: 0,
      duration: '5h',
      departureTime: '10:25 AM',
      arrivalTime: '3:25 PM',
      status: 'sold_out',
    }]);

    // Extraction returns a different flight — the sold-out one is still missing
    mockExtractPrices.mockResolvedValue({
      prices: [{
        travelDate: '2026-06-15',
        price: 400,
        currency: 'USD',
        airline: 'United',
        bookingUrl: '',
        stops: 1,
        duration: '7h',
        departureTime: '2:00 PM',
        arrivalTime: '5:30 PM',
        seatsLeft: null,
      }],
      usage: { inputTokens: 100, outputTokens: 20 },
    });

    const result = await runScrapeForQuery('q1');

    expect(result.status).toBe('success');
    // createMany called only once — for the available United flight, NOT for sold-out Delta
    expect(mockPrisma.priceSnapshot.createMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.priceSnapshot.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ airline: 'United' }),
      ]),
    });
  });

  it('accepts null bookingUrl without error (schema is String?)', async () => {
    mockExtractPrices.mockResolvedValue({
      prices: [{
        travelDate: '2026-06-15',
        price: 350,
        currency: 'USD',
        airline: 'Delta',
        bookingUrl: null,
        stops: 0,
        duration: '5h',
        departureTime: null,
        arrivalTime: null,
        seatsLeft: null,
      }],
      usage: { inputTokens: 100, outputTokens: 20 },
    });

    const result = await runScrapeForQuery('q1');

    expect(result.status).toBe('success');
    expect(mockPrisma.priceSnapshot.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ bookingUrl: null }),
      ]),
    });
  });
});

describe('PriceSnapshot schema', () => {
  it('bookingUrl must be optional (String?) to accept LLM null values', () => {
    const schema = readFileSync(
      resolve(__dirname, '../../../prisma/schema.prisma'),
      'utf-8'
    );
    const match = schema.match(/model PriceSnapshot\s*\{[\s\S]*?\}/);
    expect(match).not.toBeNull();
    const model = match![0];
    expect(model).toMatch(/bookingUrl\s+String\?/);
  });
});

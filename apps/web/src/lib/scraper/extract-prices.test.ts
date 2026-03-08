import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockExtract } = vi.hoisted(() => ({
  mockExtract: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    extractionConfig: {
      findFirst: vi.fn().mockResolvedValue({
        provider: 'anthropic',
        model: 'claude-haiku-4-5-20251001',
      }),
    },
  },
}));

vi.mock('@/lib/scraper/ai-registry', () => ({
  EXTRACTION_PROVIDERS: {
    anthropic: {
      displayName: 'Anthropic',
      envKey: 'ANTHROPIC_API_KEY',
      models: [],
      extract: mockExtract,
    },
  },
}));

process.env.ANTHROPIC_API_KEY = 'test-key';

import { extractPrices } from './extract-prices';

describe('extractPrices', () => {
  beforeEach(() => {
    mockExtract.mockReset();
  });

  it('returns page_not_loaded when resultsFound is false', async () => {
    const result = await extractPrices(
      '<html>loading...</html>',
      'https://flights.google.com',
      '2026-06-15',
      { maxPrice: null, maxStops: null, preferredAirlines: [], timePreference: 'any', cabinClass: 'economy' },
      10,
      false,
    );
    expect(result.prices).toEqual([]);
    expect(result.failureReason).toBe('page_not_loaded');
    expect(mockExtract).not.toHaveBeenCalled();
  });

  it('extracts valid prices from llm json array', async () => {
    mockExtract.mockResolvedValue({
      content: JSON.stringify([
        { travelDate: '2026-06-15', price: 623, currency: 'USD', airline: 'Delta', bookingUrl: 'https://delta.com', stops: 0, duration: '5h 30m', departureTime: '10:25 AM', seatsLeft: 3 },
        { travelDate: '2026-06-15', price: 450, currency: 'USD', airline: 'United', bookingUrl: 'https://united.com', stops: 1, duration: '8h 10m', departureTime: '2:00 PM', seatsLeft: null },
      ]),
      usage: { inputTokens: 500, outputTokens: 100 },
    });

    const result = await extractPrices(
      'Flights: Delta $623, United $450',
      'https://flights.google.com',
      '2026-06-15',
    );
    expect(result.prices).toHaveLength(2);
    expect(result.prices[0]!.airline).toBe('Delta');
    expect(result.failureReason).toBeUndefined();
  });

  it('filters out entries with zero price', async () => {
    mockExtract.mockResolvedValue({
      content: JSON.stringify([
        { travelDate: '2026-06-15', price: 0, currency: 'USD', airline: 'Delta', bookingUrl: '', stops: 0, duration: null, departureTime: null, seatsLeft: null },
        { travelDate: '2026-06-15', price: 300, currency: 'USD', airline: 'United', bookingUrl: '', stops: 0, duration: null, departureTime: null, seatsLeft: null },
      ]),
      usage: { inputTokens: 200, outputTokens: 50 },
    });

    const result = await extractPrices('page content', 'https://flights.google.com', '2026-06-15');
    expect(result.prices).toHaveLength(1);
    expect(result.prices[0]!.airline).toBe('United');
  });

  it('filters out entries with empty airline', async () => {
    mockExtract.mockResolvedValue({
      content: JSON.stringify([
        { travelDate: '2026-06-15', price: 300, currency: 'USD', airline: '', bookingUrl: '', stops: 0, duration: null, departureTime: null, seatsLeft: null },
      ]),
      usage: { inputTokens: 200, outputTokens: 50 },
    });

    const result = await extractPrices('page content', 'https://flights.google.com', '2026-06-15');
    expect(result.prices).toEqual([]);
    expect(result.failureReason).toBe('all_filtered_out');
  });

  it('returns all_filtered_out when all entries invalid', async () => {
    mockExtract.mockResolvedValue({
      content: JSON.stringify([
        { travelDate: '2026-06-15', price: 0, currency: 'USD', airline: 'X', bookingUrl: '', stops: 0, duration: null, departureTime: null, seatsLeft: null },
        { travelDate: '2026-06-15', price: -5, currency: 'USD', airline: 'Y', bookingUrl: '', stops: 0, duration: null, departureTime: null, seatsLeft: null },
      ]),
      usage: { inputTokens: 200, outputTokens: 50 },
    });

    const result = await extractPrices('page content', 'https://flights.google.com', '2026-06-15');
    expect(result.failureReason).toBe('all_filtered_out');
  });

  it('returns empty_extraction when llm returns empty array', async () => {
    mockExtract.mockResolvedValue({
      content: '[]',
      usage: { inputTokens: 200, outputTokens: 10 },
    });

    const result = await extractPrices('page content', 'https://flights.google.com', '2026-06-15');
    expect(result.prices).toEqual([]);
    expect(result.failureReason).toBe('empty_extraction');
  });

  it('returns no_json_in_response when llm returns no array', async () => {
    mockExtract.mockResolvedValue({
      content: 'I could not find any flights on this page.',
      usage: { inputTokens: 200, outputTokens: 20 },
    });

    const result = await extractPrices('page content', 'https://flights.google.com', '2026-06-15');
    expect(result.prices).toEqual([]);
    expect(result.failureReason).toBe('no_json_in_response');
  });

  it('throws when provider is unknown', async () => {
    const { prisma } = await import('@/lib/prisma');
    vi.mocked(prisma.extractionConfig.findFirst).mockResolvedValueOnce({
      provider: 'nonexistent',
      model: 'x',
    } as never);

    await expect(
      extractPrices('content', 'https://example.com', '2026-06-15')
    ).rejects.toThrow('Unknown extraction provider');
  });

  it('throws when api key is missing', async () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      await expect(
        extractPrices('content', 'https://example.com', '2026-06-15')
      ).rejects.toThrow('Missing API key');
    } finally {
      process.env.ANTHROPIC_API_KEY = origKey;
    }
  });
});

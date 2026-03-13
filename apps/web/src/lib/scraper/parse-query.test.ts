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

vi.mock('./ai-registry', () => ({
  EXTRACTION_PROVIDERS: {
    anthropic: {
      displayName: 'Anthropic',
      envKey: 'ANTHROPIC_API_KEY',
      models: [],
      extract: mockExtract,
    },
  },
}));

// Provide a fake API key so the provider check passes
process.env.ANTHROPIC_API_KEY = 'test-key';

import { parseFlightQuery } from './parse-query';

function makeLlmResponse(data: Record<string, unknown>): string {
  return JSON.stringify(data);
}

describe('parseFlightQuery', () => {
  beforeEach(() => {
    mockExtract.mockReset();
  });

  it('parses high-confidence query with envelope format', async () => {
    mockExtract.mockResolvedValue({
      content: makeLlmResponse({
        confidence: 'high',
        ambiguities: [],
        parsed: {
          origins: [{ code: 'JFK', name: 'New York JFK' }],
          destinations: [{ code: 'LAX', name: 'Los Angeles' }],
          dateFrom: '2026-06-15',
          dateTo: '2026-06-22',
          flexibility: 0,
          maxPrice: null,
          maxStops: null,
          preferredAirlines: [],
          timePreference: 'any',
          cabinClass: 'economy',
          tripType: 'round_trip',
          currency: 'USD',
        },
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const { response } = await parseFlightQuery('JFK to LAX June 15-22');
    expect(response.confidence).toBe('high');
    expect(response.parsed?.origin).toBe('JFK');
    expect(response.parsed?.destination).toBe('LAX');
    expect(response.parsed?.origins).toHaveLength(1);
  });

  it('normalizes legacy flat format to arrays', async () => {
    mockExtract.mockResolvedValue({
      content: makeLlmResponse({
        origin: 'ORD',
        originName: 'Chicago',
        destination: 'MIA',
        destinationName: 'Miami',
        dateFrom: '2026-07-01',
        dateTo: '2026-07-10',
        flexibility: 0,
        maxPrice: null,
        maxStops: null,
        preferredAirlines: [],
        timePreference: 'any',
        cabinClass: 'economy',
        tripType: 'round_trip',
        currency: 'USD',
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const { response } = await parseFlightQuery('Chicago to Miami July');
    expect(response.parsed?.origins).toEqual([{ code: 'ORD', name: 'Chicago' }]);
    expect(response.parsed?.destinations).toEqual([{ code: 'MIA', name: 'Miami' }]);
    expect(response.confidence).toBe('high');
  });

  it('derives dateFrom and dateTo from outboundDates and returnDates', async () => {
    mockExtract.mockResolvedValue({
      content: makeLlmResponse({
        confidence: 'high',
        ambiguities: [],
        parsed: {
          origins: [{ code: 'SFO', name: 'San Francisco' }],
          destinations: [{ code: 'SEA', name: 'Seattle' }],
          dateFrom: '2026-06-10',
          dateTo: '2026-06-20',
          outboundDates: ['2026-06-15', '2026-06-16'],
          returnDates: ['2026-06-22', '2026-06-23'],
          flexibility: 0,
          maxPrice: null,
          maxStops: null,
          preferredAirlines: [],
          timePreference: 'any',
          cabinClass: 'economy',
          tripType: 'round_trip',
          currency: 'USD',
        },
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const { response } = await parseFlightQuery('SFO to SEA June 15 or 16, return 22 or 23');
    expect(response.parsed?.dateFrom).toBe('2026-06-15');
    expect(response.parsed?.dateTo).toBe('2026-06-23');
  });

  it('caps outboundDates at six entries', async () => {
    mockExtract.mockResolvedValue({
      content: makeLlmResponse({
        confidence: 'high',
        ambiguities: [],
        parsed: {
          origins: [{ code: 'JFK', name: 'JFK' }],
          destinations: [{ code: 'LHR', name: 'London' }],
          dateFrom: '2026-06-01',
          dateTo: '2026-06-30',
          outboundDates: ['2026-06-01', '2026-06-05', '2026-06-10', '2026-06-15', '2026-06-20', '2026-06-25', '2026-06-28', '2026-06-30'],
          flexibility: 0,
          maxPrice: null,
          maxStops: null,
          preferredAirlines: [],
          timePreference: 'any',
          cabinClass: 'economy',
          tripType: 'one_way',
          currency: 'USD',
        },
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const { response } = await parseFlightQuery('JFK to London any June date');
    expect(response.parsed?.outboundDates).toHaveLength(6);
  });

  it('filters invalid date strings from outboundDates', async () => {
    mockExtract.mockResolvedValue({
      content: makeLlmResponse({
        confidence: 'high',
        ambiguities: [],
        parsed: {
          origins: [{ code: 'JFK', name: 'JFK' }],
          destinations: [{ code: 'CDG', name: 'Paris' }],
          dateFrom: '2026-06-15',
          dateTo: '2026-06-20',
          outboundDates: ['2026-06-15', 'garbage', '2026-06-20', 'not-a-date'],
          flexibility: 0,
          maxPrice: null,
          maxStops: null,
          preferredAirlines: [],
          timePreference: 'any',
          cabinClass: 'economy',
          tripType: 'one_way',
          currency: 'USD',
        },
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const { response } = await parseFlightQuery('JFK to Paris');
    expect(response.parsed?.outboundDates).toEqual(['2026-06-15', '2026-06-20']);
  });

  it('returns null parsed when missing origins', async () => {
    mockExtract.mockResolvedValue({
      content: makeLlmResponse({
        confidence: 'high',
        ambiguities: [],
        parsed: {
          origins: [],
          destinations: [{ code: 'LAX', name: 'LA' }],
          dateFrom: '2026-06-15',
          dateTo: '2026-06-22',
          flexibility: 0,
          maxPrice: null,
          maxStops: null,
          preferredAirlines: [],
          timePreference: 'any',
          cabinClass: 'economy',
          tripType: 'one_way',
          currency: 'USD',
        },
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const { response } = await parseFlightQuery('somewhere to LA');
    expect(response.parsed).toBeNull();
    expect(response.confidence).toBe('low');
    expect(response.ambiguities.length).toBeGreaterThan(0);
  });

  it('downgrades high confidence to medium for 14+ day span', async () => {
    mockExtract.mockResolvedValue({
      content: makeLlmResponse({
        confidence: 'high',
        ambiguities: [],
        parsed: {
          origins: [{ code: 'JFK', name: 'JFK' }],
          destinations: [{ code: 'LAX', name: 'LAX' }],
          dateFrom: '2026-06-01',
          dateTo: '2026-06-30',
          flexibility: 0,
          maxPrice: null,
          maxStops: null,
          preferredAirlines: [],
          timePreference: 'any',
          cabinClass: 'economy',
          tripType: 'round_trip',
          currency: 'USD',
        },
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const { response } = await parseFlightQuery('JFK to LAX in June');
    expect(response.confidence).toBe('medium');
    expect(response.dateSpanDays).toBe(29);
    expect(response.ambiguities.some((a) => a.field === 'date')).toBe(true);
  });

  it('computes dateSpanDays correctly', async () => {
    mockExtract.mockResolvedValue({
      content: makeLlmResponse({
        confidence: 'high',
        ambiguities: [],
        parsed: {
          origins: [{ code: 'JFK', name: 'JFK' }],
          destinations: [{ code: 'LAX', name: 'LAX' }],
          dateFrom: '2026-06-15',
          dateTo: '2026-06-22',
          flexibility: 0,
          maxPrice: null,
          maxStops: null,
          preferredAirlines: [],
          timePreference: 'any',
          cabinClass: 'economy',
          tripType: 'round_trip',
          currency: 'USD',
        },
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const { response } = await parseFlightQuery('JFK to LAX June 15-22');
    expect(response.dateSpanDays).toBe(7);
  });

  it('defaults currency to USD when omitted', async () => {
    mockExtract.mockResolvedValue({
      content: makeLlmResponse({
        confidence: 'high',
        ambiguities: [],
        parsed: {
          origins: [{ code: 'JFK', name: 'JFK' }],
          destinations: [{ code: 'LAX', name: 'LAX' }],
          dateFrom: '2026-06-15',
          dateTo: '2026-06-22',
          flexibility: 0,
          maxPrice: null,
          maxStops: null,
          preferredAirlines: [],
          timePreference: 'any',
          cabinClass: 'economy',
          tripType: 'round_trip',
        },
      }),
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const { response } = await parseFlightQuery('JFK to LAX');
    expect(response.parsed?.currency).toBe('USD');
  });

  it('throws when llm returns no JSON', async () => {
    mockExtract.mockResolvedValue({
      content: 'Sorry, I cannot parse that query.',
      usage: { inputTokens: 50, outputTokens: 20 },
    });

    await expect(parseFlightQuery('asdfghjkl')).rejects.toThrow('Failed to parse LLM response as JSON');
  });

  it('throws when provider is unknown', async () => {
    const { prisma } = await import('@/lib/prisma');
    vi.mocked(prisma.extractionConfig.findFirst).mockResolvedValueOnce({
      provider: 'nonexistent',
      model: 'x',
    } as never);

    await expect(parseFlightQuery('JFK to LAX')).rejects.toThrow('Unknown extraction provider');
  });

  it('throws when api key is missing', async () => {
    const origKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      await expect(parseFlightQuery('JFK to LAX')).rejects.toThrow('Missing API key');
    } finally {
      process.env.ANTHROPIC_API_KEY = origKey;
    }
  });
});

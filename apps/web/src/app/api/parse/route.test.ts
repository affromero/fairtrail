import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockParseFlightQuery = vi.fn();

vi.mock('@/lib/scraper/parse-query', () => ({
  parseFlightQuery: (...args: unknown[]) => mockParseFlightQuery(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    extractionConfig: { findFirst: vi.fn().mockResolvedValue(null) },
    apiUsageLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }),
}));

import { POST } from './route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/parse', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/parse', () => {
  beforeEach(() => {
    mockParseFlightQuery.mockReset();
  });

  it('rejects missing query field with 400', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('rejects query shorter than 5 chars with 400', async () => {
    const res = await POST(makeRequest({ query: 'ab' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('between 5 and 500');
  });

  it('rejects query longer than 500 chars with 400', async () => {
    const res = await POST(makeRequest({ query: 'a'.repeat(501) }));
    expect(res.status).toBe(400);
  });

  it('returns parsed flight data on success', async () => {
    const parseResponse = {
      parsed: { origin: 'JFK', destination: 'LAX' },
      confidence: 'high',
      ambiguities: [],
      dateSpanDays: 7,
    };
    mockParseFlightQuery.mockResolvedValue({
      response: parseResponse,
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    const res = await POST(makeRequest({ query: 'JFK to LAX June 15-22' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.confidence).toBe('high');
  });

  it('returns 422 when parse throws', async () => {
    mockParseFlightQuery.mockRejectedValue(new Error('LLM exploded'));
    const res = await POST(makeRequest({ query: 'JFK to LAX June 15' }));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toContain('LLM exploded');
  });

  it('logs api usage after successful parse', async () => {
    mockParseFlightQuery.mockResolvedValue({
      response: { parsed: null, confidence: 'low', ambiguities: [], dateSpanDays: 0 },
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    await POST(makeRequest({ query: 'JFK to LAX June 15' }));

    const { prisma } = await import('@/lib/prisma');
    expect(prisma.apiUsageLog.create).toHaveBeenCalled();
  });
});

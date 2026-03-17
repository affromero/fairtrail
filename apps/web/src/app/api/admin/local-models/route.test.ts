import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFindFirst = vi.fn();
const mockCached = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    extractionConfig: { findFirst: (...args: unknown[]) => mockFindFirst(...args) },
  },
}));

vi.mock('@/lib/redis', () => ({
  redis: null,
  cached: (...args: unknown[]) => mockCached(...args),
}));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { GET } from './route';
import { NextRequest } from 'next/server';

function makeRequest(provider?: string): NextRequest {
  const url = new URL('http://localhost:3003/api/admin/local-models');
  if (provider) url.searchParams.set('provider', provider);
  return new NextRequest(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCached.mockImplementation(async (_key: string, fn: () => Promise<unknown>) => fn());
  mockFindFirst.mockResolvedValue({ provider: 'ollama', customBaseUrl: null });
});

describe('GET /api/admin/local-models', () => {
  it('rejects missing provider param', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it('rejects non-local provider', async () => {
    const res = await GET(makeRequest('anthropic'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
  });

  it('returns Ollama models on success', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        models: [
          { name: 'llama3.1:8b', size: 4_800_000_000, details: { parameter_size: '8B' } },
          { name: 'mistral:7b', size: 4_100_000_000, details: { parameter_size: '7B' } },
        ],
      }),
    });

    const res = await GET(makeRequest('ollama'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].id).toBe('llama3.1:8b');
    expect(body.data[0].size).toBe('8B');
    expect(body.data[1].id).toBe('mistral:7b');
  });

  it('returns 502 when Ollama is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'));

    const res = await GET(makeRequest('ollama'));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Could not connect to ollama');
  });

  it('strips /v1 from customBaseUrl when querying Ollama', async () => {
    mockFindFirst.mockResolvedValue({
      provider: 'ollama',
      customBaseUrl: 'http://myhost:11434/v1',
    });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ models: [] }),
    });

    await GET(makeRequest('ollama'));
    expect(mockFetch).toHaveBeenCalledWith(
      'http://myhost:11434/api/tags',
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it('returns llamacpp models via /v1/models endpoint', async () => {
    mockFindFirst.mockResolvedValue({ provider: 'llamacpp', customBaseUrl: null });
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        data: [{ id: 'my-model' }],
      }),
    });

    const res = await GET(makeRequest('llamacpp'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('my-model');
  });

  it('uses cached results when available', async () => {
    const cachedModels = [{ id: 'cached-model', name: 'cached-model', size: '8B' }];
    mockCached.mockResolvedValue(cachedModels);

    const res = await GET(makeRequest('ollama'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual(cachedModels);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

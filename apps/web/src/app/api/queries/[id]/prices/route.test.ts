import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockQueryFindUnique = vi.fn();
const mockSnapshotFindMany = vi.fn();
const mockFetchRunFindFirst = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    query: { findUnique: (...args: unknown[]) => mockQueryFindUnique(...args) },
    priceSnapshot: { findMany: (...args: unknown[]) => mockSnapshotFindMany(...args) },
    fetchRun: { findFirst: (...args: unknown[]) => mockFetchRunFindFirst(...args) },
  },
}));

vi.mock('@/lib/redis', () => ({
  cached: (_key: string, fn: () => Promise<unknown>) => fn(),
}));

import { GET } from './route';

const request = new NextRequest('http://localhost/api/queries/test-id/prices');

function callGet(id = 'test-id') {
  return GET(request, { params: Promise.resolve({ id }) });
}

describe('GET /api/queries/[id]/prices', () => {
  it('returns 404 for nonexistent query', async () => {
    mockQueryFindUnique.mockResolvedValue(null);
    const res = await callGet();
    expect(res.status).toBe(404);
  });

  it('returns 410 for expired query', async () => {
    mockQueryFindUnique.mockResolvedValue({
      id: 'test-id',
      expiresAt: new Date('2020-01-01'),
    });
    const res = await callGet();
    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toContain('expired');
  });

  it('returns price snapshots for valid query', async () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    mockQueryFindUnique.mockResolvedValue({
      id: 'test-id',
      origin: 'JFK',
      destination: 'LAX',
      expiresAt: futureDate,
    });
    mockSnapshotFindMany.mockResolvedValue([
      { id: 's1', price: 300, airline: 'Delta' },
    ]);
    mockFetchRunFindFirst.mockResolvedValue({
      startedAt: new Date('2026-06-01'),
      status: 'success',
    });

    const res = await callGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.snapshots).toHaveLength(1);
    expect(body.data.snapshotCount).toBe(1);
  });

  it('includes lastChecked from most recent fetch run', async () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    mockQueryFindUnique.mockResolvedValue({ id: 'test-id', expiresAt: futureDate });
    mockSnapshotFindMany.mockResolvedValue([]);
    mockFetchRunFindFirst.mockResolvedValue({
      startedAt: new Date('2026-06-01T10:00:00Z'),
      status: 'success',
    });

    const res = await callGet();
    const body = await res.json();
    expect(body.data.lastChecked).toBeTruthy();
    expect(body.data.lastStatus).toBe('success');
  });

  it('returns null lastChecked when no fetch runs', async () => {
    const futureDate = new Date();
    futureDate.setFullYear(futureDate.getFullYear() + 1);
    mockQueryFindUnique.mockResolvedValue({ id: 'test-id', expiresAt: futureDate });
    mockSnapshotFindMany.mockResolvedValue([]);
    mockFetchRunFindFirst.mockResolvedValue(null);

    const res = await callGet();
    const body = await res.json();
    expect(body.data.lastChecked).toBeNull();
    expect(body.data.lastStatus).toBeNull();
  });
});

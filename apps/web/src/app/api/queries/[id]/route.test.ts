import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockQueryFindUnique = vi.fn();
const mockQueryDelete = vi.fn();
const mockQueryFindMany = vi.fn();
const mockQueryUpdateMany = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    query: {
      findUnique: (...args: unknown[]) => mockQueryFindUnique(...args),
      delete: (...args: unknown[]) => mockQueryDelete(...args),
      findMany: (...args: unknown[]) => mockQueryFindMany(...args),
      updateMany: (...args: unknown[]) => mockQueryUpdateMany(...args),
    },
  },
}));

import { DELETE, PATCH } from './route';

function makeDeleteRequest(id: string, body?: Record<string, unknown>): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new NextRequest(`http://localhost/api/queries/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : '{}',
    }),
    { params: Promise.resolve({ id }) },
  ];
}

describe('DELETE /api/queries/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryDelete.mockResolvedValue({});
    delete process.env.SELF_HOSTED;
  });

  afterEach(() => {
    delete process.env.SELF_HOSTED;
  });

  it('returns 404 when query does not exist', async () => {
    mockQueryFindUnique.mockResolvedValue(null);
    const res = await DELETE(...makeDeleteRequest('missing', { deleteToken: 'tok' }));
    const data = await res.json();
    expect(res.status).toBe(404);
    expect(data.error).toContain('not found');
  });

  it('returns 401 when token is missing (hosted)', async () => {
    mockQueryFindUnique.mockResolvedValue({ deleteToken: 'real-token' });
    const res = await DELETE(...makeDeleteRequest('q1', {}));
    const data = await res.json();
    expect(res.status).toBe(401);
    expect(data.error).toContain('token');
  });

  it('returns 403 when token is wrong (hosted)', async () => {
    mockQueryFindUnique.mockResolvedValue({ deleteToken: 'real-token' });
    const res = await DELETE(...makeDeleteRequest('q1', { deleteToken: 'wrong' }));
    const data = await res.json();
    expect(res.status).toBe(403);
    expect(data.error).toContain('Invalid');
  });

  it('deletes with valid token (hosted)', async () => {
    mockQueryFindUnique.mockResolvedValue({ deleteToken: 'real-token' });
    const res = await DELETE(...makeDeleteRequest('q1', { deleteToken: 'real-token' }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.data.deleted).toBe(true);
    expect(mockQueryDelete).toHaveBeenCalledWith({ where: { id: 'q1' } });
  });

  it('deletes without token when SELF_HOSTED=true', async () => {
    process.env.SELF_HOSTED = 'true';
    mockQueryFindUnique.mockResolvedValue({ deleteToken: 'real-token' });
    const res = await DELETE(...makeDeleteRequest('q1', {}));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.data.deleted).toBe(true);
    expect(mockQueryDelete).toHaveBeenCalledWith({ where: { id: 'q1' } });
  });

  it('deletes with null token when SELF_HOSTED=true', async () => {
    process.env.SELF_HOSTED = 'true';
    mockQueryFindUnique.mockResolvedValue({ deleteToken: null });
    const res = await DELETE(...makeDeleteRequest('q1'));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.data.deleted).toBe(true);
  });

  it('deletes with valid token when SELF_HOSTED=true', async () => {
    process.env.SELF_HOSTED = 'true';
    mockQueryFindUnique.mockResolvedValue({ deleteToken: 'real-token' });
    const res = await DELETE(...makeDeleteRequest('q1', { deleteToken: 'real-token' }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.data.deleted).toBe(true);
    expect(mockQueryDelete).toHaveBeenCalledWith({ where: { id: 'q1' } });
  });

  it('still requires token when SELF_HOSTED is not set', async () => {
    mockQueryFindUnique.mockResolvedValue({ deleteToken: 'real-token' });
    const res = await DELETE(...makeDeleteRequest('q1', {}));
    expect(res.status).toBe(401);
  });
});

function makePatchRequest(id: string, body: Record<string, unknown>): [NextRequest, { params: Promise<{ id: string }> }] {
  return [
    new NextRequest(`http://localhost/api/queries/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  ];
}

describe('PATCH /api/queries/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueryFindMany.mockResolvedValue([]);
    mockQueryUpdateMany.mockResolvedValue({ count: 1 });
    delete process.env.SELF_HOSTED;
  });

  afterEach(() => {
    delete process.env.SELF_HOSTED;
  });

  it('returns 401 when token is missing (hosted)', async () => {
    mockQueryFindUnique.mockResolvedValue({ deleteToken: 'real-token', groupId: null });
    const res = await PATCH(...makePatchRequest('q1', { scrapeInterval: 6 }));
    expect(res.status).toBe(401);
  });

  it('updates interval with valid token (hosted)', async () => {
    mockQueryFindUnique.mockResolvedValue({ deleteToken: 'real-token', groupId: null });
    const res = await PATCH(...makePatchRequest('q1', { deleteToken: 'real-token', scrapeInterval: 6 }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.data.scrapeInterval).toBe(6);
  });

  it('updates interval without token when SELF_HOSTED=true', async () => {
    process.env.SELF_HOSTED = 'true';
    mockQueryFindUnique.mockResolvedValue({ deleteToken: 'real-token', groupId: null });
    const res = await PATCH(...makePatchRequest('q1', { scrapeInterval: 3 }));
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.data.scrapeInterval).toBe(3);
  });

  it('rejects invalid interval even when SELF_HOSTED=true', async () => {
    process.env.SELF_HOSTED = 'true';
    mockQueryFindUnique.mockResolvedValue({ deleteToken: null, groupId: null });
    const res = await PATCH(...makePatchRequest('q1', { scrapeInterval: 99 }));
    expect(res.status).toBe(400);
  });
});

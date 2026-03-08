import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockVerifyPassword = vi.fn();
const mockCreateSessionToken = vi.fn();
const mockSetSessionCookie = vi.fn();

vi.mock('@/lib/admin-auth', () => ({
  verifyPassword: (...args: unknown[]) => mockVerifyPassword(...args),
  createSessionToken: () => mockCreateSessionToken(),
  setSessionCookie: (...args: unknown[]) => mockSetSessionCookie(...args),
}));

import { POST } from './route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/admin/auth', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/admin/auth', () => {
  beforeEach(() => {
    mockVerifyPassword.mockReset();
    mockCreateSessionToken.mockReset();
    mockSetSessionCookie.mockReset();
  });

  it('rejects missing password with 400', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Missing password');
  });

  it('rejects invalid password with 401', async () => {
    mockVerifyPassword.mockResolvedValue(false);
    const res = await POST(makeRequest({ password: 'wrong' }));
    expect(res.status).toBe(401);
  });

  it('returns success and sets cookie on valid password', async () => {
    mockVerifyPassword.mockResolvedValue(true);
    mockCreateSessionToken.mockReturnValue('session-token-123');
    mockSetSessionCookie.mockResolvedValue(undefined);

    const res = await POST(makeRequest({ password: 'correct' }));
    expect(res.status).toBe(200);
    expect(mockSetSessionCookie).toHaveBeenCalledWith('session-token-123');
  });
});

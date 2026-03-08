import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockCookieJar } = vi.hoisted(() => ({
  mockCookieJar: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue(mockCookieJar),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    extractionConfig: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
  },
}));

import {
  createInviteToken,
  verifyInviteToken,
  hasValidInvite,
} from './invite-auth';
import { createSessionToken } from './admin-auth';

describe('createInviteToken', () => {
  it('returns payload.signature format', () => {
    const token = createInviteToken('ABC123');
    expect(token).toMatch(/^invite:.+:\d+\.[0-9a-f]{64}$/);
  });

  it('embeds invite code in payload', () => {
    const token = createInviteToken('MYCODE');
    expect(token.startsWith('invite:MYCODE:')).toBe(true);
  });
});

describe('verifyInviteToken', () => {
  it('accepts valid token', () => {
    const token = createInviteToken('test-code');
    expect(verifyInviteToken(token)).toBe(true);
  });

  it('rejects tampered token', () => {
    const token = createInviteToken('test-code');
    const flipped = token.slice(0, -1) + (token.at(-1) === 'a' ? 'b' : 'a');
    expect(verifyInviteToken(flipped)).toBe(false);
  });

  it('rejects token without dot', () => {
    expect(verifyInviteToken('nodot')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(verifyInviteToken('')).toBe(false);
  });
});

describe('hasValidInvite', () => {
  const origSelfHosted = process.env.SELF_HOSTED;

  beforeEach(() => {
    mockCookieJar.get.mockReset();
    delete process.env.SELF_HOSTED;
  });

  afterEach(() => {
    if (origSelfHosted !== undefined) {
      process.env.SELF_HOSTED = origSelfHosted;
    } else {
      delete process.env.SELF_HOSTED;
    }
  });

  it('returns true when self-hosted', async () => {
    process.env.SELF_HOSTED = 'true';
    expect(await hasValidInvite()).toBe(true);
  });

  it('returns true when valid admin session cookie exists', async () => {
    const sessionToken = createSessionToken();
    mockCookieJar.get.mockImplementation((name: string) => {
      if (name === 'ft-session') return { value: sessionToken };
      return undefined;
    });
    expect(await hasValidInvite()).toBe(true);
  });

  it('returns true when valid invite cookie exists', async () => {
    const inviteToken = createInviteToken('valid-code');
    mockCookieJar.get.mockImplementation((name: string) => {
      if (name === 'ft-session') return undefined;
      if (name === 'ft-invite') return { value: inviteToken };
      return undefined;
    });
    expect(await hasValidInvite()).toBe(true);
  });

  it('returns false when no cookies exist', async () => {
    mockCookieJar.get.mockReturnValue(undefined);
    expect(await hasValidInvite()).toBe(false);
  });
});

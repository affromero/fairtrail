import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUserSessionToken } from '../user-auth';

const boundary = vi.hoisted(() => ({ multiUser: true, token: '', user: null as { id: string; isAdmin: boolean; sessionsValidFrom: Date | null } | null }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => boundary.token ? { value: boundary.token } : undefined }) }));
vi.mock('@/lib/prisma', () => ({ prisma: { extractionConfig: { findUnique: async () => ({ multiUserMode: boundary.multiUser }) }, user: { findUnique: async ({ where }: { where: { id: string } }) => boundary.user?.id === where.id ? boundary.user : null } } }));

describe('car access through actual session verification', () => {
  beforeEach(() => {
    vi.stubEnv('SELF_HOSTED', 'true');
    vi.stubEnv('REDIS_URL', '');
    boundary.multiUser = true; boundary.token = ''; boundary.user = null;
  });
  afterEach(() => vi.unstubAllEnvs());

  it('keeps car operations unavailable on the public instance even with a valid administrator session', async () => {
    vi.stubEnv('SELF_HOSTED', 'false');
    boundary.user = { id: 'admin', isAdmin: true, sessionsValidFrom: null };
    boundary.token = createUserSessionToken('admin');
    const { carActor } = await import('./access');
    await expect(carActor()).rejects.toMatchObject({ status: 404 });
  });
  it('preserves the existing single-user self-hosted access model', async () => {
    boundary.multiUser = false;
    const { carActor } = await import('./access');
    expect(await carActor()).toEqual({ userId: null, isAdmin: true });
  });
  it('requires a valid current user in multi-user mode', async () => {
    const { carActor } = await import('./access');
    await expect(carActor()).rejects.toMatchObject({ status: 401 });
    boundary.user = { id: 'user', isAdmin: false, sessionsValidFrom: null };
    boundary.token = createUserSessionToken('user');
    expect(await carActor()).toEqual({ userId: 'user', isAdmin: false });
    boundary.token = boundary.token.slice(0, -1) + (boundary.token.endsWith('a') ? 'b' : 'a');
    await expect(carActor()).rejects.toMatchObject({ status: 401 });
  });
  it('rejects deleted users and revoked sessions instead of trusting a previously signed token', async () => {
    const { carActor } = await import('./access');
    boundary.token = createUserSessionToken('deleted');
    await expect(carActor()).rejects.toMatchObject({ status: 401 });
    boundary.user = { id: 'deleted', isAdmin: true, sessionsValidFrom: new Date(Date.now() + 1000) };
    await expect(carActor()).rejects.toMatchObject({ status: 401 });
  });
});

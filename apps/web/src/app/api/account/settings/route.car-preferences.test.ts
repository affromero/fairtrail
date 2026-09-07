import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createUserSessionToken } from '@/lib/user-auth';
import { GET, PATCH } from './route';

const boundary = vi.hoisted(() => ({ multiUser: true, token: '', row: {} as Record<string, unknown> }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => boundary.token ? { value: boundary.token } : undefined }) }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  extractionConfig: { findUnique: async () => ({ multiUserMode: boundary.multiUser }) },
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => where.id === boundary.row.id ? boundary.row : null,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      if (where.id !== boundary.row.id) throw new Error('Wrong update owner');
      boundary.row = { ...boundary.row, ...data }; return boundary.row;
    },
  },
} }));
const patch = (body: unknown) => PATCH(new NextRequest('http://localhost/api/account/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));

describe('authenticated car preferences without changing flight settings', () => {
  beforeEach(() => {
    vi.stubEnv('SELF_HOSTED', 'true'); vi.stubEnv('REDIS_URL', ''); boundary.multiUser = true;
    boundary.row = { id: 'owner', username: 'owner', sessionsValidFrom: null, preferredCarProviders: [], preferredAggregators: ['google_flights'], preferredAirlines: ['Example Air'], cabinClass: 'business' };
    boundary.token = createUserSessionToken('owner');
  });
  afterEach(() => vi.unstubAllEnvs());
  it('round-trips inheritance and reversed provider order without materializing defaults', async () => {
    expect((await (await GET()).json()).data.preferredCarProviders).toEqual([]);
    expect((await (await patch({ preferredCarProviders: ['autoeurope', 'discovercars'] })).json()).data.preferredCarProviders).toEqual(['autoeurope', 'discovercars']);
    expect((await (await GET()).json()).data.preferredCarProviders).toEqual(['autoeurope', 'discovercars']);
    expect((await (await patch({ preferredCarProviders: [] })).json()).data.preferredCarProviders).toEqual([]);
    expect(boundary.row).toMatchObject({ preferredAggregators: ['google_flights'], preferredAirlines: ['Example Air'], cabinClass: 'business' });
  });
  it('preserves saved car providers when a flight-only update omits them', async () => {
    boundary.row.preferredCarProviders = ['autoeurope'];
    expect((await patch({ cabinClass: 'first' })).status).toBe(200);
    expect(boundary.row).toMatchObject({ preferredCarProviders: ['autoeurope'], cabinClass: 'first' });
  });
  it.each([null, 'autoeurope', ['unknown'], ['autoeurope', 'autoeurope'], ['autoeurope', 'discovercars', 'autoeurope'], [42]])('rejects malformed providers atomically: %j', async preferredCarProviders => {
    const previous = structuredClone(boundary.row);
    expect((await patch({ preferredCarProviders, cabinClass: 'first' })).status).toBe(400);
    expect(boundary.row).toEqual(previous);
  });
  it.each(['missing', 'foreign', 'revoked', 'public', 'single-user'])('rejects a %s session or unsupported access mode', async mode => {
    if (mode === 'missing') boundary.token = '';
    if (mode === 'foreign') boundary.token = createUserSessionToken('other');
    if (mode === 'revoked') boundary.row.sessionsValidFrom = new Date(Date.now() + 1000);
    if (mode === 'public') vi.stubEnv('SELF_HOSTED', 'false');
    if (mode === 'single-user') boundary.multiUser = false;
    const previous = structuredClone(boundary.row);
    expect((await patch({ preferredCarProviders: ['autoeurope'] })).status).toBe(['public', 'single-user'].includes(mode) ? 404 : 401);
    expect(boundary.row).toEqual(previous);
  });
});

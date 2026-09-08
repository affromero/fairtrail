import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_HOTEL_MAP_CONFIG } from '@/lib/hotels/map-config';

const db = vi.hoisted(() => ({ findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn(), config: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/prisma', () => ({ prisma: { extractionConfig: { findUnique: db.config }, hotelMapConfig: db, $transaction: async (action: (tx: { hotelMapConfig: typeof db }) => unknown) => action({ hotelMapConfig: db }) } }));
import { GET, PATCH } from './route';

beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('SELF_HOSTED', 'true'); db.config.mockResolvedValue({ multiUserMode: false }); db.findUnique.mockResolvedValue(null); });
afterEach(() => vi.unstubAllEnvs());
const request = (body: unknown) => new Request('http://localhost/api/admin/hotel-map', { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'X-Hotel-Map-Actor': 'solo' }, body: JSON.stringify(body) });

it('returns isolated defaults with no-store caching and no configuration writes', async () => {
  const result = await GET();
  expect(result.status).toBe(200);
  expect(result.headers.get('Cache-Control')).toContain('no-store');
  expect(await result.json()).toMatchObject({ data: { revision: 0, config: DEFAULT_HOTEL_MAP_CONFIG } });
  expect(db.create).not.toHaveBeenCalled();
});

it('requires a signed-in account in multi-user mode before reading map settings', async () => {
  db.config.mockResolvedValue({ multiUserMode: true });
  const result = await GET();
  expect(result.status).toBe(401);
  expect(db.findUnique).not.toHaveBeenCalled();
});

it('rejects a settings form from another account before writing', async () => {
  const submission = request({ config: DEFAULT_HOTEL_MAP_CONFIG, revision: 0 });
  submission.headers.set('X-Hotel-Map-Actor', 'user:previous-account');
  expect((await PATCH(submission)).status).toBe(409);
  expect(db.create).not.toHaveBeenCalled();
});

it.each([[], null, { revision: 0 }, { config: DEFAULT_HOTEL_MAP_CONFIG, revision: -1 }, { config: DEFAULT_HOTEL_MAP_CONFIG, revision: 0, provider: 'unexpected' }])('rejects malformed map settings requests %j', async body => {
  expect((await PATCH(request(body))).status).toBe(400);
  expect(db.create).not.toHaveBeenCalled();
});

it('rejects oversized request bodies before a settings write', async () => {
  const result = await PATCH(request({ padding: 'x'.repeat(65537) }));
  expect(result.status).toBe(413);
  expect(db.create).not.toHaveBeenCalled();
});

it('returns conflict when another administrator has saved the revision', async () => {
  db.findUnique.mockResolvedValue({ revision: 2, settings: DEFAULT_HOTEL_MAP_CONFIG });
  db.updateMany.mockResolvedValue({ count: 0 });
  const result = await PATCH(request({ config: DEFAULT_HOTEL_MAP_CONFIG, revision: 1 }));
  expect(result.status).toBe(409);
  expect(await result.json()).toMatchObject({ ok: false });
});

it('does not expose underlying database failures or claim a successful save', async () => {
  db.findUnique.mockRejectedValue(new Error('private connection information'));
  const result = await GET();
  expect(result.status).toBe(500);
  expect(await result.text()).not.toContain('private connection information');
});

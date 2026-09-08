import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_HOTEL_MAP_CONFIG } from './map-config';
import { getHotelMapConfig, saveHotelMapConfig } from './map-config-store';

const db = vi.hoisted(() => ({ findUnique: vi.fn(), create: vi.fn(), updateMany: vi.fn() }));
vi.mock('../prisma', () => ({ prisma: { hotelMapConfig: db, $transaction: async (action: (tx: { hotelMapConfig: typeof db }) => unknown) => action({ hotelMapConfig: db }) } }));
beforeEach(() => { vi.resetAllMocks(); });

it('returns map defaults without creating or changing instance configuration', async () => {
  db.findUnique.mockResolvedValue(null);
  expect(await getHotelMapConfig()).toEqual({ revision: 0, config: DEFAULT_HOTEL_MAP_CONFIG });
  expect(db.create).not.toHaveBeenCalled();
  expect(db.updateMany).not.toHaveBeenCalled();
});

it('creates only isolated map settings with the first revision', async () => {
  db.findUnique.mockResolvedValue(null);
  expect(await saveHotelMapConfig({ ...DEFAULT_HOTEL_MAP_CONFIG, enabled: false }, 0)).toMatchObject({ revision: 1, config: { enabled: false } });
  expect(db.create).toHaveBeenCalledWith({ data: { id: 'singleton', revision: 1, settings: { ...DEFAULT_HOTEL_MAP_CONFIG, enabled: false } } });
});

it('rejects stale revisions without reporting a successful save', async () => {
  db.findUnique.mockResolvedValue({ revision: 2, settings: DEFAULT_HOTEL_MAP_CONFIG });
  db.updateMany.mockResolvedValue({ count: 0 });
  await expect(saveHotelMapConfig(DEFAULT_HOTEL_MAP_CONFIG, 1)).rejects.toMatchObject({ status: 409 });
});

it('surfaces corrupt stored configuration instead of silently selecting another provider', async () => {
  db.findUnique.mockResolvedValue({ revision: 3, settings: { provider: 'unknown' } });
  await expect(getHotelMapConfig()).rejects.toThrow();
});

import { prisma } from '../prisma';
import { HotelError } from './domain';
import { DEFAULT_HOTEL_MAP_CONFIG, validateHotelMapConfig } from './map-config';

export async function getHotelMapConfig() {
  const row = await prisma.hotelMapConfig.findUnique({ where: { id: 'singleton' } });
  return { revision: row?.revision ?? 0, config: row ? validateHotelMapConfig(row.settings) : { ...DEFAULT_HOTEL_MAP_CONFIG } };
}

export async function saveHotelMapConfig(value: unknown, revision: number) {
  if (!Number.isInteger(revision) || revision < 0 || revision >= 2147483647) throw new HotelError('Invalid map settings revision');
  const config = validateHotelMapConfig(value);
  try {
    return await prisma.$transaction(async tx => {
      const current = await tx.hotelMapConfig.findUnique({ where: { id: 'singleton' } });
      if (!current) {
        if (revision !== 0) throw new HotelError('Map settings changed; reload before saving', 409);
        await tx.hotelMapConfig.create({ data: { id: 'singleton', revision: 1, settings: { ...config } } });
        return { revision: 1, config };
      }
      const result = await tx.hotelMapConfig.updateMany({ where: { id: 'singleton', revision }, data: { settings: { ...config }, revision: { increment: 1 } } });
      if (!result.count) throw new HotelError('Map settings changed; reload before saving', 409);
      return { revision: revision + 1, config };
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && ['P2002', 'P2034'].includes(String(error.code))) throw new HotelError('Map settings changed; reload before saving', 409);
    throw error;
  }
}

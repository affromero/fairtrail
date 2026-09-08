import { apiSuccess } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { hotelEndpoint } from '@/lib/hotels/http';
import { getHotelMapConfig } from '@/lib/hotels/map-config-store';
import { DEFAULT_HOTEL_MAP_PREFERENCES, validateHotelMapPreferences } from '@/lib/hotels/map-config';

export async function GET() {
  const response = await hotelEndpoint(async actor => {
    const settings = await getHotelMapConfig();
    const user = actor.userId ? await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { hotelMapPreferences: true, hotelMapPreferencesRevision: true } }) : null;
    const preferences = user?.hotelMapPreferences ? validateHotelMapPreferences(user.hotelMapPreferences) : DEFAULT_HOTEL_MAP_PREFERENCES;
    return apiSuccess({ ...settings, preferences, preferencesRevision: user?.hotelMapPreferencesRevision ?? 0, account: !!actor.userId });
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

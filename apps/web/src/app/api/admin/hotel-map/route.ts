import { apiError, apiSuccess } from '@/lib/api-response';
import { requireAdminApi } from '@/lib/admin-guard';
import { readCarJson } from '@/lib/cars/http';
import { CarError } from '@/lib/cars/types';
import { HotelError } from '@/lib/hotels/domain';
import { getHotelMapConfig, saveHotelMapConfig } from '@/lib/hotels/map-config-store';
import { hotelMapActorScope, validateHotelMapConfig } from '@/lib/hotels/map-config';
import { hotelActor } from '@/lib/hotels/access';

async function endpoint(action: () => Promise<Response>): Promise<Response> {
  let response: Response;
  try {
    const denied = await requireAdminApi();
    response = denied ?? await action();
  } catch (error) {
    if (error instanceof HotelError || error instanceof CarError) response = apiError(error.message.replace(/Rental request/gi, 'Map settings request'), error.status);
    else if (error instanceof SyntaxError) response = apiError('Invalid JSON request', 400);
    else response = apiError('Map settings could not be loaded or saved; retry', 500);
  }
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export async function GET() {
  return endpoint(async () => {
    const actor = await hotelActor();
    return apiSuccess({ ...await getHotelMapConfig(), actorScope: hotelMapActorScope(actor.userId) });
  });
}

export async function PATCH(request: Request) {
  return endpoint(async () => {
    const actor = await hotelActor();
    const actorScope = hotelMapActorScope(actor.userId);
    if (request.headers.get('X-Hotel-Map-Actor') !== actorScope) return apiError('Account changed; reload map settings before saving', 409);
    // Reuse the existing bounded, timed streaming JSON reader.
    const body = await readCarJson(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError('Invalid map settings request', 400);
    const entry = body as Record<string, unknown>;
    if (Object.keys(entry).some(key => !['config', 'revision'].includes(key)) || typeof entry.revision !== 'number') return apiError('Send map config and revision', 400);
    let config;
    try { config = validateHotelMapConfig(entry.config); }
    catch (error) { return apiError(error instanceof Error ? error.message : 'Invalid map settings', 400); }
    return apiSuccess({ ...await saveHotelMapConfig(config, entry.revision), actorScope });
  });
}

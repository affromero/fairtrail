import { apiSuccess } from '@/lib/api-response';
import { carEndpoint, carRevisionPrecondition, readCarJson } from '@/lib/cars/http';
import { updateCarPreferences } from '@/lib/cars/preference-store';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return carEndpoint(async actor => apiSuccess(await updateCarPreferences((await context.params).id, await readCarJson(request), actor, carRevisionPrecondition(request))));
}

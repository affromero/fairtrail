import { requireAdminApi, verifyAdminSessionRevocable } from '@/lib/admin-guard';
import { apiError, apiSuccess } from '@/lib/api-response';
import { carActor } from '@/lib/cars/access';
import { readCarJson } from '@/lib/cars/http';
import { CarError } from '@/lib/cars/types';
import { carRecord } from '@/lib/cars/validation';
import { getTravelAdmission, recoverTravelAdmission } from '@/lib/travel/admission';
import { TravelJobError } from '@/lib/travel/errors';

async function endpoint(action: () => Promise<Response>): Promise<Response> {
  let response: Response;
  try {
    if (process.env.SELF_HOSTED !== 'true') response = await verifyAdminSessionRevocable() ? await action() : apiError('Unauthorized', 401);
    else response = await requireAdminApi() ?? await action();
  } catch (error) {
    if (error instanceof TravelJobError || error instanceof CarError) response = apiError(error.message, error.status);
    else if (error instanceof SyntaxError) response = apiError('Invalid JSON request', 400);
    else {
      console.error('[travel] Administrator request failed:', error);
      response = apiError('Travel recovery is unavailable; check server logs and retry', 503);
    }
  }
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export async function GET(): Promise<Response> {
  return endpoint(async () => {
    const actor = await authorizedActor();
    return apiSuccess({ ...await getTravelAdmission(), actorScope: actor.scope });
  });
}

async function authorizedActor() {
  const actor = process.env.SELF_HOSTED === 'true' ? await carActor() : { userId: null, isAdmin: true };
  if (!actor.isAdmin) throw new CarError('Administrator access required', 403);
  return { ...actor, scope: actor.userId ? `user:${actor.userId}` : process.env.SELF_HOSTED === 'true' ? 'single' : 'instance' };
}

export async function POST(request: Request): Promise<Response> {
  return endpoint(async () => {
    const actor = await authorizedActor();
    const { actorScope, ...input } = carRecord(await readCarJson(request));
    if (typeof actorScope !== 'string') throw new CarError('Read current administrator recovery status before continuing', 400);
    if (actorScope !== actor.scope) throw new CarError('Administrator account changed; reload recovery status', 412);
    await recoverTravelAdmission(actor, input);
    return apiSuccess({ ...await getTravelAdmission(), actorScope: actor.scope });
  });
}

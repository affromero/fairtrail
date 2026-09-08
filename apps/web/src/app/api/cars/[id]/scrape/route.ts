import { apiSuccess } from '@/lib/api-response';
import { carEndpoint, carRevisionPrecondition } from '@/lib/cars/http';
import { CarError } from '@/lib/cars/types';
import { validateCarCreationKey } from '@/lib/cars/creation-input';
import { refreshCarTracker } from '@/lib/cars/store';
import { wakeTravelWorker } from '@/lib/travel/http';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return carEndpoint(async actor => {
    const trackerId = (await context.params).id, revision = carRevisionPrecondition(request);
    if (revision === undefined) throw new CarError('Supply X-Car-Revision to confirm the rental settings being checked', 428);
    const refreshKey = validateCarCreationKey(request.headers.get('Idempotency-Key'));
    const run = await refreshCarTracker(trackerId, actor, false, { key: refreshKey, revision });
    wakeTravelWorker();
    return apiSuccess({ id: run!.id, trackerId, status: run!.status, refreshKey }, 202);
  });
}

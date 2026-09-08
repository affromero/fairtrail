import { apiSuccess } from '@/lib/api-response';
import { carEndpoint, readCarJson } from '@/lib/cars/http';
import { carTrackerDto, createCarTracker } from '@/lib/cars/store';
import { listCarTrackerPage } from '@/lib/cars/list';
import { CarError } from '@/lib/cars/types';
import { validateCarCreationKey } from '@/lib/cars/creation-input';
import { wakeTravelWorker } from '@/lib/travel/http';

export async function GET(request: Request) {
  return carEndpoint(async actor => {
    const params = new URL(request.url).searchParams, limit = params.get('limit');
    if (limit !== null && !/^(?:[1-9]|[1-9]\d|100)$/.test(limit)) throw new CarError('Choose a tracker page size from 1 to 100');
    return apiSuccess(await listCarTrackerPage(actor, { admin: params.get('admin') === 'true', limit: limit === null ? 25 : Number(limit), cursor: params.get('cursor') }));
  });
}
export async function POST(request: Request) {
  return carEndpoint(async actor => {
    const input = await readCarJson(request), creationKey = validateCarCreationKey(request.headers.get('Idempotency-Key'));
    const tracker = await createCarTracker(input, actor, creationKey);
    wakeTravelWorker();
    return apiSuccess({ tracker: carTrackerDto(tracker), creationKey }, 201);
  });
}

import { apiSuccess } from '@/lib/api-response';
import { carEndpoint, readCarJson } from '@/lib/cars/http';
import { carTrackerDto, createCarTracker, listCarTrackers } from '@/lib/cars/store';
import { validateCarCreationKey } from '@/lib/cars/creation-input';

export async function GET(request: Request) {
  return carEndpoint(async actor => apiSuccess({ trackers: await listCarTrackers(actor, 100, new URL(request.url).searchParams.get('admin') === 'true') }));
}
export async function POST(request: Request) {
  return carEndpoint(async actor => {
    const input = await readCarJson(request), creationKey = validateCarCreationKey(request.headers.get('Idempotency-Key'));
    const tracker = await createCarTracker(input, actor, creationKey);
    return apiSuccess({ tracker: carTrackerDto(tracker), creationKey }, 201);
  });
}

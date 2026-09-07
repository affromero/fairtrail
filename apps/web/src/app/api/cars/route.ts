import { apiSuccess } from '@/lib/api-response';
import { carEndpoint, readCarJson } from '@/lib/cars/http';
import { carTrackerDto, createCarTracker, listCarTrackers } from '@/lib/cars/store';

export async function GET(request: Request) {
  return carEndpoint(async actor => apiSuccess({ trackers: await listCarTrackers(actor, 100, new URL(request.url).searchParams.get('admin') === 'true') }));
}
export async function POST(request: Request) {
  return carEndpoint(async actor => apiSuccess({ tracker: carTrackerDto(await createCarTracker(await readCarJson(request), actor, request.headers.get('Idempotency-Key'))) }, 201));
}

import { apiSuccess } from '@/lib/api-response';
import { carEndpoint, carRevisionPrecondition, readCarJson } from '@/lib/cars/http';
import { carTrackerDto, deleteCarTracker, editCarTracker } from '@/lib/cars/store';
import { getCarDetail } from '@/lib/cars/views';

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return carEndpoint(async actor => {
    const detail = await getCarDetail((await context.params).id, actor), response = apiSuccess(detail);
    response.headers.set('X-Car-Revision', String(detail.tracker.revision));
    return response;
  });
}
export async function PATCH(request: Request, context: Context) {
  return carEndpoint(async actor => {
    const revision = carRevisionPrecondition(request);
    const tracker = carTrackerDto(await editCarTracker((await context.params).id, await readCarJson(request), actor, revision)), response = apiSuccess({ tracker });
    response.headers.set('X-Car-Revision', String(tracker.revision));
    return response;
  });
}
export async function DELETE(request: Request, context: Context) {
  return carEndpoint(async actor => {
    const { id } = await context.params;
    await deleteCarTracker(id, actor, carRevisionPrecondition(request));
    return apiSuccess({ id, deleted: true });
  });
}

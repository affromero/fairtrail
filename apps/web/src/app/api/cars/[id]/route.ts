import { apiSuccess } from '@/lib/api-response';
import { carEndpoint, readCarJson } from '@/lib/cars/http';
import { carTrackerDto, deleteCarTracker, editCarTracker } from '@/lib/cars/store';
import { getCarDetail } from '@/lib/cars/views';

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return carEndpoint(async actor => apiSuccess(await getCarDetail((await context.params).id, actor)));
}
export async function PATCH(request: Request, context: Context) {
  return carEndpoint(async actor => apiSuccess({ tracker: carTrackerDto(await editCarTracker((await context.params).id, await readCarJson(request), actor)) }));
}
export async function DELETE(request: Request, context: Context) {
  return carEndpoint(async actor => {
    const { id } = await context.params;
    await deleteCarTracker(id, actor);
    return apiSuccess({ id, deleted: true });
  });
}

import { apiSuccess } from '@/lib/api-response';
import { carEndpoint } from '@/lib/cars/http';
import { cancelCarSearch } from '@/lib/cars/store';
import { getCarRunView } from '@/lib/cars/views';

type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return carEndpoint(async actor => apiSuccess(await getCarRunView((await context.params).id, actor)));
}
export async function DELETE(request: Request, context: Context) {
  return carEndpoint(async actor => {
    const run = await cancelCarSearch((await context.params).id, actor);
    return apiSuccess({ id: run.id, status: run.status });
  });
}

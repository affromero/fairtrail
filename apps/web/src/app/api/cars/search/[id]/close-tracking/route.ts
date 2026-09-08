import { apiSuccess } from '@/lib/api-response';
import { carEndpoint } from '@/lib/cars/http';
import { closeCarSearchTracking } from '@/lib/cars/store';

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  return carEndpoint(async actor => {
    const run = await closeCarSearchTracking((await context.params).id, actor);
    return apiSuccess({ id: run.id, trackingClosed: run.trackingClosed });
  });
}

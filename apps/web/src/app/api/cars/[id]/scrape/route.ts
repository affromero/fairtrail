import { apiSuccess } from '@/lib/api-response';
import { carEndpoint } from '@/lib/cars/http';
import { refreshCarTracker } from '@/lib/cars/store';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return carEndpoint(async actor => {
    const run = await refreshCarTracker((await context.params).id, actor);
    return apiSuccess({ id: run!.id, status: run!.status }, 202);
  });
}

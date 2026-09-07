import { apiSuccess } from '@/lib/api-response';
import { carEndpoint } from '@/lib/cars/http';

export async function GET() {
  return carEndpoint(async actor => apiSuccess({
    scope: actor.userId === null ? 'single' : `user:${actor.userId}`,
    isAdmin: actor.isAdmin,
  }));
}

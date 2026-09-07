import { apiSuccess } from '@/lib/api-response';
import { carEndpoint } from '@/lib/cars/http';
import { searchCarLocations } from '@/lib/cars/locations';

export async function GET(request: Request) {
  return carEndpoint(async () => apiSuccess(await searchCarLocations(new URL(request.url).searchParams.get('q') ?? '')));
}

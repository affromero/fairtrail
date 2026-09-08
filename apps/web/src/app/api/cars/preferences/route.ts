import { apiSuccess } from '@/lib/api-response';
import { carEndpoint } from '@/lib/cars/http';
import { getCarPreferences } from '@/lib/cars/preference-store';

export async function GET() {
  return carEndpoint(async actor => apiSuccess(await getCarPreferences(actor)));
}

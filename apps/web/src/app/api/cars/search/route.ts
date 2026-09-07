import { apiSuccess } from '@/lib/api-response';
import { carEndpoint, readCarJson } from '@/lib/cars/http';
import { createCarCatalogSearch } from '@/lib/cars/store';
import { wakeTravelWorker } from '@/lib/travel/http';
import { validateCarCreationKey } from '@/lib/cars/creation-input';
import { listCarSearchPage } from '@/lib/cars/search-list';

export async function GET(request: Request) {
  return carEndpoint(async actor => apiSuccess(await listCarSearchPage(actor, new URL(request.url).searchParams.get('cursor'))));
}

export async function POST(request: Request) {
  return carEndpoint(async actor => {
    const creationKey = validateCarCreationKey(request.headers.get('Idempotency-Key'));
    const run = await createCarCatalogSearch(await readCarJson(request), actor, creationKey);
    wakeTravelWorker();
    return apiSuccess({ id: run.id, status: run.status, creationKey }, 202);
  });
}

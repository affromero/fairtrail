import { apiSuccess } from '@/lib/api-response';
import { carEndpoint, readCarJson } from '@/lib/cars/http';
import { validateCarCreationKey } from '@/lib/cars/creation-input';
import { createCarProtectionRecheck } from '@/lib/cars/store';
import { wakeTravelWorker } from '@/lib/travel/http';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return carEndpoint(async actor => {
    const creationKey = validateCarCreationKey(request.headers.get('Idempotency-Key'));
    const { id } = await context.params;
    const run = await createCarProtectionRecheck(id, await readCarJson(request), actor, creationKey);
    wakeTravelWorker();
    return apiSuccess({ id: run.id, status: run.status, creationKey }, 202);
  });
}

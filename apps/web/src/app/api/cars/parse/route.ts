import { apiSuccess } from '@/lib/api-response';
import { carEndpoint, readCarJson } from '@/lib/cars/http';
import { carRecord } from '@/lib/cars/validation';
import { CarError } from '@/lib/cars/types';
import { parseCarQuery } from '@/lib/cars/parse';

export async function POST(request: Request) {
  return carEndpoint(async actor => {
    const body = carRecord(await readCarJson(request));
    if (Object.keys(body).some(key => !['text', 'locale'].includes(key))) throw new CarError('Unsupported draft request field');
    if (body.locale !== undefined && typeof body.locale !== 'string') throw new CarError('Invalid draft language');
    return apiSuccess({ draft: await parseCarQuery(body.text, actor, body.locale, request.signal) });
  });
}

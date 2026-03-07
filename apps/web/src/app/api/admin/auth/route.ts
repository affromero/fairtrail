import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { verifyPassword, createSessionToken, setSessionCookie } from '@/lib/admin-auth';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.password) {
    return apiError('Missing password', 400);
  }

  if (!(await verifyPassword(body.password))) {
    return apiError('Invalid password', 401);
  }

  const token = createSessionToken();
  await setSessionCookie(token);

  return apiSuccess({ ok: true });
}

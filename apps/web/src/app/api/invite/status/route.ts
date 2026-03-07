import { apiSuccess } from '@/lib/api-response';
import { hasValidInvite } from '@/lib/invite-auth';

export async function GET() {
  const valid = await hasValidInvite();
  return apiSuccess({ valid });
}

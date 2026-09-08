import { apiError, apiSuccess } from '@/lib/api-response';
import { requireAdminApi } from '@/lib/admin-guard';
import { cliUpdateInfo, updateManagedCli } from '@/lib/scraper/cli-update';

export async function GET(request: Request) {
  const denial = await requireAdminApi();
  if (denial) return denial;
  const provider = new URL(request.url).searchParams.get('provider');
  if (provider !== 'codex' && provider !== 'claude-code') return apiError('Choose a supported CLI provider', 400);
  return apiSuccess(cliUpdateInfo(provider));
}

export async function POST(request: Request) {
  const denial = await requireAdminApi();
  if (denial) return denial;
  const body = await request.json().catch(() => null);
  if (!body || (body.provider !== 'codex' && body.provider !== 'claude-code')) return apiError('Choose a supported CLI provider', 400);
  try { return apiSuccess(await updateManagedCli(body.provider)); }
  catch (error) { return apiError(error instanceof Error ? error.message : 'CLI update failed; recheck the installed version', 503); }
}

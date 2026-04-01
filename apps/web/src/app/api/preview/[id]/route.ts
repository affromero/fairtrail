import { apiError, apiSuccess } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import type { PreviewResultPayload, PreviewRunStatusPayload } from '@/lib/preview-run';

const PREVIEW_ACTIVE_TIMEOUT_MS = 10 * 60 * 1000;
const TERMINAL_PREVIEW_STATUSES = new Set(['completed', 'failed']);
const ACTIVE_PREVIEW_STATUSES = new Set(['pending', 'running']);
const PREVIEW_TIMEOUT_ERROR = 'Preview run timed out before completing';

interface PreviewRunRow {
  id: string;
  status: string;
  resultPayload: unknown;
  error: string | null;
  expiresAt: Date;
  updatedAt: Date;
}

interface PreviewRunStore {
  findUnique(args: { where: { id: string } }): Promise<PreviewRunRow | null>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<PreviewRunRow>;
}

const previewRunStore = (prisma as unknown as { previewRun: PreviewRunStore }).previewRun;

function isExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const notFound = () => {
    const response = apiError('Preview run not found or expired', 404);
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
    return response;
  };

  const { id } = await context.params;

  let previewRun = await previewRunStore.findUnique({
    where: { id },
  });

  if (!previewRun) {
    return notFound();
  }

  if (
    ACTIVE_PREVIEW_STATUSES.has(previewRun.status) &&
    previewRun.updatedAt.getTime() <= Date.now() - PREVIEW_ACTIVE_TIMEOUT_MS
  ) {
    previewRun = await previewRunStore.update({
      where: { id },
      data: {
        status: 'failed',
        error: PREVIEW_TIMEOUT_ERROR,
      },
    });
  }

  if (TERMINAL_PREVIEW_STATUSES.has(previewRun.status) && isExpired(previewRun.expiresAt)) {
    return notFound();
  }

  const response: PreviewRunStatusPayload = {
    id: previewRun.id,
    status: previewRun.status as PreviewRunStatusPayload['status'],
    result: previewRun.resultPayload as PreviewResultPayload | null,
    error: previewRun.error,
    expiresAt: previewRun.expiresAt.toISOString(),
  };

  const apiResponse = apiSuccess(response);
  apiResponse.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return apiResponse;
}

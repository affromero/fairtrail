import { apiError, apiSuccess } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import type { PreviewResultPayload, PreviewRunStatusPayload } from '@/lib/preview-run';

function isExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  const previewRun = await prisma.previewRun.findUnique({
    where: { id },
  });

  if (!previewRun || isExpired(previewRun.expiresAt)) {
    return apiError('Preview run not found or expired', 404);
  }

  const response: PreviewRunStatusPayload = {
    id: previewRun.id,
    status: previewRun.status as PreviewRunStatusPayload['status'],
    result: previewRun.resultPayload as PreviewResultPayload | null,
    error: previewRun.error,
    expiresAt: previewRun.expiresAt.toISOString(),
  };

  return apiSuccess(response);
}

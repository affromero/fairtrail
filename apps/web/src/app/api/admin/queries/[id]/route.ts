import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return apiError('Invalid JSON body', 400);

  const existing = await prisma.query.findUnique({ where: { id } });
  if (!existing) return apiError('Query not found', 404);

  const data: Record<string, unknown> = {};

  if (typeof body.active === 'boolean') data.active = body.active;
  if (typeof body.scrapeInterval === 'number' && [1, 3, 6, 12, 24].includes(body.scrapeInterval)) {
    data.scrapeInterval = body.scrapeInterval;
  }

  const updated = await prisma.query.update({ where: { id }, data });
  return apiSuccess(updated);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const existing = await prisma.query.findUnique({ where: { id } });
  if (!existing) return apiError('Query not found', 404);

  await prisma.query.delete({ where: { id } });
  return apiSuccess({ deleted: true });
}

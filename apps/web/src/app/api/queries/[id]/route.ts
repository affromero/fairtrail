import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';

const ALLOWED_INTERVALS = [1, 3, 6, 12, 24];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const isSelfHosted = process.env.SELF_HOSTED === 'true';

  const body = await request.json().catch(() => null);
  const token = body?.deleteToken;

  const query = await prisma.query.findUnique({
    where: { id },
    select: { deleteToken: true, groupId: true },
  });

  if (!query) return apiError('Tracker not found', 404);

  if (!isSelfHosted) {
    if (!token || typeof token !== 'string') {
      return apiError('Missing delete token', 401);
    }
    if (!query.deleteToken || query.deleteToken !== token) {
      return apiError('Invalid delete token', 403);
    }
  }

  const interval = Number(body.scrapeInterval);
  if (!ALLOWED_INTERVALS.includes(interval)) {
    return apiError(`scrapeInterval must be one of: ${ALLOWED_INTERVALS.join(', ')}`, 400);
  }

  // Update this query and all siblings in the group
  const idsToUpdate = [id];
  if (query.groupId) {
    const siblings = await prisma.query.findMany({
      where: { groupId: query.groupId, id: { not: id } },
      select: { id: true },
    });
    idsToUpdate.push(...siblings.map((s) => s.id));
  }

  await prisma.query.updateMany({
    where: { id: { in: idsToUpdate } },
    data: { scrapeInterval: interval },
  });

  return apiSuccess({ scrapeInterval: interval, updated: idsToUpdate.length });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const isSelfHosted = process.env.SELF_HOSTED === 'true';

  const body = await request.json().catch(() => null);
  const token = body?.deleteToken;

  const query = await prisma.query.findUnique({
    where: { id },
    select: { deleteToken: true },
  });

  if (!query) {
    return apiError('Tracker not found', 404);
  }

  // Self-hosted instances can delete without a token
  if (!isSelfHosted) {
    if (!token || typeof token !== 'string') {
      return apiError('Missing delete token', 401);
    }
    if (!query.deleteToken || query.deleteToken !== token) {
      return apiError('Invalid delete token', 403);
    }
  }

  await prisma.query.delete({ where: { id } });

  return apiSuccess({ deleted: true });
}

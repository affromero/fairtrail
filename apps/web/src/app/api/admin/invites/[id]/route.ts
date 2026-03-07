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

  const data: Record<string, unknown> = {};
  if (typeof body.active === 'boolean') data.active = body.active;
  if (typeof body.label === 'string') data.label = body.label.trim() || null;

  if (Object.keys(data).length === 0) {
    return apiError('Nothing to update', 400);
  }

  try {
    const invite = await prisma.inviteCode.update({
      where: { id },
      data,
    });
    return apiSuccess(invite);
  } catch {
    return apiError('Invite code not found', 404);
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    await prisma.inviteCode.delete({ where: { id } });
    return apiSuccess({ deleted: true });
  } catch {
    return apiError('Invite code not found', 404);
  }
}

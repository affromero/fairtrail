import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { createInviteToken, setInviteCookie } from '@/lib/invite-auth';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.code || typeof body.code !== 'string') {
    return apiError('Missing invite code', 400);
  }

  const code = body.code.trim();

  const invite = await prisma.inviteCode.findUnique({ where: { code } });

  if (!invite || !invite.active) {
    return apiError('Invalid invite code', 401);
  }

  if (invite.expiresAt && invite.expiresAt < new Date()) {
    return apiError('Invite code has expired', 401);
  }

  await prisma.inviteCode.update({
    where: { id: invite.id },
    data: { usesCount: { increment: 1 } },
  });

  const token = createInviteToken(code);
  await setInviteCookie(token);

  return apiSuccess({ valid: true });
}

import { NextRequest } from 'next/server';
import { randomUUID } from 'crypto';
import { apiSuccess, apiError } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const invites = await prisma.inviteCode.findMany({
    orderBy: { createdAt: 'desc' },
  });

  return apiSuccess(invites);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);

  const label = body?.label?.trim() || null;
  const expiresAt = body?.expiresAt ? new Date(body.expiresAt) : null;

  if (expiresAt && isNaN(expiresAt.getTime())) {
    return apiError('Invalid expiresAt date', 400);
  }

  const invite = await prisma.inviteCode.create({
    data: {
      code: randomUUID(),
      label,
      expiresAt,
    },
  });

  return apiSuccess(invite, 201);
}

import { apiSuccess } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';

export async function GET() {
  const queries = await prisma.query.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { snapshots: true, fetchRuns: true } },
    },
  });

  return apiSuccess(queries);
}

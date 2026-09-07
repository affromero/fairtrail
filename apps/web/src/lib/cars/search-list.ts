import { prisma } from '@/lib/prisma';
import type { CarActor } from './access';
import { carInteger, validateCarSearch } from './validation';
import { carListCursor, carListPosition } from './list-cursor';

export async function listCarSearchPage(actor: CarActor, cursor: string | null = null, limit = 25) {
  carInteger(limit, 1, 100, 'Search page size');
  const scope = JSON.stringify(['searches', actor.userId]);
  const rows = await prisma.carSearchRun.findMany({ where: { AND: [{ trackerId: null }, actor.userId === null ? {} : { userId: actor.userId }, carListPosition(cursor, scope)] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
  const searches = rows.slice(0, limit).map(row => {
    const search = validateCarSearch(row.request, row.createdAt, { allowUnresolvedProviders: true });
    return { id: row.id, trackerId: null, status: row.status, createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null, error: row.error, label: `${search.pickup.name} → ${search.dropoff.name}` };
  });
  const last = searches.at(-1);
  return { searches, nextCursor: rows.length > limit && last ? carListCursor(scope, last) : null };
}

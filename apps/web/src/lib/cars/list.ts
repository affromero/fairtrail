import { prisma } from '@/lib/prisma';
import type { CarActor } from './access';
import { carInteger } from './validation';
import { carTrackerDto } from './store';
import { CarError } from './types';
import { carListCursor, carListPosition } from './list-cursor';

/** Cursor positions grant no access: ownership is applied independently on every page. */
export async function listCarTrackerPage(actor: CarActor, { limit = 25, admin = false, cursor = null }: { limit?: number; admin?: boolean; cursor?: string | null } = {}) {
  if (admin && !actor.isAdmin) throw new CarError('Administrator access required', 403);
  carInteger(limit, 1, 100, 'Tracker page size');
  const scope = JSON.stringify([actor.userId, admin]);
  const position = carListPosition(cursor, scope);
  const rows = await prisma.carTracker.findMany({ where: { AND: [admin || actor.userId === null ? {} : { userId: actor.userId }, position] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
  const trackers = rows.slice(0, limit).map(carTrackerDto), last = trackers.at(-1);
  const nextCursor = rows.length > limit && last ? carListCursor(scope, last) : null;
  return { trackers, nextCursor };
}

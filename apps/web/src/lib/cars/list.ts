import { prisma } from '@/lib/prisma';
import type { Prisma } from '@/generated/prisma/client';
import type { CarActor } from './access';
import { carInteger, carRecord, carText } from './validation';
import { carTrackerDto } from './store';
import { CarError } from './types';

/** Cursor positions grant no access: ownership is applied independently on every page. */
export async function listCarTrackerPage(actor: CarActor, { limit = 25, admin = false, cursor = null }: { limit?: number; admin?: boolean; cursor?: string | null } = {}) {
  if (admin && !actor.isAdmin) throw new CarError('Administrator access required', 403);
  carInteger(limit, 1, 100, 'Tracker page size');
  const scope = JSON.stringify([actor.userId, admin]);
  let position: Prisma.CarTrackerWhereInput = {};
  if (cursor !== null) {
    try {
      if (!/^[A-Za-z0-9_-]{1,1500}$/.test(cursor)) throw new Error('Invalid encoding');
      const bytes = Buffer.from(cursor, 'base64url');
      if (bytes.toString('base64url') !== cursor) throw new Error('Invalid encoding');
      const value = carRecord(JSON.parse(bytes.toString('utf8')));
      if (value.version !== 1 || value.scope !== scope || typeof value.createdAt !== 'string') throw new Error('Invalid scope');
      const id = carText(value.id, 200, 'tracker identity'), createdAt = new Date(value.createdAt);
      if (createdAt.toISOString() !== value.createdAt) throw new Error('Invalid date');
      position = { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] };
    } catch (error) { throw new CarError('Invalid tracker page cursor; refresh the list', 400, { cause: error }); }
  }
  const rows = await prisma.carTracker.findMany({ where: { AND: [admin || actor.userId === null ? {} : { userId: actor.userId }, position] }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: limit + 1 });
  const trackers = rows.slice(0, limit).map(carTrackerDto), last = trackers.at(-1);
  const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ version: 1, scope, createdAt: last.createdAt, id: last.id })).toString('base64url') : null;
  return { trackers, nextCursor };
}

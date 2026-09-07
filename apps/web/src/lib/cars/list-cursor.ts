import { CarError } from './types';
import { carRecord, carText } from './validation';

export function carListPosition(cursor: string | null, scope: string) {
  if (cursor === null) return {};
  try {
    if (!/^[A-Za-z0-9_-]{1,1500}$/.test(cursor)) throw new Error('Invalid encoding');
    const bytes = Buffer.from(cursor, 'base64url');
    if (bytes.toString('base64url') !== cursor) throw new Error('Invalid encoding');
    const value = carRecord(JSON.parse(bytes.toString('utf8')));
    if (value.version !== 1 || value.scope !== scope || typeof value.createdAt !== 'string') throw new Error('Invalid scope');
    const id = carText(value.id, 200, 'rental identity'), createdAt = new Date(value.createdAt);
    if (createdAt.toISOString() !== value.createdAt) throw new Error('Invalid date');
    return { OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }] };
  } catch (error) { throw new CarError('Invalid rental page cursor; refresh the list', 400, { cause: error }); }
}
export function carListCursor(scope: string, row: { id: string; createdAt: string }) {
  return Buffer.from(JSON.stringify({ version: 1, scope, createdAt: row.createdAt, id: row.id })).toString('base64url');
}

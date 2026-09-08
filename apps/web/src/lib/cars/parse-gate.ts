import { createHash, randomUUID } from 'node:crypto';
import { notificationTransaction } from '../notifications/database';
import { CarError } from './types';
import type { CarActor } from './access';

/** No prompts are stored. The token fences release after cancellation or restart. */
export async function withCarParseGate<T>(actor: CarActor, work: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
  const id = createHash('sha256').update(JSON.stringify(['car-parse', actor.userId])).digest('hex'), token = randomUUID();
  await notificationTransaction(async tx => {
    const gate = await tx.carParseGate.upsert({ where: { id }, create: { id, userId: actor.userId }, update: {} });
    await tx.$queryRaw`SELECT id FROM "CarParseGate" WHERE id = ${id} FOR UPDATE`;
    const current = await tx.carParseGate.findUniqueOrThrow({ where: { id: gate.id } });
    if ((current.token && current.expiresAt > new Date()) || current.nextAllowedAt > new Date()) throw new CarError('A draft is already being prepared or was just requested; wait before trying again', 429);
    await tx.carParseGate.update({ where: { id }, data: { token, expiresAt: new Date(Date.now() + 600_000), nextAllowedAt: new Date(Date.now() + 10_000) } });
  }, parent);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error('Car draft deadline exceeded')), 270_000);
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  let outcome: { ok: true; value: T } | { ok: false; error: unknown };
  try { signal.throwIfAborted(); outcome = { ok: true, value: await work(signal) }; }
  catch (error) { outcome = { ok: false, error }; }
  finally { clearTimeout(timer); }
  try {
    await notificationTransaction(tx => tx.carParseGate.updateMany({ where: { id, token }, data: { token: null, expiresAt: new Date(0) } }));
  } catch (error) {
    if (!outcome.ok) throw new AggregateError([outcome.error, error], 'Car draft and gate release failed', { cause: error });
    throw error;
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}

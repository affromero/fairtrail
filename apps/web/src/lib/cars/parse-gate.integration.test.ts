import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../prisma';
import { withCarParseGate } from './parse-gate';
import type { CarActor } from './access';

describe.skipIf(process.env.CAR_PARSE_INTEGRATION_TESTS !== '1')('car draft admission against PostgreSQL', () => {
  let actor: CarActor;
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
    if (url.hostname !== '127.0.0.1' || url.port !== '55440' || url.pathname !== '/car_test') throw new Error('Draft gate tests require disposable localhost:55440/car_test');
  });
  beforeEach(async () => {
    actor = { userId: (await prisma.user.create({ data: { username: `car-draft-${crypto.randomUUID()}` } })).id, isAdmin: false };
  });
  afterEach(async () => { if (actor) await prisma.user.delete({ where: { id: actor.userId! } }); });
  afterAll(async () => { await prisma.$disconnect(); });

  it('admits one draft per owner and preserves rate cooldown after release', async () => {
    let started!: () => void, finish!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const hold = new Promise<void>(resolve => { finish = resolve; });
    const first = withCarParseGate(actor, async () => { started(); await hold; return 'draft'; });
    await entered;
    try {
      await expect(withCarParseGate(actor, async () => 'duplicate')).rejects.toMatchObject({ status: 429 });
    } finally { finish(); }
    expect(await first).toBe('draft');
    expect(await prisma.carParseGate.findUnique({ where: { userId: actor.userId! } })).toMatchObject({ token: null });
    await expect(withCarParseGate(actor, async () => 'too soon')).rejects.toMatchObject({ status: 429 });
  });

  it('releases a failed draft but never releases a replacement token', async () => {
    await expect(withCarParseGate(actor, async () => { throw new Error('provider failed'); })).rejects.toThrow('provider failed');
    const row = await prisma.carParseGate.findUniqueOrThrow({ where: { userId: actor.userId! } });
    expect(row.token).toBeNull();
    await prisma.carParseGate.update({ where: { id: row.id }, data: { nextAllowedAt: new Date(0) } });
    const replacement = crypto.randomUUID();
    expect(await withCarParseGate(actor, async () => {
      await prisma.carParseGate.update({ where: { id: row.id }, data: { token: replacement } });
      return 'late response';
    })).toBe('late response');
    expect(await prisma.carParseGate.findUnique({ where: { id: row.id } })).toMatchObject({ token: replacement });
  });

  it('keeps admission occupied until cancelled inference has terminated', async () => {
    const controller = new AbortController();
    await expect(withCarParseGate(actor, async signal => {
      controller.abort(new Error('cancelled'));
      expect(signal.aborted).toBe(true);
      await expect(withCarParseGate(actor, async () => 'duplicate')).rejects.toMatchObject({ status: 429 });
      signal.throwIfAborted();
    }, controller.signal)).rejects.toThrow('cancelled');
    expect(await prisma.carParseGate.findUnique({ where: { userId: actor.userId! } })).toMatchObject({ token: null });
  });
});

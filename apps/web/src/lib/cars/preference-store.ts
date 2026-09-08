import { prisma } from '@/lib/prisma';
import type { CarActor } from './access';
import { effectiveCarProviders, validateCarProviders } from './preferences';
import { validateCarPreferencesView } from './preference-view';
import { carInteger, carRecord } from './validation';
import { CarError } from './types';

function view(userId: string | null, providers: unknown, revision: number | null) {
  return validateCarPreferencesView({ userId, scope: userId === null ? 'single' : `user:${userId}`, providers, effectiveProviders: effectiveCarProviders(providers), revision, savingAllowed: userId !== null });
}

export async function getCarPreferences(actor: CarActor) {
  if (actor.userId === null) return view(null, [], null);
  const row = await prisma.user.findUnique({ where: { id: actor.userId }, select: { preferredCarProviders: true, carPreferencesRevision: true } });
  if (!row) throw new CarError('Car preference account is unavailable', 404);
  return view(actor.userId, row.preferredCarProviders, row.carPreferencesRevision);
}

export async function updateCarPreferences(id: string, raw: unknown, actor: CarActor, revision: number | undefined) {
  if (actor.userId === null || actor.userId !== id) throw new CarError('Car preference account is unavailable', 404);
  if (revision === undefined) throw new CarError('Read current preferences and supply X-Car-Revision', 428);
  carInteger(revision, 0, 2147483646, 'Preference revision');
  const body = carRecord(raw);
  if (Object.keys(body).some(key => key !== 'providers')) throw new CarError('Only car provider preferences can be changed here');
  const providers = validateCarProviders(body.providers, true);
  return prisma.$transaction(async tx => {
    const updated = await tx.user.updateMany({ where: { id, carPreferencesRevision: revision }, data: { preferredCarProviders: providers, carPreferencesRevision: { increment: 1 } } });
    if (!updated.count) {
      if (!(await tx.user.findUnique({ where: { id }, select: { id: true } }))) throw new CarError('Car preference account is unavailable', 404);
      throw new CarError('Car preferences changed; read current choices before updating', 412);
    }
    return view(id, providers, revision + 1);
  });
}

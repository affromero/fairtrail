import { CarError, type CarSource } from './types';
import { carInteger, carRecord, carText } from './validation';
import { effectiveCarProviders, validateCarProviders } from './preferences';

export interface CarPreferencesView { scope: string; userId: string | null; providers: CarSource[]; effectiveProviders: CarSource[]; revision: number | null; savingAllowed: boolean }

export function validateCarPreferencesView(raw: unknown): CarPreferencesView {
  const value = carRecord(raw);
  if (Object.keys(value).some(key => !['scope', 'userId', 'providers', 'effectiveProviders', 'revision', 'savingAllowed'].includes(key))) throw new CarError('Unexpected car preference fields');
  const providers = validateCarProviders(value.providers, true), effectiveProviders = validateCarProviders(value.effectiveProviders);
  if (JSON.stringify(effectiveProviders) !== JSON.stringify(effectiveCarProviders(providers))) throw new CarError('Car provider defaults disagree with saved preferences');
  if (value.userId === null) {
    if (value.scope !== 'single' || value.revision !== null || value.savingAllowed !== false || providers.length) throw new CarError('Invalid single-user car preferences');
    return { scope: 'single', userId: null, providers, effectiveProviders, revision: null, savingAllowed: false };
  }
  const userId = carText(value.userId, 200, 'preference owner');
  if (!/^[A-Za-z0-9_-]+$/.test(userId) || value.scope !== `user:${userId}` || value.savingAllowed !== true) throw new CarError('Invalid car preference account');
  return { scope: `user:${userId}`, userId, providers, effectiveProviders, revision: carInteger(value.revision, 0, 2147483647, 'Preference revision'), savingAllowed: true };
}

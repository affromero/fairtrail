import { describe, expect, it } from 'vitest';
import { validateCarPreferencesView } from './preference-view';

const view = { scope: 'user:alice', userId: 'alice', providers: [], effectiveProviders: ['discovercars', 'autoeurope'], revision: 0, savingAllowed: true };
describe('car preference response validation', () => {
  it('retains inheritance instead of converting defaults into explicit preferences', () => {
    expect(validateCarPreferencesView(view)).toMatchObject({ providers: [], effectiveProviders: ['discovercars', 'autoeurope'] });
    expect(validateCarPreferencesView({ ...view, scope: 'single', userId: null, revision: null, savingAllowed: false })).toMatchObject({ savingAllowed: false, revision: null });
  });
  it('preserves an explicit provider order', () => {
    const providers = ['autoeurope', 'discovercars'];
    expect(validateCarPreferencesView({ ...view, providers, effectiveProviders: providers }).providers).toEqual(providers);
  });
  it.each([
    { scope: 'user:bob' }, { userId: '../alice' }, { revision: -1 }, { revision: 1.5 }, { revision: null },
    { savingAllowed: false }, { effectiveProviders: ['autoeurope'] }, { providers: ['unknown'] },
    { providers: ['discovercars', 'discovercars'] }, { secret: 'not public data' },
    { scope: 'single', userId: null, revision: 0, savingAllowed: false },
  ])('rejects inconsistent account, revision or provider evidence %#', changes => {
    expect(() => validateCarPreferencesView({ ...view, ...changes })).toThrow();
  });
});

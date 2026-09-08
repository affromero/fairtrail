import { describe, expect, it } from 'vitest';
import { carSearchFixture } from '@/test/car-fixtures';
import { carProviderLocationLabels } from './location-labels';

describe('provider search location disclosure', () => {
  it('retains provider order and full labels without mixing unresolved or unselected providers', () => {
    const location = carSearchFixture().pickup;
    const name = 'Terminal collection area '.repeat(10);
    location.providerNames = { discovercars: name, autoeurope: 'Different collection area' };
    expect(carProviderLocationLabels(location, ['discovercars'])).toEqual([{ source: 'discovercars', name }]);
    expect(carProviderLocationLabels(location, ['autoeurope', 'discovercars', 'autoeurope'])).toEqual([
      { source: 'autoeurope', name: 'Different collection area' }, { source: 'discovercars', name },
    ]);
    delete location.providerNames;
    expect(carProviderLocationLabels(location, ['discovercars', 'autoeurope'])).toEqual([]);
  });
});

import type { CarLocation, CarSource } from './types';

/** Provider search areas, not supplier branch addresses. Inputs are validated views. */
export function carProviderLocationLabels(location: CarLocation, sources: readonly CarSource[]): { source: CarSource; name: string }[] {
  return [...new Set(sources)].flatMap(source => {
    const name = location.providerNames?.[source];
    return name ? [{ source, name }] : [];
  });
}

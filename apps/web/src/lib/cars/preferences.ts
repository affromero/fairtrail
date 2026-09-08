import { CAR_SOURCES, CarError, type CarSource } from './types';

export const CAR_PROVIDER_LABELS: Record<CarSource, string> = { discovercars: 'DiscoverCars', autoeurope: 'Auto Europe' };

export function validateCarProviders(raw: unknown, allowEmpty = false): CarSource[] {
  if (!Array.isArray(raw) || (!allowEmpty && !raw.length) || raw.length > CAR_SOURCES.length) throw new CarError('Choose at least one rental provider or reset saved preferences to defaults');
  const sources = raw.map(value => {
    const source = CAR_SOURCES.find(source => source === value);
    if (!source) throw new CarError('Unknown rental provider');
    return source;
  });
  if (new Set(sources).size !== sources.length) throw new CarError('Provider preferences must not contain duplicates');
  return sources;
}

export function effectiveCarProviders(saved: unknown): CarSource[] {
  const sources = validateCarProviders(saved, true);
  return sources.length ? sources : [...CAR_SOURCES];
}

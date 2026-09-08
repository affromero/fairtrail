import type { CarRequirement } from './types';

/** Material eligibility terms participate in identity; observation metadata does not. */
export function carRequirementTerms(requirements: CarRequirement[]): string {
  return JSON.stringify(requirements.map(item => JSON.stringify([item.kind, item.appliesTo, item.condition, item.evidence.value])).sort());
}

import { CLI_PROVIDERS, PROVIDER_METADATA } from './provider-metadata';

export const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export type ReasoningEffort = typeof REASONING_EFFORTS[number];
/** null preserves existing CLI configuration; default explicitly uses the model's default. */
export type ReasoningSelection = ReasoningEffort | 'default' | null;
export interface CliModel {
  id: string;
  name: string;
  isDefault: boolean;
  defaultReasoningEffort: ReasoningEffort | null;
  reasoningEfforts: ReasoningEffort[];
}
export interface CliCatalog { models: CliModel[]; version: string; source: 'live' | 'cli'; targetVersion?: string; managedUpdate?: boolean; }
export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return REASONING_EFFORTS.some(effort => effort === value);
}
export function validModelId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(value);
}
/** Sorting presentation must never change the selected provider or setup defaults. */
export function orderedProviders(ready: readonly string[]) {
  return Object.entries(PROVIDER_METADATA).sort(([a], [b]) =>
    Number(Boolean(CLI_PROVIDERS[b]) && ready.includes(b)) - Number(Boolean(CLI_PROVIDERS[a]) && ready.includes(a)));
}

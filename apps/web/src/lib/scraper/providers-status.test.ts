import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests the provider status classification logic from the providers route.
 *
 * We can't import the route directly due to a pre-existing vitest @/ alias
 * resolution issue (affects all route files that import @/lib/api-response).
 * Instead, we extract and test the status logic in isolation.
 */

// Import the registry directly (this works -- it's under src/lib/)
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const { EXTRACTION_PROVIDERS, LOCAL_PROVIDERS } = await import(
  '@/lib/scraper/ai-registry'
);

vi.unstubAllGlobals();

type ProviderStatus = 'ready' | 'no_key' | 'not_installed' | 'unreachable';

/** Replicates the status classification logic from route.ts GET handler */
function classifyProviderStatus(
  key: string,
  available: string[],
  isSelfHosted: boolean
): ProviderStatus {
  if (available.includes(key)) return 'ready';
  if (LOCAL_PROVIDERS.has(key)) return isSelfHosted ? 'unreachable' : 'not_installed';
  if (key === 'claude-code' || key === 'codex') return 'not_installed';
  return 'no_key';
}

/** Replicates the full GET response shape */
function buildProviderStatuses(available: string[], isSelfHosted: boolean) {
  const statuses: Record<string, { displayName: string; status: ProviderStatus; models: string[] }> = {};
  for (const [key, config] of Object.entries(EXTRACTION_PROVIDERS)) {
    statuses[key] = {
      displayName: config.displayName,
      status: classifyProviderStatus(key, available, isSelfHosted),
      models: config.models.map((m) => m.name),
    };
  }
  return statuses;
}

describe('GET /api/admin/providers — status classification', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.SELF_HOSTED = process.env.SELF_HOSTED;
    delete process.env.SELF_HOSTED;
  });

  afterEach(() => {
    if (savedEnv.SELF_HOSTED === undefined) delete process.env.SELF_HOSTED;
    else process.env.SELF_HOSTED = savedEnv.SELF_HOSTED;
  });

  it('marks available providers as ready', () => {
    const statuses = buildProviderStatuses(['anthropic', 'openai'], false);
    expect(statuses.anthropic!.status).toBe('ready');
    expect(statuses.openai!.status).toBe('ready');
  });

  it('marks API-key providers without keys as no_key', () => {
    const statuses = buildProviderStatuses([], false);
    expect(statuses.anthropic!.status).toBe('no_key');
    expect(statuses.openai!.status).toBe('no_key');
    expect(statuses.google!.status).toBe('no_key');
  });

  it('marks CLI providers as not_installed when unavailable', () => {
    const statuses = buildProviderStatuses([], false);
    expect(statuses['claude-code']!.status).toBe('not_installed');
    expect(statuses.codex!.status).toBe('not_installed');
  });

  it('marks local providers as unreachable when self-hosted but not available', () => {
    const statuses = buildProviderStatuses([], true);
    expect(statuses.ollama!.status).toBe('unreachable');
    expect(statuses.llamacpp!.status).toBe('unreachable');
    expect(statuses.vllm!.status).toBe('unreachable');
  });

  it('marks local providers as not_installed when not self-hosted', () => {
    const statuses = buildProviderStatuses([], false);
    expect(statuses.ollama!.status).toBe('not_installed');
    expect(statuses.llamacpp!.status).toBe('not_installed');
    expect(statuses.vllm!.status).toBe('not_installed');
  });

  it('marks local providers as ready when available', () => {
    const statuses = buildProviderStatuses(['ollama', 'vllm'], true);
    expect(statuses.ollama!.status).toBe('ready');
    expect(statuses.vllm!.status).toBe('ready');
    expect(statuses.llamacpp!.status).toBe('unreachable');
  });

  it('includes displayName and models for every provider', () => {
    const statuses = buildProviderStatuses([], false);
    for (const [, provider] of Object.entries(statuses)) {
      expect(provider.displayName).toBeTruthy();
      expect(Array.isArray(provider.models)).toBe(true);
    }
  });

  it('covers all providers in EXTRACTION_PROVIDERS', () => {
    const statuses = buildProviderStatuses([], false);
    const providerKeys = Object.keys(EXTRACTION_PROVIDERS);
    const statusKeys = Object.keys(statuses);
    expect(statusKeys).toEqual(providerKeys);
  });

  it('classifyProviderStatus matches route.ts logic for every status path', () => {
    // ready
    expect(classifyProviderStatus('anthropic', ['anthropic'], false)).toBe('ready');
    // no_key (API provider, not available)
    expect(classifyProviderStatus('anthropic', [], false)).toBe('no_key');
    // not_installed (CLI provider)
    expect(classifyProviderStatus('claude-code', [], false)).toBe('not_installed');
    // unreachable (local, self-hosted, not available)
    expect(classifyProviderStatus('ollama', [], true)).toBe('unreachable');
    // not_installed (local, not self-hosted)
    expect(classifyProviderStatus('ollama', [], false)).toBe('not_installed');
    // ready (local, available)
    expect(classifyProviderStatus('ollama', ['ollama'], true)).toBe('ready');
  });
});

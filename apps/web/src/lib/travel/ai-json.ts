import { prisma } from '../prisma';
import { EXTRACTION_PROVIDERS, LOCAL_PROVIDERS, resolveApiKey, getModelCosts } from '../scraper/ai-registry';
import { extractJsonArray } from '../scraper/extract-prices';
import { acquireProviderToken } from '../scraper/rate-limit';
import { notificationTransaction } from '../notifications/database';
import { notificationBoundary } from '../notifications/channels/transport';

export async function travelJson(system: string, input: string, operation = 'hotel_extract', control?: { signal: AbortSignal }): Promise<unknown> {
  const config = control
    ? await notificationTransaction(tx => tx.extractionConfig.findFirst({ where: { id: 'singleton' } }), control.signal)
    : await prisma.extractionConfig.findFirst({ where: { id: 'singleton' } });
  const provider = config?.provider ?? 'anthropic';
  const backend = EXTRACTION_PROVIDERS[provider];
  if (!backend) throw new Error(`Unknown AI provider: ${provider}`);
  if (control) {
    const signal = AbortSignal.any([control.signal, AbortSignal.timeout(30_000)]);
    await notificationBoundary(acquireProviderToken(provider, signal), signal);
  } else await acquireProviderToken(provider);
  const model = config?.model ?? 'claude-haiku-4-5-20251001';
  const started = Date.now();
  control?.signal.throwIfAborted();
  const result = await backend.extract(resolveApiKey(provider, config), model, `${system}\nIMPORTANT OUTPUT ENVELOPE: wrap the required object as {"result":[OBJECT]}. Exactly one object in result.`, input, {
    baseUrl: config?.customBaseUrl ?? undefined,
    timeoutMs: control ? Math.min(config?.extractTimeoutSeconds ?? 90, 120) * 1000 : (config?.extractTimeoutSeconds ?? 90) * 1000,
    ...(control ? { signal: control.signal } : {}),
    ...(LOCAL_PROVIDERS.has(provider) ? { responseFormat: 'json_object' as const } : {}),
  });
  const costs = getModelCosts(provider, model);
  const data = {
    provider, model, ...result.usage, operation, durationMs: Date.now() - started,
    costUsd: (result.usage.inputTokens * costs.costPer1kInput + result.usage.outputTokens * costs.costPer1kOutput) / 1000,
  };
  if (control) await notificationTransaction(tx => tx.apiUsageLog.create({ data }));
  else await prisma.apiUsageLog.create({ data });
  if (result.content.length > 64_000 && control) throw new Error('AI draft response is too large');
  const json = extractJsonArray(result.content);
  if (!json.ok || json.value.length !== 1 || !json.value[0] || typeof json.value[0] !== 'object') throw new Error('Travel AI response did not contain one JSON result');
  return json.value[0];
}

import { redis } from '../redis';
import { EXTRACTION_PROVIDERS } from './ai-registry';
import { extractJsonArray } from './extract-prices';
import { validateInferenceSelection } from './inference-selection';

export class CliTestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export function cliTestFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : '';
  if (/requires a newer version|upgrade.*(?:codex|cli)/i.test(message)) return 'This model requires a newer CLI. Update it and recheck models.';
  if (/credit balance|insufficient.*(?:credit|quota)|billing/i.test(message)) return 'The provider has insufficient credit. Check the connected account.';
  if (/not logged|not signed|unauthorized|authentication|oauth|401/i.test(message)) return 'CLI authentication failed. Sign in on the host and recheck.';
  if (/model.*(?:unsupported|not supported|not found|not available)/i.test(message)) return 'This model is not available to the connected CLI account.';
  if (/abort|timeout|timed out/i.test(message)) return 'The CLI test timed out or was cancelled.';
  return 'The CLI could not complete the test. Check authentication, model availability and the installed version.';
}
export async function testCliSelection(raw: unknown, parent: AbortSignal) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CliTestError('Invalid test request', 400);
  const body = raw as Record<string, unknown>;
  if (body.provider !== 'codex' && body.provider !== 'claude-code') throw new CliTestError('Choose a supported CLI provider', 400);
  const selection = await validateInferenceSelection(body.provider, body.model, body.reasoningEffort);
  // One bounded test per instance every two minutes, including concurrent server processes.
  if (!redis) throw new CliTestError('CLI tests require Redis for admission control', 503);
  let admitted: string | null;
  try { admitted = await redis.set('cli-selection-test', 'running', 'EX', 120, 'NX'); }
  catch { throw new CliTestError('CLI test admission is unavailable', 503); }
  if (!admitted) throw new CliTestError('A CLI test was recently started. Wait two minutes before another test.', 429);
  const signal = AbortSignal.any([parent, AbortSignal.timeout(45_000)]);
  const started = Date.now();
  try {
    const result = await EXTRACTION_PROVIDERS[selection.provider]!.extract('', selection.model,
      'This is a connection test. Do not use tools, read files, or execute commands.',
      'Return exactly this JSON: {"result":[{"ready":true}]}', { signal, reasoningEffort: selection.reasoningEffort });
    const parsed = extractJsonArray(result.content);
    if (!parsed.ok || parsed.value.length !== 1 || !(parsed.value[0] && typeof parsed.value[0] === 'object' && (parsed.value[0] as Record<string, unknown>).ready === true)) {
      throw new CliTestError('The CLI responded but did not return the required JSON. This selection is not verified.', 502);
    }
    return { ...selection, durationMs: Date.now() - started, verified: true };
  } catch (error) {
    if (error instanceof CliTestError) throw error;
    throw new CliTestError(cliTestFailure(error), 502);
  }
}

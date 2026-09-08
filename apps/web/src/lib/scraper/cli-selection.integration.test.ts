import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { writeFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import type { ExtractionConfig, TravelJob } from '@/generated/prisma/client';

const boundary = vi.hoisted(() => ({ config: {} as Record<string, unknown>, user: null as Record<string, unknown> | null, token: '', spawn: vi.fn(), upsert: vi.fn(), output: '{}' }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  extractionConfig: { findFirst: async () => boundary.config, findUnique: async () => boundary.config, upsert: boundary.upsert },
  user: { findUnique: async () => boundary.user }, apiUsageLog: { create: async () => ({}) },
} }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => boundary.token ? { value: boundary.token } : undefined }) }));
vi.mock('node:child_process', () => ({ spawn: boundary.spawn, execSync: vi.fn() }));
vi.mock('./navigate', async importOriginal => ({
  ...await importOriginal<typeof import('./navigate')>(),
  navigateGoogleFlights: async () => ({ html: 'Delta $623', url: 'https://www.google.com/travel/flights', source: 'google_flights', resultsFound: true }),
}));

beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv('REDIS_URL', ''); vi.stubEnv('SELF_HOSTED', 'true');
  boundary.config = { id: 'singleton', provider: 'codex', model: 'gpt-5.6-luna', reasoningEffort: 'default', multiUserMode: false, adminPasswordHash: 'configured' };
  boundary.token = ''; boundary.user = null;
  boundary.upsert.mockImplementation(async ({ update }) => ({ ...boundary.config, ...update }));
  boundary.spawn.mockImplementation((_binary: string, args: string[]) => {
    const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn() });
    child.kill.mockImplementation(() => { queueMicrotask(() => child.emit('close', null)); return true; });
    if (args[0] === 'exec') {
      child.stdin.on('finish', () => { writeFileSync(args[args.indexOf('-o') + 1]!, boundary.output); child.emit('close', 0); });
    } else if (args[0] === 'app-server') {
      child.stdin.on('data', chunk => {
        const message = JSON.parse(String(chunk)) as { id?: number };
        if (message.id === undefined) return;
        const result = message.id === 0 ? {} : { data: [{ model: 'gpt-5.6-luna', displayName: 'Luna', isDefault: true, defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'medium' }, { reasoningEffort: 'low' }] }], nextCursor: null };
        queueMicrotask(() => child.stdout.write(JSON.stringify({ id: message.id, result }) + '\n'));
      });
    } else queueMicrotask(() => { child.stdout.write('codex-cli 0.153.4'); child.emit('close', 0); });
    return child;
  });
});
afterEach(() => vi.unstubAllEnvs());

function request(body: unknown) {
  return new NextRequest('http://localhost/api/admin/config', { method: 'PATCH', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

it('validates partial effort changes against the saved provider and model', async () => {
  const { PATCH } = await import('../../app/api/admin/config/route');
  const response = await PATCH(request({ reasoningEffort: 'low' }));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ provider: 'codex', model: 'gpt-5.6-luna', reasoningEffort: 'low' });
  expect((await PATCH(request({ reasoningEffort: 'ultra' }))).status).toBe(400);
  expect((await PATCH(request({ model: null }))).status).toBe(400);
});

it('resets inherited effort on provider switches while preserving custom API names', async () => {
  const { PATCH } = await import('../../app/api/admin/config/route');
  const response = await PATCH(request({ provider: 'openai', model: 'org/model@revision' }));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ provider: 'openai', model: 'org/model@revision', reasoningEffort: null });
});

it('allows unrelated settings changes without replacing or rediscovering a stale saved selection', async () => {
  boundary.config.model = 'removed-model';
  boundary.spawn.mockImplementation(() => { throw new Error('CLI unavailable'); });
  const { PATCH } = await import('../../app/api/admin/config/route');
  const response = await PATCH(request({ model: 'removed-model', reasoningEffort: 'default', extractTimeoutSeconds: 120 }));
  expect(response.status).toBe(200);
  expect((await response.json()).data).toMatchObject({ model: 'removed-model', extractTimeoutSeconds: 120 });
});

it('closes setup model discovery and tests after setup completes', async () => {
  const route = await import('../../app/api/setup/cli-models/route');
  expect((await route.GET(new Request('http://localhost/api/setup/cli-models?provider=codex'))).status).toBe(403);
  expect((await route.POST(new Request('http://localhost/api/setup/cli-models', { method: 'POST', body: '{}' }))).status).toBe(403);
});

it('rejects anonymous and non-admin household members on model and update endpoints', async () => {
  boundary.config.multiUserMode = true;
  const route = await import('../../app/api/admin/cli-models/route');
  const updates = await import('../../app/api/admin/cli-models/update/route');
  const get = new Request('http://localhost/api/admin/cli-models?provider=codex');
  expect((await route.GET(get)).status).toBe(401);
  const { createUserSessionToken } = await import('../user-auth');
  boundary.token = createUserSessionToken('member'); boundary.user = { id: 'member', isAdmin: false };
  expect((await route.GET(get)).status).toBe(403);
  expect((await route.POST(new Request(get.url, { method: 'POST', body: '{}' }))).status).toBe(403);
  expect((await updates.GET(get)).status).toBe(403);
  expect((await updates.POST(new Request(get.url, { method: 'POST', body: '{"provider":"codex"}' }))).status).toBe(403);
  boundary.user.isAdmin = true;
  expect((await route.GET(get)).status).toBe(200);
});

it('passes saved model-default thinking through flight parsing into the real CLI adapter', async () => {
  boundary.output = JSON.stringify({ confidence: 'low', parsed: null, ambiguities: [] });
  const { parseFlightQuery } = await import('./parse-query');
  expect((await parseFlightQuery('Where should I fly?')).response.confidence).toBe('low');
  const invocation = boundary.spawn.mock.calls.find(([, args]) => args[0] === 'exec');
  expect(invocation?.[1]).toEqual(expect.arrayContaining(['--model', 'gpt-5.6-luna', '-c', 'model_reasoning_effort="medium"']));
});

it.each(['hotel_extract', 'car_extract'])('passes saved effort to shared %s inference', async operation => {
  boundary.config.reasoningEffort = 'low'; boundary.output = '{"result":[{"ready":true}]}';
  const { travelJson } = await import('../travel/ai-json');
  expect(await travelJson('Return JSON', 'test', operation)).toEqual({ ready: true });
  expect(boundary.spawn.mock.calls.find(([, args]) => args[0] === 'exec')?.[1]).toEqual(expect.arrayContaining(['model_reasoning_effort="low"']));
});

it.each([false, true])('passes thinking through price extraction with override=%s', async override => {
  boundary.output = JSON.stringify([{ travelDate: '2026-11-09', price: 623, currency: 'USD', airline: 'Delta', bookingUrl: 'https://delta.com', stops: 0, duration: '5h 30m' }]);
  const { extractPrices } = await import('./extract-prices');
  const config = override ? { provider: 'codex', model: 'gpt-5.6-luna', reasoningEffort: 'low' as const, customBaseUrl: null, apiKey: '' } : undefined;
  const result = await extractPrices('Delta $623', 'https://www.google.com/travel/flights', '2026-11-09', undefined, undefined, true, 'google_flights', 'USD', config);
  expect(result.prices[0]).toMatchObject({ price: 623, airline: 'Delta' });
  expect(boundary.spawn.mock.calls.find(([, args]) => args[0] === 'exec')?.[1]).toEqual(expect.arrayContaining([`model_reasoning_effort="${override ? 'low' : 'medium'}"`]));
});

it('keeps the admitted preview thinking selection through navigation and extraction', async () => {
  boundary.output = JSON.stringify([{ travelDate: '2026-11-09', price: 623, currency: 'USD', airline: 'Delta', bookingUrl: 'https://delta.com', stops: 0, duration: '5h 30m' }]);
  const { runPreview } = await import('../preview-runner');
  const { withTravelContext } = await import('../travel/context');
  const { TravelVpnSession } = await import('../travel/vpn');
  const lease = { id: 'browser', owner: 'preview-test', generation: 1, topologyVersion: 1 };
  const job = { id: 'preview-test', kind: 'flight_preview', userId: null, status: 'running' } as TravelJob;
  const result = await withTravelContext({ job, lease, config: boundary.config as unknown as ExtractionConfig, vpn: new TravelVpnSession(lease, 'none') }, () => runPreview({
    origins: [{ code: 'JFK', name: 'New York' }], destinations: [{ code: 'LAX', name: 'Los Angeles' }],
    dateFrom: '2026-11-09', dateTo: '2026-11-09', tripType: 'one_way', cabinClass: 'economy', currency: 'USD',
    maxPrice: null, maxStops: null, maxDurationHours: null, preferredAirlines: [], timePreference: 'any',
  }, { concurrency: 1 }));
  expect(result.routes[0]?.flights[0]).toMatchObject({ price: 623, airline: 'Delta' });
  expect(boundary.spawn.mock.calls.find(([, args]) => args[0] === 'exec')?.[1]).toEqual(expect.arrayContaining(['model_reasoning_effort="medium"']));
});

import { createServer, type Server, type ServerResponse } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Browser, Route } from 'playwright';
import { TravelExecution, withTravelExecution } from '../travel/execution';
import { CarSearchCleanupError, CarSearchInterruptedError, searchCars } from './search';
import { validateCarSearch } from './validation';
import { assessCarPrice } from './pricing';
import { prisma } from '@/lib/prisma';
import { acquireTravelLease, claimTravelJob, releaseTravelLease, type TravelLeaseToken } from '../travel/jobs';
import { cancelCarSearch, createCarSearch, createCarTracker, editCarTracker } from './store';
import { executeCarJob } from './run';
import type { CarActor } from './access';

const transport = vi.hoisted(() => ({ origin: '', browsers: [] as Browser[], failClose: false, beforeRequest: null as ((url: URL) => Promise<void>) | null }));
vi.mock('playwright', async importOriginal => {
  const actual = await importOriginal<typeof import('playwright')>();
  return { ...actual, chromium: { ...actual.chromium, launch: async (options: Parameters<typeof actual.chromium.launch>[0]) => {
    const browser = await actual.chromium.launch(options);
    transport.browsers.push(browser);
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async options => {
      const context = await newContext(options);
      const newPage = context.newPage.bind(context);
      context.newPage = async () => {
        const page = await newPage();
        // Redirect only HTTP transport to the local provider server. Browser,
        // navigation guard, capture, extraction and price assessment remain real.
        await page.route('**/*', async route => {
          const url = new URL(route.request().url());
          await transport.beforeRequest?.(url);
          const response = await context.request.get(`${transport.origin}/${url.hostname}${url.pathname}${url.search}`);
          await route.fulfill({ response });
        });
        const register = page.route.bind(page);
        page.route = async (pattern, handler, options) => register(pattern, async (route, request) => {
          const fetch: Route['fetch'] = async options => {
            const url = new URL(request.url());
            await transport.beforeRequest?.(url);
            return context.request.get(`${transport.origin}/${url.hostname}${url.pathname}${url.search}`, { ...options, maxRedirects: 0 });
          };
          route.fetch = fetch;
          await handler(route, request);
        }, options);
        return page;
      };
      return context;
    };
    if (transport.failClose) {
      const close = browser.close.bind(browser);
      browser.close = async () => { await close(); throw new Error('Simulated browser transport cleanup failure'); };
    }
    return browser;
  } } };
});

const location = { name: 'Heathrow', country: 'GB', timeZone: 'Europe/London', providerIds: { autoeurope: '547', discovercars: '1712' } };
const criteria = () => validateCarSearch({ pickup: location, dropoff: location, pickupAt: { date: '2026-10-15', time: '12:00' }, dropoffAt: { date: '2026-10-18', time: '12:00' }, driver: { age: 35, licenceYears: 5, residenceCountry: 'GB' }, currency: 'USD', sources: ['autoeurope'] });
const query = new URLSearchParams({ pickup_location: '547', dropoff_location: '547', pickup_date: '2026-10-15', dropoff_date: '2026-10-18', pickup_time: '12:00', dropoff_time: '12:00', drivers_age: '35', residence_country: 'GB', currency: 'USD' });
const routeUrl = (path: string, reference?: string) => `/en-us/${path}?${reference ? `rate_reference=${reference}&` : ''}${query}`;
const payment = (amount: number) => ({ payment: { amount, currency: 'USD' } });

function checkout(reference: string): string {
  const data = {
    cart: { items: [] },
    rate_rules: {
      search: { ...Object.fromEntries(query), rate_reference: reference }, pickup_branch: { id: 245051, timezone: 'Europe/London' }, dropoff_branch: { id: 245051, timezone: 'Europe/London' },
      vehicle: { id: 123, name: 'Example car', acriss_code: 'MCMR', transmission: 'Manual', seats: 4, supplier: { id: 3827, name: 'Example supplier', pickup_office_id: '245051', dropoff_office_id: '245051' },
        package: { package_name: 'Basic Plus', on_request: false, inclusions: [{ code: 'IN', name: 'Mandatory Taxes & Fees' }], coverages: [{ code: '7', included_in_vehicle_price: true, excessAmount: payment(2000) }], payments: { payNow: { total: payment(49.65) }, payLocal: { total: payment(0) } }, fees: [], fuel_policy: { name: 'Same to same', description: 'Return with pickup fuel level' }, rate_distance: { unlimited: true } } },
      terms: { full: { gateway: { sections: [
        { title: 'General Terms', content: 'Free cancellation is available up to 48 hours before pickup.' },
        { title: 'The Rate Includes', content: 'Mandatory Taxes & Fees' },
        { title: 'Driver Information', content: 'Minimum driver age for the vehicle that you selected is 23. Maximum driver age for the vehicle that you selected is 75. You must have held your Driver’s License for a minimum of 2 full year(s).' },
        { title: 'Payment and Charges', content: 'A physical credit card is required. A security deposit of USD 2,000.00 is required.' },
        { title: 'Vehicle Pick-up and Return', content: 'Bring original documents.' },
        { title: 'Geographical Restrictions', content: 'Cross-border travel requires permission.' },
        { title: 'Policies, Coverage and Taxes', content: 'Collision damage excess USD 2,000.00.' },
        { title: 'Mileage Policy', content: 'Unlimited mileage' },
      ] } } },
    },
  };
  return `<form id="checkoutForm" data-data='${JSON.stringify(data).replaceAll("'", '&#39;')}'></form>
    <button data-cy="toggle_terms_conditions_modal_button">Rental conditions</button><div data-cy="terms_conditions_modal">Conditions</div>
    <p data-cy="total_price">USD $49.65</p><p data-cy="payment_summary_total_due_now">USD $49.65</p><p data-cy="vehicle_name">Example car</p><div>or similar | <span data-cy="vehicle_category">Mini</span></div><span data-cy="vehicle_supplier_logo" data-name="Example supplier">Example supplier</span>`;
}

function homepage(): string {
  return `<button onclick="this.remove()">Reject</button><form>
    <input type="hidden" name="residence_country" value="gb"><input type="hidden" name="currency" value="GBP">
    <button type="button" data-cy="currency_dropdown_toggle" onclick="document.getElementById('currencies').hidden=false">GBP</button>
    <div id="currencies" hidden><button type="button" data-cy="currency_option" data-currency-code="USD" onclick="document.querySelector('[name=currency]').value='USD';this.parentElement.hidden=true">
      <span>US Dollar</span><span>USD</span>
    </button></div>
    <input id="drivers_age_checkbox" type="checkbox"><input id="drivers_age" value="35">
    <input id="pickup_location"><input type="hidden" name="pickup_location" value="547"><input id="dropoff_location"><input type="hidden" name="dropoff_location" value="547">
    <button type="button" aria-label="Pickup date">Choose dates</button><button type="button" aria-label="Thu Oct 15, 2026">15</button><button type="button" aria-label="Sun Oct 18, 2026">18</button>
    <input name="pickup_time_input"><button type="button" data-cy="pickup_time_field_option">12:00</button><input name="dropoff_time_input"><button type="button" data-cy="dropoff_time_field_option">12:00</button>
    <button type="button" onclick="location.href='${routeUrl('results')}'">Find Your Car</button></form>`;
}

describe.skipIf(process.env.TRAVEL_BROWSER_TESTS !== '1')('bounded rental provider execution over real browser and HTTP boundaries', () => {
  let server: Server;
  let mode: 'mixed' | 'success' | 'stall' | 'cancel' = 'success';
  let controller: AbortController;
  let actor: CarActor | null = null;
  let lease: TravelLeaseToken | null = null;
  const pending = new Set<ServerResponse>();
  const requested: string[] = [];
  beforeAll(async () => {
    server = createServer((request, response) => {
      const url = new URL(request.url!, 'http://fixture');
      requested.push(url.pathname + url.search);
      if (mode === 'stall' || mode === 'cancel') {
        pending.add(response); response.once('close', () => pending.delete(response));
        if (mode === 'cancel') controller.abort(new Error('User cancelled the test search'));
        return;
      }
      if (url.pathname.startsWith('/www.discovercars.com')) { response.writeHead(403); response.end('Access denied'); return; }
      const reference = url.searchParams.get('rate_reference');
      if (reference === 'broken') { response.writeHead(404); response.end('Quote no longer found'); return; }
      if (reference === 'blocked') { response.writeHead(429); response.end('Provider rate limit'); return; }
      response.setHeader('content-type', 'text/html; charset=utf-8');
      if (url.pathname.endsWith('/results')) {
        const references = mode === 'mixed' ? ['good', 'broken', 'blocked', 'must-not-visit', 'five', 'six', 'seven', 'eight', 'nine', 'ten'] : ['good'];
        response.end(`<a hidden href="${routeUrl('options', 'hidden-offer')}">Unavailable car</a>` + references.map(ref => `<a href="${routeUrl('options', ref)}">Select car</a>`).join('')); return;
      }
      if (url.pathname.endsWith('/options')) { response.end(`<button data-cy="go_to_checkout_button_basic" onclick="location.href='${routeUrl('checkout', reference!)}'">Basic</button>`); return; }
      response.end(url.pathname.endsWith('/checkout') ? checkout(reference!) : homepage());
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture server');
    transport.origin = `http://127.0.0.1:${address.port}`;
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-06T12:00:00Z'));
    mode = 'success'; controller = new AbortController(); requested.length = 0; transport.browsers.length = 0; transport.failClose = false;
    transport.beforeRequest = null;
  });
  afterEach(async () => {
    vi.useRealTimers();
    for (const response of pending) response.destroy();
    for (const browser of transport.browsers) if (browser.isConnected()) await browser.close();
    if (lease) await releaseTravelLease(lease);
    lease = null;
    if (actor) {
      await prisma.travelJob.deleteMany({ where: { userId: actor.userId } });
      await prisma.user.delete({ where: { id: actor.userId! } });
      actor = null;
    }
  });
  afterAll(async () => { if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } await prisma.$disconnect(); });
  const run = (options: Parameters<typeof searchCars>[1] = {}, sources = criteria().sources) => withTravelExecution(new TravelExecution({ jobId: 'browser-fixture', generation: 1, resource: 'browser' }), () => searchCars({ ...criteria(), sources }, options));

  it('retains a verified quote through a later failure and stops visits after rate limiting', async () => {
    mode = 'mixed';
    const result = await run();
    expect(result.providers).toEqual([{ source: 'autoeurope', status: 'blocked', checked: 3, discoveredVisible: 10, limit: 8, truncated: true }]);
    expect(result.offers, JSON.stringify(result.candidates.map(candidate => candidate.reasons))).toHaveLength(1);
    expect(assessCarPrice(result.offers[0], criteria()).eligible).toBe(true);
    expect(result.errors).toHaveLength(2);
    expect(requested.some(path => path.includes('must-not-visit'))).toBe(false);
    expect(requested.some(path => path.includes('hidden-offer'))).toBe(false);
    expect(transport.browsers.every(browser => !browser.isConnected())).toBe(true);
  }, 30_000);

  it('continues a separately selected provider after a blocked source and reports coherent progress', async () => {
    const completed: number[] = [];
    let sawActiveQuote = false;
    const result = await run({ onProgress: async report => {
      completed.push(report.completed);
      if (report.providers.some(provider => provider.status === 'running' && provider.checked === 1) && report.offers.length === 1) sawActiveQuote = true;
      report.offers.length = 0;
    } }, ['discovercars', 'autoeurope']);
    expect(completed.at(-1)).toBe(2);
    expect(completed.every((value, index) => value >= (completed[index - 1] ?? 0) && value <= 2)).toBe(true);
    expect(sawActiveQuote).toBe(true);
    expect(result).toMatchObject({ completed: 2, total: 2, successfulProviders: 1 });
    expect(result.offers, JSON.stringify(result.candidates.map(candidate => candidate.reasons))).toHaveLength(1);
    expect(result.providers.map(provider => provider.status)).toEqual(['blocked', 'complete']);
  }, 30_000);

  it('closes the active browser at the provider deadline rather than leaving work running', async () => {
    mode = 'stall';
    const result = await run({ providerTimeoutMs: 1000 });
    expect(result.providers[0]).toMatchObject({ status: 'timed_out', checked: 0 });
    expect(result.errors[0]?.message).toMatch(/deadline/);
    expect(transport.browsers.every(browser => !browser.isConnected())).toBe(true);
  }, 15_000);

  it('cancels an active provider without starting the next source', async () => {
    mode = 'cancel';
    await expect(run({ signal: controller.signal }, ['autoeurope', 'discovercars'])).rejects.toMatchObject({ name: CarSearchInterruptedError.name, report: { completed: 1, providers: [{ source: 'autoeurope', status: 'cancelled' }] } });
    expect(requested.some(path => path.startsWith('/www.discovercars.com'))).toBe(false);
    expect(transport.browsers.every(browser => !browser.isConnected())).toBe(true);
  }, 15_000);

  it('propagates cleanup failure together with completed observations', async () => {
    transport.failClose = true;
    await expect(run()).rejects.toMatchObject({ name: CarSearchCleanupError.name, report: { offers: [expect.objectContaining({ supplier: 'Example supplier' })] } });
    expect(transport.browsers.every(browser => !browser.isConnected())).toBe(true);
  }, 30_000);

  it('links parent cancellation during detail progress and retains the completed observation', async () => {
    mode = 'mixed';
    const parent = new TravelExecution({ jobId: 'cancelled-parent', generation: 2, resource: 'browser' });
    const reason = new AggregateError([new Error('Lease replaced')], 'Coordinator cancelled the job');
    await expect(withTravelExecution(parent, () => searchCars(criteria(), { onProgress: async report => {
      if (report.offers.length === 1) parent.abort(reason);
    } }))).rejects.toMatchObject({ name: CarSearchInterruptedError.name, report: { offers: [expect.objectContaining({ supplier: 'Example supplier' })], providers: [expect.objectContaining({ status: 'cancelled', checked: 1 })] } });
    expect(requested.some(path => path.includes('rate_reference=broken'))).toBe(false);
    expect(transport.browsers.every(browser => !browser.isConnected())).toBe(true);
  }, 30_000);

  it('awaits pending progress cancellation before returning and never starts another provider', async () => {
    let observerSettled = false;
    const parent = new TravelExecution({ jobId: 'pending-progress', generation: 3, resource: 'browser' });
    await expect(withTravelExecution(parent, () => searchCars({ ...criteria(), sources: ['autoeurope', 'discovercars'] }, {
      onProgress: async (report, signal) => {
        expect(report.completed).toBe(0);
        await new Promise<void>(resolve => {
          signal.addEventListener('abort', () => { observerSettled = true; resolve(); }, { once: true });
          parent.abort(new Error('User cancelled while saving progress'));
        });
      },
    }))).rejects.toMatchObject({ name: CarSearchInterruptedError.name });
    expect(observerSettled).toBe(true);
    expect(requested.some(path => path.startsWith('/www.discovercars.com'))).toBe(false);
    expect(transport.browsers.every(browser => !browser.isConnected())).toBe(true);
  }, 30_000);

  it('bounds final progress persistence after browser cleanup and awaits its cancellation', async () => {
    let observerSettled = false;
    await expect(run({ onProgress: async (report, signal) => {
      if (report.completed === 0) return;
      await new Promise<void>(resolve => signal.addEventListener('abort', () => { observerSettled = true; resolve(); }, { once: true }));
    } })).rejects.toMatchObject({ cause: expect.objectContaining({ message: expect.stringMatching(/progress deadline/) }) });
    expect(observerSettled).toBe(true);
    expect(transport.browsers.every(browser => !browser.isConnected())).toBe(true);
  }, 30_000);

  async function queued() {
    const url = new URL(process.env.DATABASE_URL ?? 'http://invalid');
    if (url.hostname !== '127.0.0.1' || url.port !== '55440' || url.pathname !== '/car_test') throw new Error('Car execution tests require disposable localhost:55440/car_test');
    actor = { userId: (await prisma.user.create({ data: { username: `car-browser-${crypto.randomUUID()}` } })).id, isAdmin: false };
    lease = await acquireTravelLease('browser');
    if (!lease) throw new Error('Expected isolated browser lease');
    return createCarSearch(criteria(), actor);
  }
  async function execute(runId: string) {
    const job = await prisma.travelJob.findUniqueOrThrow({ where: { carRunId: runId } });
    await claimTravelJob(job.id, lease!);
    const execution = new TravelExecution({ jobId: job.id, generation: lease!.generation, resource: lease!.id });
    return { execution, work: () => withTravelExecution(execution, () => executeCarJob(job.id, lease!)) };
  }
  const databaseTest = it.skipIf(process.env.CAR_RUN_INTEGRATION_TESTS !== '1');

  databaseTest('executes an owned search and refresh through real browser extraction and atomic price alerts', async () => {
    const first = await queued(); await (await execute(first.id)).work();
    const found = await prisma.carSearchRun.findUniqueOrThrow({ where: { id: first.id } });
    expect(found).toMatchObject({ status: 'success', result: { offers: [expect.objectContaining({ supplier: 'Example supplier' })] } });
    const result = found.result as unknown as Awaited<ReturnType<typeof searchCars>>;
    const tracker = await createCarTracker({ searchId: first.id, offerId: result.offers[0]!.id, target: { currency: 'USD', minor: 5000 } }, actor!);
    const refresh = await prisma.carSearchRun.findFirstOrThrow({ where: { trackerId: tracker.id } });
    await (await execute(refresh.id)).work();
    expect(await prisma.carTracker.findUnique({ where: { id: tracker.id } })).toMatchObject({ latestPriceMinor: 4965n, historicalLowMinor: 4965n, targetArmed: false, lastError: null });
    expect(await prisma.carSnapshot.findMany({ where: { trackerId: tracker.id } })).toMatchObject([{ eligible: true, totalMinor: 4965n }]);
    expect(await prisma.travelAlertDelivery.findMany({ where: { carTrackerId: tracker.id } })).toMatchObject([{ message: { data: { userId: actor!.userId, target: true } } }]);
    expect(transport.browsers.every(browser => !browser.isConnected())).toBe(true);
  }, 45_000);

  databaseTest('persists partial provider behavior and the verified sibling quote end to end', async () => {
    const first = await queued(); mode = 'mixed'; await (await execute(first.id)).work();
    expect(await prisma.carSearchRun.findUnique({ where: { id: first.id } })).toMatchObject({ status: 'partial', result: { offers: [expect.objectContaining({ supplier: 'Example supplier' })], providers: [expect.objectContaining({ status: 'blocked', checked: 3 })] } });
    expect(requested.some(path => path.includes('must-not-visit'))).toBe(false);
  }, 30_000);

  databaseTest('rejects mismatched execution authority before changing a queued run or contacting providers', async () => {
    const first = await queued(), job = await prisma.travelJob.findUniqueOrThrow({ where: { carRunId: first.id } });
    const wrong = new TravelExecution({ jobId: 'different-job', generation: lease!.generation, resource: lease!.id });
    await expect(withTravelExecution(wrong, () => executeCarJob(job.id, lease!))).rejects.toThrow(/matching shared execution/);
    expect((await prisma.carSearchRun.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('queued');
    expect(requested).toEqual([]);
  });

  databaseTest('preserves authoritative cancellation and closes the active browser before returning', async () => {
    const first = await queued(), active = await execute(first.id);
    transport.beforeRequest = async () => {
      transport.beforeRequest = null;
      await cancelCarSearch(first.id, actor!);
      active.execution.abort(new Error('User cancelled the shared job'));
    };
    await expect(active.work()).rejects.toMatchObject({ name: CarSearchInterruptedError.name });
    expect((await prisma.carSearchRun.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('cancelled');
    expect(transport.browsers.every(browser => !browser.isConnected())).toBe(true);
  }, 30_000);

  databaseTest('rejects a late quote after tracker settings change during detail retrieval', async () => {
    const first = await queued(); await (await execute(first.id)).work();
    const found = await prisma.carSearchRun.findUniqueOrThrow({ where: { id: first.id } });
    const result = found.result as unknown as Awaited<ReturnType<typeof searchCars>>;
    const tracker = await createCarTracker({ searchId: first.id, offerId: result.offers[0]!.id }, actor!);
    const refresh = await prisma.carSearchRun.findFirstOrThrow({ where: { trackerId: tracker.id } });
    transport.beforeRequest = async url => {
      if (!url.pathname.endsWith('/checkout')) return;
      transport.beforeRequest = null;
      await editCarTracker(tracker.id, { active: false }, actor!);
    };
    await expect((await execute(refresh.id)).work()).rejects.toThrow();
    expect(await prisma.carTracker.findUnique({ where: { id: tracker.id } })).toMatchObject({ active: false, latestPriceMinor: null });
    expect((await prisma.carSearchRun.findUniqueOrThrow({ where: { id: refresh.id } })).status).toBe('cancelled');
    expect(await prisma.carSnapshot.count({ where: { trackerId: tracker.id } })).toBe(0);
    expect(await prisma.travelAlertDelivery.count({ where: { carTrackerId: tracker.id } })).toBe(0);
  }, 45_000);

  databaseTest('propagates cleanup failure without converting uncertain resource safety into success', async () => {
    const first = await queued(); transport.failClose = true;
    await expect((await execute(first.id)).work()).rejects.toMatchObject({ name: CarSearchCleanupError.name });
    expect((await prisma.carSearchRun.findUniqueOrThrow({ where: { id: first.id } })).status).toBe('running');
    expect(await prisma.travelJob.findUnique({ where: { carRunId: first.id } })).toMatchObject({ status: 'running' });
  }, 30_000);

  databaseTest.each([false, true])('preserves prior prices and both errors when failure persistence also fails: %s', async failFailure => {
    const first = await queued(); await (await execute(first.id)).work();
    const found = await prisma.carSearchRun.findUniqueOrThrow({ where: { id: first.id } });
    const result = found.result as unknown as Awaited<ReturnType<typeof searchCars>>;
    const tracker = await createCarTracker({ searchId: first.id, offerId: result.offers[0]!.id }, actor!);
    await prisma.carTracker.update({ where: { id: tracker.id }, data: { latestPriceMinor: 4000, historicalLowMinor: 3500, targetArmed: false } });
    const refresh = await prisma.carSearchRun.findFirstOrThrow({ where: { trackerId: tracker.id } });
    await prisma.$executeRawUnsafe('CREATE FUNCTION car_execution_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION \'Simulated storage boundary failure\'; END $$');
    try {
      const condition = failFailure ? "NEW.result IS NOT NULL OR NEW.status = 'failed'" : 'NEW.result IS NOT NULL';
      await prisma.$executeRawUnsafe(`CREATE TRIGGER car_execution_test_fail AFTER UPDATE ON "CarSearchRun" FOR EACH ROW WHEN (${condition}) EXECUTE FUNCTION car_execution_test_fail()`);
      const active = await execute(refresh.id);
      await expect(active.work()).rejects.toMatchObject(failFailure
        ? { name: 'AggregateError', errors: [expect.objectContaining({ cause: expect.any(Error) }), expect.any(Error)] }
        : { cause: expect.objectContaining({ message: expect.stringMatching(/Simulated storage boundary failure/) }) });
      expect(await prisma.carTracker.findUnique({ where: { id: tracker.id } })).toMatchObject({ latestPriceMinor: 4000n, historicalLowMinor: 3500n, targetArmed: false });
      const saved = await prisma.carSearchRun.findUniqueOrThrow({ where: { id: refresh.id } });
      expect(saved.status).toBe(failFailure ? 'running' : 'failed');
      if (failFailure) expect(saved.error).toBeNull();
      else expect(saved.error).toMatch(/previous verified prices were retained/);
      expect(await prisma.carSnapshot.count({ where: { trackerId: tracker.id } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS car_execution_test_fail ON "CarSearchRun"');
      await prisma.$executeRawUnsafe('DROP FUNCTION car_execution_test_fail()');
    }
  }, 45_000);
});

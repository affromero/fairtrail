import { Command } from 'commander';
import { dirname } from 'node:path';
import { CarClient } from './car-client.js';
import { carReceiptDirectory, readCarInput } from './car-cli-input.js';
import { CarMutationError, performCarMutation, replayCarMutation, waitForCarSearch } from './car-operations.js';
import type { CarOperation } from './car-receipts.js';
import { carInteger, carRecord, carText } from '../../../../apps/web/src/lib/cars/validation.js';
import { parseCarMoney } from '../../../../apps/web/src/lib/cars/money.js';
import { validateCarDetailView } from '../../../../apps/web/src/lib/cars/detail-view.js';
import { validateCarRunView } from '../../../../apps/web/src/lib/cars/run-view.js';
import { validateCarParseDraft } from '../../../../apps/web/src/lib/cars/parse-draft.js';
import { validateCarLocationChoice } from '../../../../apps/web/src/lib/cars/location-types.js';
import { readCarPreferences, readCarSearchPage, readCarTrackerPage } from './car-views.js';
import { validateCarProviders } from '../../../../apps/web/src/lib/cars/preferences.js';
import { readCarOfferReview, requireCarReview } from './car-protection.js';
import { carProtectionInput } from '../../../../apps/web/src/lib/cars/creation-input.js';

interface Options {
  server?: string; json?: boolean; receiptDir?: string; file?: string; wait?: boolean; timeout?: string;
  revision?: string; target?: string; currency?: string; clearTarget?: boolean; lows?: boolean; interval?: string;
  mode?: string; label?: string; cursor?: string; admin?: boolean; locale?: string;
  providers?: string; reset?: boolean;
  review?: string; reviewProtection?: string;
}
interface Context { client: CarClient; options: Options; args: string[]; signal: AbortSignal; mutate: (intent: CarOperation, expectedScope?: string) => Promise<Awaited<ReturnType<typeof performCarMutation>>> }
function identity(raw: string | undefined): string {
  if (!raw || !/^[A-Za-z0-9_-]{1,200}$/.test(raw)) throw new Error('Choose a valid rental identity');
  return raw;
}
function integer(raw: string | undefined, min: number, max: number, label: string) {
  if (raw === undefined || !/^\d+$/.test(raw)) throw new Error(`${label} requires an integer from ${min} to ${max}`);
  return carInteger(Number(raw), min, max, label);
}
function target(options: Options) {
  if (options.clearTarget && options.target !== undefined) throw new Error('Choose --target or --clear-target');
  if (options.currency && options.target === undefined) throw new Error('--currency requires --target');
  if (options.clearTarget) return null;
  if (options.target === undefined) return undefined;
  if (!options.currency) throw new Error('--target requires --currency, for example GBP');
  return parseCarMoney(options.target, options.currency.toUpperCase());
}
function message(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).replace(/\p{Cc}/gu, ' ');
}
export function registerCarCommands(program: Command): () => boolean {
  let handled = false;
  const cars = program.command('cars').description('Search and track rental cars on your self-hosted server')
    .option('--server <origin>', 'Server origin (or FLIGHT_FINDER_URL)')
    .option('--receipt-dir <path>', 'Private persistent receipt directory (or FLIGHT_FINDER_CAR_RECEIPTS)')
    .option('--json', 'Print machine-readable JSON');
  const action = (command: Command, run: (context: Context) => Promise<unknown>) => command.action(async (...args: unknown[]) => {
    handled = true;
    const options = (args.at(-1) as Command).optsWithGlobals<Options>(), controller = new AbortController();
    const interrupt = () => controller.abort(new Error('Interrupted; server mutation outcome may need recovery'));
    process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
    try {
      const client = new CarClient(options.server ?? process.env.FLIGHT_FINDER_URL ?? `http://localhost:${process.env.HOST_PORT ?? process.env.PORT ?? '3003'}`, process.env.FLIGHT_FINDER_SESSION, process.env.FLIGHT_FINDER_TOKEN);
      const mutate = async (intent: CarOperation, expectedScope?: string) => performCarMutation(await carReceiptDirectory(options.receiptDir), client, intent, path => {
        console.error(options.json ? JSON.stringify({ receiptPath: path, state: 'prepared' }) : `Recovery receipt: ${path}`);
      }, controller.signal, expectedScope);
      const result = await run({ client, options, args: args.filter((arg): arg is string => typeof arg === 'string'), signal: controller.signal, mutate });
      if (result !== undefined) console.log(JSON.stringify(result, null, options.json ? undefined : 2));
    } catch (error) {
      const detail = error instanceof CarMutationError ? { receiptPath: error.receiptPath, outcome: error.outcome, status: error.status, current: error.current } : {};
      console.error(options.json ? JSON.stringify({ error: message(error), ...detail }) : `Error: ${message(error)}${error instanceof CarMutationError ? ` Receipt: ${error.receiptPath}${error.current ? `\n${JSON.stringify(error.current, null, 2)}` : ''}` : ''}`);
      process.exitCode = controller.signal.aborted ? 130 : 1;
    } finally { process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt); }
  });
  action(cars.command('preferences').description('Read or change your ordered rental providers; reset inherits both defaults')
    .option('--providers <list>', 'Comma-separated provider IDs in preferred order').option('--reset', 'Restore inherited provider defaults')
    .option('--revision <revision>', 'Expected preference revision from cars preferences'), async ({ client, options, signal, mutate }) => {
    if (options.reset && options.providers !== undefined) throw new Error('Choose --providers or --reset');
    const changing = options.reset || options.providers !== undefined;
    if (!changing && options.revision !== undefined) throw new Error('--revision requires --providers or --reset');
    const revision = changing ? integer(options.revision, 0, 2147483646, '--revision') : null;
    const providers = changing ? validateCarProviders(options.reset ? [] : options.providers!.split(',').map(value => value.trim()), true) : null;
    const current = await readCarPreferences(client, signal);
    if (!changing) return current;
    if (!current.savingAllowed || current.userId === null) throw new Error('Saved car preferences require a personal account; single-user searches use both providers or explicit search sources');
    return mutate({ kind: 'preferences', id: current.userId, revision, body: { providers } }, current.scope);
  });
  action(cars.command('browse').description('Browse rental trackers and verified price history').option('--admin', 'Administrator list of all owners'), async ({ client, options, signal }) => {
    if (options.json || !process.stdin.isTTY || !process.stdout.isTTY) throw new Error('cars browse requires an interactive terminal without --json; use cars list or cars view');
    const [{ render }, { createElement }, { CarBrowser }, { CarBrowser: Browser }] = await Promise.all([
      import('ink'), import('react'), import('../screens/CarBrowser.js'), import('./car-browser.js'),
    ]);
    const browser = new Browser(client, options.admin, options.receiptDir);
    const instance = render(createElement(CarBrowser, { browser, signal }), { alternateScreen: true, exitOnCtrlC: false });
    try { await instance.waitUntilExit(); }
    finally {
      browser.close(); await browser.settle(); instance.cleanup();
      for (const path of browser.getReceiptPaths()) console.error(`Recovery receipt retained: ${message(path)}`);
    }
  });
  action(cars.command('locations <query>').description('Find catalog IDs and versions for pickup or return'), async ({ client, args: [query], signal }) => {
    const raw = await client.request<unknown>(`/api/cars/locations?q=${encodeURIComponent(carText(query, 100, 'location query'))}`, { signal });
    if (!Array.isArray(raw) || raw.length > 12) throw new Error('Invalid location suggestions');
    return raw.map(validateCarLocationChoice);
  });
  action(cars.command('parse <text>').description('Suggest an editable draft; does not start a search or select locations').option('--locale <locale>', 'Draft language', 'en'), async ({ client, args: [text], options, signal }) => {
    const raw = carRecord(await client.request('/api/cars/parse', { method: 'POST', body: { text, locale: options.locale }, timeoutMs: 280_000, signal }));
    return { draft: validateCarParseDraft(carRecord(raw.draft)), reviewRequired: true };
  });
  action(cars.command('search').description('Start a reviewed structured rental search; use retry after a lost acknowledgement')
    .requiredOption('--file <path>', 'Search JSON file, or - for stdin').option('--wait', 'Poll until complete; interrupting leaves server work running')
    .option('--timeout <minutes>', 'Wait limit from 1 to 120 minutes', '120'), async ({ client, options, signal, mutate }) => {
    const timeoutMs = integer(options.timeout, 1, 120, '--timeout') * 60_000;
    const body = carRecord(await readCarInput(options.file!, signal));
    const preferences = body.sources === undefined ? await readCarPreferences(client, signal) : null;
    if (preferences) body.sources = preferences.effectiveProviders;
    const result = await mutate({ kind: 'search', id: null, revision: null, body }, preferences?.scope);
    if (!options.wait) return result;
    const id = identity(carRecord(result.result).id as string);
    console.error(options.json ? JSON.stringify(result) : `Search ${id} accepted. Receipt: ${result.receiptPath}`);
    const run = await waitForCarSearch(client, id, { signal, timeoutMs });
    if (run.status === 'failed' || run.status === 'cancelled') process.exitCode = 1;
    return { receiptPath: result.receiptPath, result: run };
  });
  action(cars.command('retry <receipt>').description('Replay the exact saved request against its original server and account'), async ({ client, args: [path], signal, options }) => {
    await carReceiptDirectory(dirname(path!));
    console.error(options.json ? JSON.stringify({ receiptPath: path, state: 'retrying' }) : `Recovery receipt: ${path}`);
    return replayCarMutation(path!, client, signal);
  });
  action(cars.command('results <searchId>').description('Read checked offers, unverified candidates, and provider errors'), async ({ client, args: [raw], signal }) => {
    const id = identity(raw);
    return validateCarRunView(await client.request(`/api/cars/search/${id}`, { signal }), id);
  });
  action(cars.command('protection <searchId> <offerId>').description('Read protection terms, observed prices and identities for explicit review'), ({ client, args: [searchId, offerId], signal }) =>
    readCarOfferReview(client, identity(searchId), carText(offerId, 200, 'offer identity'), signal));
  action(cars.command('protect <searchId> <offerId> <choiceId>').description('Recheck a reviewed protection option; does not book or purchase coverage')
    .requiredOption('--review <hash>', 'Exact choice review identity from cars protection')
    .option('--wait', 'Wait for the fresh result without cancelling server work on interruption')
    .option('--timeout <minutes>', 'Wait limit from 1 to 120 minutes', '120'), async ({ client, args: [searchId, offerId, choiceId], options, signal, mutate }) => {
    const id = identity(searchId), body = carProtectionInput({ offerId, choiceId });
    const timeoutMs = integer(options.timeout, 1, 120, '--timeout') * 60_000;
    const review = await readCarOfferReview(client, id, body.offerId, signal);
    requireCarReview(review.discovery?.choices.find(choice => choice.id === body.choiceId)?.review, options.review);
    const result = await mutate({ kind: 'protect', id, revision: null, body }, review.scope);
    if (!options.wait) return result;
    const child = identity(carRecord(result.result).id as string);
    console.error(options.json ? JSON.stringify(result) : `Protected search ${child} accepted. Receipt: ${result.receiptPath}`);
    const run = await waitForCarSearch(client, child, { signal, timeoutMs });
    if (run.status === 'failed' || run.status === 'cancelled') process.exitCode = 1;
    return { receiptPath: result.receiptPath, result: run };
  });
  action(cars.command('cancel <searchId>').description('Explicitly cancel a server search'), ({ args: [id], mutate }) => mutate({ kind: 'cancel', id: identity(id), revision: null, body: null }));
  action(cars.command('searches').description('Read a page of your standalone searches').option('--cursor <cursor>'), ({ client, options, signal }) => readCarSearchPage(client, options.cursor ?? null, signal));
  action(cars.command('list').description('Read a page of car trackers').option('--cursor <cursor>').option('--admin', 'Administrator list of all owners'), ({ client, options, signal }) => readCarTrackerPage(client, options.cursor ?? null, options.admin, signal));
  for (const name of ['view', 'history'] as const) action(cars.command(`${name} <id>`).description('Read tracker revision, price evidence, errors, and notification readiness'), async ({ client, args: [raw], signal }) => {
    const id = identity(raw); return validateCarDetailView(await client.request(`/api/cars/${id}`, { signal }), id);
  });
  action(cars.command('track <searchId> <offerId>').description('Track a checked offer with durable creation recovery')
    .option('--mode <mode>', 'best or contract', 'best').option('--target <amount>', 'Whole-rental decimal amount').option('--currency <code>')
    .option('--no-lows', 'Disable historical-low alerts').option('--interval <hours>', 'Check interval from 1 to 24 hours', '3').option('--label <label>')
    .option('--review-protection <hash>', 'Exact fresh protected offer review identity from cars protection'),
  async ({ client, args: [searchId, offerId], options, signal, mutate }) => {
    const body = {
    searchId: identity(searchId), offerId: carText(offerId, 200, 'offer identity'), mode: options.mode,
    target: target(options) ?? null, notifyLows: options.lows !== false, scrapeInterval: integer(options.interval, 1, 24, '--interval'), ...(options.label === undefined ? {} : { label: options.label }),
    };
    const review = await readCarOfferReview(client, body.searchId, body.offerId, signal);
    if (!review.canTrack) throw new Error('This rental is not currently eligible for tracking; inspect cars protection or start a fresh search');
    if (review.protectedQuote) requireCarReview(review.trackingReview, options.reviewProtection);
    else if (options.reviewProtection !== undefined) throw new Error('This is a base rental; no protected offer review applies');
    return mutate({ kind: 'track', id: null, revision: null, body }, review.scope);
  });
  for (const name of ['pause', 'resume', 'delete', 'refresh'] as const) action(cars.command(`${name} <id>`)
    .description('Use the revision shown by cars view; use retry for a lost acknowledgement').requiredOption('--revision <revision>', 'Expected tracker revision'),
  ({ args: [id], options, mutate }) => mutate({ kind: name === 'pause' || name === 'resume' ? 'edit' : name, id: identity(id), revision: integer(options.revision, 0, 2147483647, '--revision'), body: name === 'pause' || name === 'resume' ? { active: name === 'resume' } : null }));
  action(cars.command('alerts <id>').description('Change only explicitly selected alert settings').requiredOption('--revision <revision>')
    .option('--target <amount>').option('--currency <code>').option('--clear-target').option('--lows').option('--no-lows').option('--interval <hours>'),
  ({ args: [id], options, mutate }) => {
    const amount = target(options), body = { ...(amount === undefined ? {} : { target: amount }), ...(options.lows === undefined ? {} : { notifyLows: options.lows }), ...(options.interval === undefined ? {} : { scrapeInterval: integer(options.interval, 1, 24, '--interval') }) };
    return mutate({ kind: 'edit', id: identity(id), revision: integer(options.revision, 0, 2147483647, '--revision'), body });
  });
  action(cars.command('rename <id> <label>').requiredOption('--revision <revision>'), ({ args: [id, label], options, mutate }) => mutate({ kind: 'edit', id: identity(id), revision: integer(options.revision, 0, 2147483647, '--revision'), body: { label } }));
  action(cars.command('reassign <id> <userId>').description('Administrator-only ownership transfer').requiredOption('--revision <revision>'), ({ args: [id, userId], options, mutate }) => mutate({ kind: 'edit', id: identity(id), revision: integer(options.revision, 0, 2147483647, '--revision'), body: { userId: identity(userId) } }));
  cars.action(() => { handled = true; cars.outputHelp(); });
  return () => handled;
}

import type { Page } from 'playwright';
import { launchBrowser } from '../scraper/browser';
import { currentTravelExecution, TravelCleanupError, TravelExecution, withTravelExecution } from '../travel/execution';
import { navigateAutoEuropeSearch } from './autoeurope-navigation';
import { captureAutoEuropeDetail } from './autoeurope-capture';
import { extractAutoEuropeOffer } from './autoeurope-extraction';
import { navigateDiscoverCarsSearch } from './discovercars-navigation';
import { captureDiscoverCarsDetail } from './discovercars-capture';
import { extractDiscoverCarsOffer } from './discovercars-extraction';
import { prepareCarPage } from './navigation';
import { carTrackerSearch, validateCarSelection } from './selection';
import { validateCarSearch } from './validation';
import { resolveCarProviderLocations } from './location-resolution';
import { CarError, type CarContractSelection, type CarProviderProgress, type CarSearch, type CarSearchReport, type CarSource } from './types';

export class CarSearchCleanupError extends Error {
  constructor(readonly report: CarSearchReport, cause: unknown) {
    super('Rental browser cleanup failed; the execution resource must not be reused', { cause });
    this.name = 'CarSearchCleanupError';
  }
}

export class CarSearchInterruptedError extends Error {
  constructor(readonly report: CarSearchReport, cause: unknown) {
    super('Rental search was cancelled', { cause });
    this.name = 'CarSearchInterruptedError';
  }
}

export interface CarSearchOptions {
  selection?: CarContractSelection;
  signal?: AbortSignal;
  /** Internal execution budget; never accepted directly from an HTTP request. */
  providerTimeoutMs?: number;
  /** Must settle on abort. Persistence must also use bounded queries and job fencing. */
  onProgress?: (report: CarSearchReport, signal: AbortSignal) => Promise<void>;
  /** Private operator diagnostics; never included in the public result payload. */
  onDiagnostic?: (source: CarSource, error: unknown) => void;
  onLocationResolution?: (search: CarSearch, source: CarSource) => Promise<void>;
}

class CarSearchObserverError extends Error {
  constructor(cause: unknown) { super('Rental progress or diagnostic observer failed', { cause }); }
}

async function publishProgress(report: CarSearchReport, observer: CarSearchOptions['onProgress'], signals: AbortSignal[]): Promise<void> {
  if (!observer) return;
  const controller = new AbortController();
  const signal = AbortSignal.any([...signals, controller.signal]);
  const timer = setTimeout(() => controller.abort(new Error('Rental progress deadline exceeded')), 5000);
  try {
    signal.throwIfAborted();
    // Await cancellation acknowledgement: racing would leave persistence running.
    await observer(structuredClone(report), signal);
    signal.throwIfAborted();
  } catch (error) { throw new CarSearchObserverError(error); }
  finally { clearTimeout(timer); }
}

function publishDiagnostic(source: CarSource, error: unknown, observer: CarSearchOptions['onDiagnostic']): void {
  try { observer?.(source, error); }
  catch (error) { throw new CarSearchObserverError(error); }
}

async function providerFailure(error: unknown, page: Page | undefined, source: CarSource): Promise<{ message: string; terminal: boolean; blocked: boolean }> {
  const status = page && !page.isClosed() ? (await prepareCarPage(page, source)).status() : 0;
  const text = page && !page.isClosed() ? await page.locator('body').innerText({ timeout: 1000 }).catch(() => '') : '';
  const blocked = status === 403 || status === 429 || /verify (?:that )?you are human|unusual traffic|complete the captcha|access denied/i.test(text);
  if (blocked) return { message: 'Provider blocked automated access or rate-limited this search; no further offers were requested', terminal: true, blocked: true };
  if (status >= 500) return { message: `Provider returned HTTP ${status}; this check could not finish`, terminal: true, blocked: false };
  return { message: error instanceof CarError ? error.message : 'The provider quote could not be verified; no estimated price was substituted', terminal: false, blocked: false };
}

async function inspectProvider(source: CarSource, search: CarSearch, report: CarSearchReport, execution: TravelExecution, progress: CarProviderProgress, options: CarSearchOptions): Promise<void> {
  let activePage: Page | undefined;
  try {
    const browser = await launchBrowser();
    const context = await browser.newContext({ locale: 'en-US', timezoneId: search.pickup.timeZone, viewport: { width: 1440, height: 1000 } });
    const searchPage = await context.newPage();
    activePage = searchPage;
    const resolved = await resolveCarProviderLocations(searchPage, search, source);
    const singleSource = validateCarSearch({ ...resolved, sources: [source], extras: { ...resolved.extras, protection: resolved.extras.protection.filter(product => product.source === source) } });
    if (options.onLocationResolution) {
      try { await options.onLocationResolution(resolved, source); }
      catch (error) { throw new CarSearchObserverError(error); }
    }
    Object.assign(search, { pickup: resolved.pickup, dropoff: resolved.dropoff });
    search = singleSource;
    const discovery = source === 'discovercars' ? await navigateDiscoverCarsSearch(searchPage, search) : await navigateAutoEuropeSearch(searchPage, search);
    Object.assign(progress, { discoveredVisible: discovery.discoveredVisible, limit: discovery.limit, truncated: discovery.truncated });
    await publishProgress(report, options.onProgress, [execution.signal]);
    const detail = await context.newPage();
    activePage = detail;
    let status: CarProviderProgress['status'] = 'complete';
    for (const url of discovery.links) {
      execution.check();
      progress.checked++;
      try {
        const observation = source === 'discovercars'
          ? extractDiscoverCarsOffer(await captureDiscoverCarsDetail(detail, url, search, searchPage), search)
          : extractAutoEuropeOffer(await captureAutoEuropeDetail(detail, url, search), search);
        if ('contract' in observation) report.offers.push(observation);
        else report.candidates.push(observation);
      } catch (error) {
        execution.check();
        if (error instanceof CarSearchObserverError) throw error;
        publishDiagnostic(source, error, options.onDiagnostic);
        const failure = await providerFailure(error, detail, source);
        report.errors.push({ source, message: failure.message });
        status = failure.blocked ? 'blocked' : 'partial';
        if (failure.terminal) break;
      }
      await publishProgress(report, options.onProgress, [execution.signal]);
    }
    progress.status = status;
  } catch (error) {
    execution.check();
    if (error instanceof CarSearchObserverError) throw error;
    publishDiagnostic(source, error, options.onDiagnostic);
    const failure = await providerFailure(error, activePage, source);
    report.errors.push({ source, message: failure.message });
    progress.status = failure.blocked ? 'blocked' : 'failed';
  }
}

function summarizeReport(report: CarSearchReport): void {
  report.completed = report.providers.length;
  report.successfulProviders = report.providers.filter(provider => provider.status === 'complete'
    || report.offers.some(offer => offer.contract.source === provider.source)
    || report.candidates.some(candidate => candidate.source === provider.source)).length;
}

/** Runs only inside the shared job's execution scope; no independent car worker. */
export async function searchCars(raw: CarSearch, options: CarSearchOptions = {}): Promise<CarSearchReport> {
  const parent = currentTravelExecution();
  if (!parent) throw new CarError('Rental searches require a shared travel execution', 500);
  let search = validateCarSearch(raw, new Date(), { allowUnresolvedProviders: true });
  if (options.selection) {
    const selection = validateCarSelection(options.selection);
    if (!search.sources.includes(selection.source)) throw new CarError('Selected contract provider is not included in this search');
    search = { ...carTrackerSearch(search), sources: [selection.source] };
  }
  const timeout = options.providerTimeoutMs ?? 180_000;
  if (!Number.isInteger(timeout) || timeout < 1000 || timeout > 180_000) throw new CarError('Invalid provider execution budget');
  const report: CarSearchReport = { scope: 'checked_provider_offers', offers: [], candidates: [], errors: [], completed: 0, total: search.sources.length, successfulProviders: 0, providers: [] };
  for (const source of search.sources) {
    const execution = new TravelExecution(parent.identity);
    const signals = [parent.signal, ...(options.signal ? [options.signal] : [])];
    const abort = () => execution.abort(signals.find(signal => signal.aborted)?.reason);
    for (const signal of signals) signal.addEventListener('abort', abort, { once: true });
    if (signals.some(signal => signal.aborted)) abort();
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; execution.abort(new Error('Rental provider deadline exceeded')); }, timeout);
    const progress: CarProviderProgress = { source, status: 'running', checked: 0, discoveredVisible: 0, limit: 8, truncated: false };
    report.providers.push(progress);
    try {
      await withTravelExecution(execution, () => inspectProvider(source, search, report, execution, progress, options));
      if (signals.some(signal => signal.aborted)) throw signals.find(signal => signal.aborted)!.reason;
      if (timedOut) throw new Error('Rental provider deadline exceeded during cleanup');
    } catch (error) {
      if (error instanceof TravelCleanupError) {
        progress.status = 'failed';
        summarizeReport(report);
        throw new CarSearchCleanupError(structuredClone(report), error);
      }
      if (signals.some(signal => signal.aborted)) {
        progress.status = 'cancelled';
        summarizeReport(report);
        throw new CarSearchInterruptedError(structuredClone(report), error);
      }
      if (!timedOut) throw error;
      report.errors.push({ source, message: 'Provider deadline exceeded; its browsers were closed and any completed observations were retained' });
      progress.status = 'timed_out';
    } finally {
      clearTimeout(timer);
      for (const signal of signals) signal.removeEventListener('abort', abort);
    }
    summarizeReport(report);
    try { await publishProgress(report, options.onProgress, signals); }
    catch (error) {
      if (signals.some(signal => signal.aborted)) throw new CarSearchInterruptedError(structuredClone(report), error);
      throw error;
    }
    if (parent.signal.aborted || options.signal?.aborted) throw new CarSearchInterruptedError(structuredClone(report), parent.signal.aborted ? parent.signal.reason : options.signal?.reason);
  }
  return report;
}

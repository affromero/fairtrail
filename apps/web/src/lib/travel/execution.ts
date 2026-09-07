import { AsyncLocalStorage } from 'node:async_hooks';
import type { Browser } from 'playwright';

export interface TravelExecutionIdentity {
  jobId: string;
  generation: number;
  resource: string;
}

const executions = new AsyncLocalStorage<TravelExecution>();

export class TravelCleanupError extends AggregateError {
  constructor(errors: Iterable<unknown>, message: string, options?: ErrorOptions) {
    super(errors, message, options);
    this.name = 'TravelCleanupError';
  }
}

/** Owns browser lifetime, not VPN authority: remote mutations need fencing too. */
export class TravelExecution {
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly browsers = new Map<Browser, Promise<void> | null>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly failures: unknown[] = [];

  constructor(readonly identity: TravelExecutionIdentity) {
    this.signal = this.controller.signal;
  }

  check(): void { this.signal.throwIfAborted(); }

  abort(reason: unknown = new Error('Travel execution cancelled')): void {
    if (!this.signal.aborted) this.controller.abort(reason);
    for (const browser of this.browsers.keys()) this.closeBrowser(browser);
  }

  private closeBrowser(browser: Browser): void {
    if (this.browsers.get(browser)) return;
    const closing = browser.close().catch(error => { this.failures.push(error); });
    this.browsers.set(browser, closing);
    this.pending.add(closing);
    void closing.finally(() => { this.pending.delete(closing); this.browsers.delete(browser); });
  }

  async launch(factory: () => Promise<Browser>): Promise<Browser> {
    this.check();
    const launching = factory();
    this.pending.add(launching);
    try {
      const browser = await launching;
      this.browsers.set(browser, null);
      browser.once('disconnected', () => {
        if (!this.browsers.get(browser)) this.browsers.delete(browser);
      });
      if (this.signal.aborted) {
        this.closeBrowser(browser);
        await this.browsers.get(browser);
        this.check();
      }
      return browser;
    } finally { this.pending.delete(launching); }
  }

  /** Must finish successfully before releasing a resource for another worker. */
  async dispose(): Promise<void> {
    this.abort(new Error('Travel execution finished'));
    while (this.pending.size) await Promise.allSettled([...this.pending]);
    if (this.failures.length) throw new TravelCleanupError(this.failures, 'Travel browser cleanup failed');
  }
}

export function currentTravelExecution(): TravelExecution | undefined { return executions.getStore(); }

export async function withTravelExecution<T>(execution: TravelExecution, work: () => Promise<T>): Promise<T> {
  return executions.run(execution, async () => {
    let outcome: { ok: true; result: T } | { ok: false; error: unknown };
    try {
      execution.check();
      const result = await work();
      execution.check();
      outcome = { ok: true, result };
    }
    catch (error) { outcome = { ok: false, error }; }
    try { await execution.dispose(); }
    catch (cleanupError) {
      if (!outcome.ok) throw new TravelCleanupError([outcome.error, cleanupError], 'Travel operation and browser cleanup failed', { cause: cleanupError });
      throw cleanupError;
    }
    if (!outcome.ok) throw outcome.error;
    return outcome.result;
  });
}

export async function travelDelay(milliseconds: number): Promise<void> {
  const execution = currentTravelExecution();
  execution?.check();
  await new Promise<void>((resolve, reject) => {
    const finish = () => { execution?.signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      execution?.signal.removeEventListener('abort', abort);
      reject(execution?.signal.reason);
    };
    execution?.signal.addEventListener('abort', abort, { once: true });
  });
}

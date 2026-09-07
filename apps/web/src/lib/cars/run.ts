import { currentTravelExecution, TravelCleanupError } from '../travel/execution';
import { TravelJobError, type TravelLeaseToken } from '../travel/jobs';
import { failCarRun, finishCarRun, saveCarProgress, saveCarLocationResolution, startCarRun } from './persistence';
import { CarSearchCleanupError, CarSearchInterruptedError, searchCars } from './search';
import { carTrackerSearch } from './selection';
import { CarError } from './types';
import { validateCarSearch } from './validation';

function invalidated(error: unknown): boolean {
  const seen = new Set<unknown>();
  while (error instanceof Error && !seen.has(error)) {
    seen.add(error);
    if (error instanceof TravelJobError || (error instanceof CarError && error.status === 404)) return true;
    error = error.cause;
  }
  return false;
}

/** The shared coordinator owns admission, heartbeat, cancellation and cleanup. */
export async function executeCarJob(jobId: string, lease: TravelLeaseToken): Promise<void> {
  const execution = currentTravelExecution();
  if (!execution || execution.identity.jobId !== jobId || execution.identity.resource !== lease.id || execution.identity.generation !== lease.generation) throw new TravelJobError('Car job requires its matching shared execution');
  execution.check();
  try {
    const current = await startCarRun(jobId, lease);
    const requested = validateCarSearch(current.run.request, new Date(), { allowUnresolvedProviders: true });
    const search = current.tracker ? carTrackerSearch(requested) : requested;
    const report = await searchCars(search, {
      signal: execution.signal,
      ...(current.selection ? { selection: current.selection } : {}),
      onProgress: (report, signal) => saveCarProgress(jobId, lease, report, signal),
      onLocationResolution: (search, source) => saveCarLocationResolution(jobId, lease, search, source),
    });
    execution.check();
    await finishCarRun(jobId, lease, report);
  } catch (error) {
    if (execution.signal.aborted || invalidated(error) || error instanceof CarSearchInterruptedError || error instanceof CarSearchCleanupError || error instanceof TravelCleanupError) throw error;
    try { await failCarRun(jobId, lease); }
    catch (persistenceError) { throw new AggregateError([error, persistenceError], 'Car execution and failure persistence failed', { cause: persistenceError }); }
    throw error;
  }
}

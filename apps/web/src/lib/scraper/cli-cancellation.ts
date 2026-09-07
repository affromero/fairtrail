import type { ChildProcess } from 'node:child_process';

export function cliOutputControl(parent?: AbortSignal) {
  const controller = new AbortController();
  return {
    signal: parent ? AbortSignal.any([parent, controller.signal]) : undefined,
    append(previous: string, chunk: Buffer): string {
      if (parent && Buffer.byteLength(previous) + chunk.length > 64_000) {
        controller.abort(new Error('Inference output exceeded the allowed size'));
        return previous;
      }
      return previous + chunk.toString();
    },
  };
}

/** Controlled inference owns its process group and waits for close before release. */
export function linkCliCancellation(proc: ChildProcess, signal?: AbortSignal): () => void {
  if (!signal) return () => undefined;
  const stop = () => {
    if (proc.pid && process.platform !== 'win32') {
      try { process.kill(-proc.pid, 'SIGKILL'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    } else if (proc.exitCode === null || proc.exitCode === undefined) proc.kill('SIGKILL');
  };
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) stop();
  return () => signal.removeEventListener('abort', stop);
}

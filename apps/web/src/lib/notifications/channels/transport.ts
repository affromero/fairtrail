import type { Dispatcher } from 'undici';

export interface NotificationTransportOptions { signal?: AbortSignal }

/** Cancellation stops waiting for DNS too; callers must check authority before I/O. */
export function notificationBoundary<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
    if (signal.aborted) aborted();
  });
}

export async function notificationDeadline<T>(work: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal): Promise<T> {
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error('Notification transport deadline exceeded')), 15_000);
  const signal = parent ? AbortSignal.any([parent, deadline.signal]) : deadline.signal;
  try { signal.throwIfAborted(); return await work(signal); }
  finally { clearTimeout(timer); }
}

/** Do not buffer arbitrary provider error pages or leave successful bodies open. */
export async function notificationPost(url: string, init: RequestInit & { dispatcher?: Dispatcher }, name: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const response = await fetch(url, { ...init, signal });
  if (response.ok) { await response.body?.cancel(); return; }
  let detail = '';
  const reader = response.body?.getReader();
  try {
    if (reader) {
      const decoder = new TextDecoder();
      let bytes = 0;
      while (bytes < 1024) {
        const part = await notificationBoundary(reader.read(), signal);
        if (part.done) break;
        const bounded = part.value.subarray(0, 1024 - bytes);
        detail += decoder.decode(bounded, { stream: true }); bytes += bounded.length;
      }
    }
  } finally { await reader?.cancel(); }
  throw new Error(`${name} ${response.status}: ${detail.slice(0, 200)}`);
}

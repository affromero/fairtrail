/** @vitest-environment jsdom */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CAR_SEARCH_CREATION_TIMEOUT_MS, useCarSearchCreation } from './useCarSearchCreation';

const body = { offerId: 'base-offer', choiceId: 'c51f31ce-1f53-486b-b84c-2817429f3a73' };
const storageKey = 'ff-car-protection:alice:original';
const response = (key: string, id = 'protected-child') => new Response(JSON.stringify({ ok: true, data: { id, status: 'queued', creationKey: key } }));
const rejection = (status: number) => new Response(JSON.stringify({ ok: false, error: 'Request rejected' }), { status });
const mount = () => renderHook(({ scope, parent, closed }) => useCarSearchCreation(scope, { searchId: parent, trackingClosed: closed }), { initialProps: { scope: 'alice', parent: 'original', closed: false } });
beforeEach(() => { sessionStorage.clear(); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('durable protected-quote request recovery', () => {
  it('persists the immutable choice before sending and recovers the same request after a remount', async () => {
    const requests: { url: string; body: string; key: string }[] = []; let offline = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      const key = new Headers(init.headers).get('Idempotency-Key')!;
      expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toEqual({ key, body });
      requests.push({ url, body: String(init.body), key });
      if (offline) throw new TypeError('Lost acknowledgement');
      return response(key);
    }));
    const first = mount(); await act(async () => { await first.result.current.create(body); });
    expect(first.result.current.phase).toBe('uncertain'); first.unmount(); offline = false;
    const second = mount(); await act(async () => { await second.result.current.retry(); });
    expect(requests).toEqual([requests[0], requests[0]]);
    expect(requests[0]?.url).toBe('/api/cars/search/original/protection');
    expect(second.result.current).toMatchObject({ phase: 'created', id: 'protected-child', locked: true });
    expect(sessionStorage.getItem(storageKey)).toBeNull();
  });
  it('unlocks recovery at the deadline even when transport ignores abort and ignores its later success', async () => {
    let finish!: (response: Response) => void, key = '', signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      expect(url).toBe('/api/cars/search/original/protection');
      key = new Headers(init.headers).get('Idempotency-Key')!; signal = init.signal!;
      return new Promise<Response>(resolve => { finish = resolve; });
    }));
    const hook = mount(); act(() => { void hook.result.current.create(body); });
    await act(async () => { await vi.advanceTimersByTimeAsync(CAR_SEARCH_CREATION_TIMEOUT_MS + 1); });
    expect(signal?.aborted).toBe(true); expect(hook.result.current.phase).toBe('uncertain');
    await act(async () => { finish(response(key)); });
    expect(hook.result.current).toMatchObject({ phase: 'uncertain', id: null, pending: { key, body } });
    expect(sessionStorage.getItem(storageKey)).not.toBeNull();
  });
  it.each(['account', 'parent'] as const)('ignores late acknowledgements after the %s changes', async change => {
    let finish!: (response: Response) => void, key = '', signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      expect(url).toBe('/api/cars/search/original/protection');
      key = new Headers(init.headers).get('Idempotency-Key')!; signal = init.signal!;
      return new Promise<Response>(resolve => { finish = resolve; });
    }));
    const hook = mount(); act(() => { void hook.result.current.create(body); });
    hook.rerender({ scope: change === 'account' ? 'bob' : 'alice', parent: change === 'parent' ? 'another' : 'original', closed: false });
    expect(signal?.aborted).toBe(true);
    await act(async () => { finish(response(key)); });
    expect(hook.result.current).toMatchObject({ phase: 'ready', pending: null, id: null });
    expect(JSON.parse(sessionStorage.getItem(storageKey)!)).toMatchObject({ key, body });
  });
  it('prevents network mutations when storage fails and retains the original identity for recovery', async () => {
    const prototype = Object.getPrototypeOf(sessionStorage) as Storage, original = prototype.setItem;
    let blocked = true; const keys: string[] = [], requests: string[] = [];
    vi.spyOn(prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      keys.push(JSON.parse(value).key); if (blocked) throw new DOMException('Denied'); original.call(this, key, value);
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/cars/search/original/protection');
      const key = new Headers(init.headers).get('Idempotency-Key')!; requests.push(key); return response(key);
    }));
    const hook = mount(); await act(async () => { await hook.result.current.create(body); });
    expect(hook.result.current.phase).toBe('storage_error'); expect(requests).toEqual([]);
    blocked = false; act(() => hook.result.current.recoverStorage()); await act(async () => { await hook.result.current.retry(); });
    expect(new Set(keys)).toEqual(new Set(requests)); expect(requests).toHaveLength(1);
    expect(hook.result.current.phase).toBe('created');
  });
  it('requires permanent closure instead of discarding unreadable protected recovery data', async () => {
    sessionStorage.setItem(storageKey, '{'); const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      requests.push(url); return new Response(JSON.stringify({ ok: true, data: { id: 'original', trackingClosed: true } }));
    }));
    const hook = mount(); act(() => hook.result.current.discardUnreadable());
    expect(sessionStorage.getItem(storageKey)).toBe('{'); expect(hook.result.current.phase).toBe('storage_error');
    await act(async () => { await hook.result.current.closeTracking(); });
    await act(async () => { await hook.result.current.create(body); });
    expect(requests).toEqual(['/api/cars/search/original/close-tracking']);
    expect(hook.result.current).toMatchObject({ phase: 'closed', locked: true });
  });
  it('replays a known receipt after closure but never starts a replacement after a tombstone', async () => {
    const key = crypto.randomUUID(); sessionStorage.setItem(storageKey, JSON.stringify({ key, body }));
    const requests: string[] = []; let removed = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/cars/search/original/protection');
      requests.push(new Headers(init.headers).get('Idempotency-Key')!); return removed ? rejection(410) : response(key);
    }));
    const hook = mount(); hook.rerender({ scope: 'alice', parent: 'original', closed: true });
    await act(async () => { await hook.result.current.retry(); });
    expect(hook.result.current).toMatchObject({ phase: 'removed', locked: true });
    await act(async () => { await hook.result.current.create(body); }); expect(requests).toEqual([key]);
    hook.unmount(); removed = false;
    const restored = mount(); restored.rerender({ scope: 'alice', parent: 'original', closed: true });
    await act(async () => { await restored.result.current.retry(); });
    expect(restored.result.current).toMatchObject({ phase: 'created', id: 'protected-child' });
    expect(requests).toEqual([key, key]);
  });
  it('preserves uncertainty for an inconsistent acknowledgement and notifies access loss without deleting the receipt', async () => {
    let inaccessible = false, hidden = false;
    vi.stubGlobal('fetch', vi.fn(async () => inaccessible ? rejection(404) : response(crypto.randomUUID())));
    const hook = renderHook(() => useCarSearchCreation('alice', { searchId: 'original', trackingClosed: false, onAccessLost: () => { hidden = true; } }));
    await act(async () => { await hook.result.current.create(body); });
    expect(hook.result.current.phase).toBe('uncertain'); inaccessible = true;
    await act(async () => { await hook.result.current.retry(); });
    expect(hidden).toBe(true); expect(hook.result.current.phase).toBe('uncertain'); expect(sessionStorage.getItem(storageKey)).not.toBeNull();
  });
});

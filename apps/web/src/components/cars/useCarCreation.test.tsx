/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useCarCreation, CAR_CREATION_TIMEOUT_MS } from './useCarCreation';
import type { CarTrackingOptions } from '@/lib/cars/types';

const options: CarTrackingOptions = { mode: 'best', target: null, notifyLows: true, scrapeInterval: 3 };
function Harness({ actor = 'alice', searchId = 'search-one', closed = false }: { actor?: string; searchId?: string; closed?: boolean }) {
  const creation = useCarCreation(actor, searchId, undefined, closed);
  return <><output aria-label="Creation phase">{creation.phase}</output><output aria-label="Tracker">{creation.trackerId}</output><p role="alert">{creation.error}</p>
    <button disabled={creation.locked} onClick={() => void creation.create('offer-one', options)}>Create</button>
    <button disabled={creation.locked} onClick={() => void creation.create('offer-one', { ...options, mode: 'contract' })}>Create contract</button>
    <button disabled={creation.phase !== 'uncertain'} onClick={() => void creation.retry()}>Retry same creation</button>
    <button disabled={creation.phase !== 'storage_error'} onClick={() => void creation.recoverStorage()}>Recover storage</button>
    <button onClick={() => void creation.closeTracking()}>Close tracking</button></>;
}
function acknowledge(init: RequestInit, data: unknown = { id: 'saved-tracker' }) {
  return new Response(JSON.stringify({ ok: true, data: { tracker: data, creationKey: new Headers(init.headers).get('Idempotency-Key') } }));
}
beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('safe rental creation lifecycle', () => {
  it('retries a lost closure acknowledgement against the same search and stays closed if storage removal fails', async () => {
    sessionStorage.setItem('ff-car-creation:alice:search-one', '{');
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string) => {
      urls.push(url); if (urls.length === 1) throw new TypeError('Lost acknowledgement');
      return new Response(JSON.stringify({ ok: true, data: { id: 'search-one', trackingClosed: true } }));
    }));
    const first = render(<Harness />); fireEvent.click(screen.getByText('Close tracking'));
    await waitFor(() => expect(screen.getByLabelText('Creation phase')).toHaveTextContent('close_uncertain'));
    vi.spyOn(Object.getPrototypeOf(sessionStorage), 'removeItem').mockImplementation(() => { throw new DOMException('Storage unavailable'); });
    fireEvent.click(screen.getByText('Close tracking'));
    await waitFor(() => expect(screen.getByLabelText('Creation phase')).toHaveTextContent('closed'));
    expect(urls).toEqual(['/api/cars/search/search-one/close-tracking', '/api/cars/search/search-one/close-tracking']);
    expect(sessionStorage.getItem('ff-car-creation:alice:search-one')).toBe('{');
    first.unmount(); render(<Harness closed />);
    expect(screen.getByLabelText('Creation phase')).toHaveTextContent('closed');
    expect(screen.getByRole('button', { name: /^Create$/ })).toBeDisabled();
  });
  it('ignores a closure acknowledgement after switching account and preserves the original recovery record', async () => {
    sessionStorage.setItem('ff-car-creation:alice:search-one', '{');
    let resolveResponse!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(resolve => { resolveResponse = resolve; })));
    const view = render(<Harness />); fireEvent.click(screen.getByText('Close tracking'));
    view.rerender(<Harness actor="bob" />);
    await act(async () => { resolveResponse(new Response(JSON.stringify({ ok: true, data: { id: 'search-one', trackingClosed: true } }))); });
    expect(screen.getByLabelText('Creation phase')).toHaveTextContent('ready');
    expect(sessionStorage.getItem('ff-car-creation:alice:search-one')).toBe('{');
  });
  it('removes a corrupt receipt only after matching closure and never reopens on a stale server flag', async () => {
    sessionStorage.setItem('ff-car-creation:alice:search-one', '{');
    const fetcher = vi.fn().mockImplementation(async (url: string) => {
      expect(url).toBe('/api/cars/search/search-one/close-tracking');
      expect(sessionStorage.getItem('ff-car-creation:alice:search-one')).toBe('{');
      return new Response(JSON.stringify({ ok: true, data: { id: 'search-one', trackingClosed: true } }));
    }); vi.stubGlobal('fetch', fetcher);
    const view = render(<Harness />); fireEvent.click(screen.getByText('Close tracking'));
    await waitFor(() => expect(screen.getByLabelText('Creation phase')).toHaveTextContent('closed'));
    expect(sessionStorage.length).toBe(0);
    view.rerender(<Harness closed />); view.rerender(<Harness closed={false} />);
    expect(screen.getByRole('button', { name: /^Create$/ })).toBeDisabled();
    view.unmount(); render(<Harness closed />);
    expect(screen.getByLabelText('Creation phase')).toHaveTextContent('closed');
    expect(fetcher.mock.calls).toHaveLength(1);
  });
  it.each([{ id: 'other', trackingClosed: true }, { id: 'search-one', trackingClosed: false }, { id: 'search-one' }])('keeps a corrupt receipt and permits only closure retry after an invalid acknowledgement: %j', async data => {
    sessionStorage.setItem('ff-car-creation:alice:search-one', '{');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, data }))));
    render(<Harness />); fireEvent.click(screen.getByText('Close tracking'));
    await waitFor(() => expect(screen.getByLabelText('Creation phase')).toHaveTextContent('close_uncertain'));
    expect(sessionStorage.getItem('ff-car-creation:alice:search-one')).toBe('{');
    expect(screen.getByRole('button', { name: /^Create$/ })).toBeDisabled();
    expect(screen.getByText('Recover storage')).toBeDisabled();
  });
  it('recovers an existing receipt on a closed search without submitting a fresh creation', async () => {
    const key = crypto.randomUUID();
    sessionStorage.setItem('ff-car-creation:alice:search-one', JSON.stringify({ key, body: { searchId: 'search-one', offerId: 'offer-one', ...options } }));
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/cars'); expect(new Headers(init.headers).get('Idempotency-Key')).toBe(key);
      return acknowledge(init);
    }));
    render(<Harness closed />);
    expect(screen.getByRole('button', { name: /^Create$/ })).toBeDisabled();
    fireEvent.click(screen.getByText('Retry same creation'));
    await waitFor(() => expect(screen.getByLabelText('Tracker')).toHaveTextContent('saved-tracker'));
  });
  it('bounds closure even when transport ignores abort and retains the receipt after a late acknowledgement', async () => {
    vi.useFakeTimers(); sessionStorage.setItem('ff-car-creation:alice:search-one', '{');
    let resolveResponse!: (response: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise<Response>(resolve => { resolveResponse = resolve; })));
    render(<Harness />); fireEvent.click(screen.getByText('Close tracking'));
    await act(async () => { await vi.advanceTimersByTimeAsync(CAR_CREATION_TIMEOUT_MS); });
    expect(screen.getByLabelText('Creation phase')).toHaveTextContent('close_uncertain');
    await act(async () => { resolveResponse(new Response(JSON.stringify({ ok: true, data: { id: 'search-one', trackingClosed: true } }))); });
    expect(screen.getByLabelText('Creation phase')).toHaveTextContent('close_uncertain');
    expect(sessionStorage.getItem('ff-car-creation:alice:search-one')).toBe('{');
  });
  it('releases a stalled UI even when the transport ignores abort and ignores its late acknowledgement', async () => {
    vi.useFakeTimers(); let resolveResponse!: (response: Response) => void; let sent!: RequestInit;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init: RequestInit) => {
      sent = init; return new Promise<Response>(resolve => { resolveResponse = resolve; });
    }));
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(CAR_CREATION_TIMEOUT_MS); });
    expect(screen.getByLabelText('Creation phase')).toHaveTextContent('uncertain');
    expect(sent.signal!.aborted).toBe(true);
    await act(async () => { resolveResponse(acknowledge(sent)); });
    expect(screen.getByLabelText('Creation phase')).toHaveTextContent('uncertain');
    expect(screen.getByLabelText('Tracker')).toBeEmptyDOMElement();
    expect(sessionStorage.length).toBe(1);
  });
  it('ends recovery when the server confirms deletion without enabling a replacement tracker', async () => {
    const key = crypto.randomUUID();
    sessionStorage.setItem('ff-car-creation:alice:search-one', JSON.stringify({ key, body: { searchId: 'search-one', offerId: 'offer-one', ...options } }));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'This tracker was deleted' }), { status: 410 })));
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Retry same creation' }));
    await waitFor(() => expect(screen.getByLabelText('Creation phase')).toHaveTextContent('removed'));
    expect(screen.getByRole('alert')).toHaveTextContent('deleted');
    expect(screen.getByRole('button', { name: /^Create$/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Retry same creation' })).toBeDisabled();
    expect(JSON.parse(sessionStorage.getItem('ff-car-creation:alice:search-one')!).key).toBe(key);
  });
  it('recovers a transient storage failure with the original settings', async () => {
    const storage = vi.spyOn(Object.getPrototypeOf(sessionStorage), 'setItem').mockImplementationOnce(() => { throw new DOMException('Quota exceeded'); });
    let submitted: unknown;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init: RequestInit) => { submitted = JSON.parse(init.body as string); return acknowledge(init); }));
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Create contract' }));
    expect(screen.getByLabelText('Creation phase')).toHaveTextContent('storage_error');
    storage.mockRestore();
    fireEvent.click(screen.getByRole('button', { name: 'Recover storage' }));
    await waitFor(() => expect(screen.getByLabelText('Tracker')).toHaveTextContent('saved-tracker'));
    expect(submitted).toEqual({ searchId: 'search-one', offerId: 'offer-one', ...options, mode: 'contract' });
  });
  it('persists before sending and confirms a matching acknowledgement without another mutation', async () => {
    const fetcher = vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/cars');
      const saved = JSON.parse(sessionStorage.getItem('ff-car-creation:alice:search-one')!);
      expect(saved.key).toBe(new Headers(init.headers).get('Idempotency-Key'));
      expect(saved.body).toEqual(JSON.parse(init.body as string));
      return acknowledge(init);
    }); vi.stubGlobal('fetch', fetcher);
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await waitFor(() => expect(screen.getByLabelText('Creation phase')).toHaveTextContent('created'));
    expect(screen.getByLabelText('Tracker')).toHaveTextContent('saved-tracker');
    expect(sessionStorage.length).toBe(0); expect(fetcher.mock.calls).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Create$/ })).toBeDisabled();
  });
  it('preserves an uncertain payload across a remount and retries with exactly the same key', async () => {
    const sent: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init: RequestInit) => { sent.push(init); if (sent.length === 1) throw new TypeError('Network lost'); return acknowledge(init); }));
    const first = render(<Harness />); fireEvent.click(screen.getByRole('button', { name: 'Create contract' }));
    await waitFor(() => expect(screen.getByLabelText('Creation phase')).toHaveTextContent('uncertain'));
    expect(screen.getByRole('button', { name: /^Create$/ })).toBeDisabled(); first.unmount();
    render(<Harness />); expect(screen.getByLabelText('Creation phase')).toHaveTextContent('uncertain');
    expect(sent).toHaveLength(1); fireEvent.click(screen.getByRole('button', { name: 'Retry same creation' }));
    await waitFor(() => expect(screen.getByLabelText('Tracker')).toHaveTextContent('saved-tracker'));
    expect(sent).toHaveLength(2); expect(sent[1]!.body).toBe(sent[0]!.body);
    expect(new Headers(sent[1]!.headers).get('Idempotency-Key')).toBe(new Headers(sent[0]!.headers).get('Idempotency-Key'));
  });
  it.each(['server', 'invalid-json', 'mismatched-key', 'missing-id'])('keeps the pending intent when the acknowledgement is uncertain: %s', async kind => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      if (kind === 'server') return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), { status: 500 });
      if (kind === 'invalid-json') return new Response('<html>Gateway error</html>');
      if (kind === 'mismatched-key') return new Response(JSON.stringify({ ok: true, data: { tracker: { id: 'unrelated' }, creationKey: crypto.randomUUID() } }));
      return acknowledge(init, {});
    }));
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await waitFor(() => expect(screen.getByLabelText('Creation phase')).toHaveTextContent('uncertain'));
    expect(sessionStorage.length).toBe(1); expect(screen.getByLabelText('Tracker')).toBeEmptyDOMElement();
    fireEvent.click(screen.getByRole('button', { name: 'Retry same creation' }));
    await waitFor(() => expect(screen.getByLabelText('Creation phase')).toHaveTextContent('uncertain'));
    expect(sessionStorage.length).toBe(1);
  });
  it('clears a definitive rejection and uses a new key for an explicitly changed intent', async () => {
    const sent: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init: RequestInit) => { sent.push(init); return sent.length === 1 ? new Response(JSON.stringify({ ok: false, error: 'Three searches are active' }), { status: 429 }) : acknowledge(init); }));
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await waitFor(() => expect(screen.getByLabelText('Creation phase')).toHaveTextContent('rejected'));
    expect(screen.getByRole('alert')).toHaveTextContent('Three searches'); expect(sessionStorage.length).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Create contract' }));
    await waitFor(() => expect(screen.getByLabelText('Tracker')).toHaveTextContent('saved-tracker'));
    expect(JSON.parse(sent[1]!.body as string).mode).toBe('contract');
    expect(new Headers(sent[1]!.headers).get('Idempotency-Key')).not.toBe(new Headers(sent[0]!.headers).get('Idempotency-Key'));
  });
  it('keeps accounts and searches isolated without discarding another pending creation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network lost')));
    const first = render(<Harness />); fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await waitFor(() => expect(screen.getByLabelText('Creation phase')).toHaveTextContent('uncertain')); first.unmount();
    const second = render(<Harness actor="bob" />); expect(screen.getByLabelText('Creation phase')).toHaveTextContent('ready'); second.unmount();
    const third = render(<Harness searchId="different-search" />); expect(screen.getByLabelText('Creation phase')).toHaveTextContent('ready'); third.unmount();
    render(<Harness />); expect(screen.getByLabelText('Creation phase')).toHaveTextContent('uncertain'); expect(sessionStorage.length).toBe(1);
  });
  it.each([401, 429, 409])('retains the original key when recovery is rejected with HTTP %s', async status => {
    const sent: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      sent.push(init);
      if (sent.length === 1) throw new TypeError('Acknowledgement lost after commit');
      if (sent.length === 2) return new Response(JSON.stringify({ ok: false, error: 'Retry temporarily rejected' }), { status });
      return acknowledge(init);
    }));
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await waitFor(() => expect(screen.getByLabelText('Creation phase')).toHaveTextContent('uncertain'));
    fireEvent.click(screen.getByRole('button', { name: 'Retry same creation' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Retry temporarily rejected'));
    expect(screen.getByLabelText('Creation phase')).toHaveTextContent('uncertain');
    expect(screen.getByRole('button', { name: /^Create$/ })).toBeDisabled();
    expect(sessionStorage.length).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry same creation' }));
    await waitFor(() => expect(screen.getByLabelText('Tracker')).toHaveTextContent('saved-tracker'));
    expect(sent).toHaveLength(3);
    expect(new Set(sent.map(init => new Headers(init.headers).get('Idempotency-Key'))).size).toBe(1);
    expect(new Set(sent.map(init => init.body)).size).toBe(1);
  });
  it('bounds a stalled request and retains its receipt because cancellation does not undo creation', async () => {
    vi.useFakeTimers(); let signal: AbortSignal | null = null;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
      signal = init.signal!;
      await new Promise<void>(resolve => signal!.addEventListener('abort', () => resolve(), { once: true }));
      throw new DOMException('Aborted', 'AbortError');
    }));
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    await act(async () => { await vi.advanceTimersByTimeAsync(CAR_CREATION_TIMEOUT_MS); });
    expect(signal!.aborted).toBe(true); expect(screen.getByLabelText('Creation phase')).toHaveTextContent('uncertain'); expect(sessionStorage.length).toBe(1);
  });
  it('ignores a late response after unmount and recovers through the persisted retry', async () => {
    let resolveResponse!: (response: Response) => void; let sent!: RequestInit;
    vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string, init: RequestInit) => { sent = init; return new Promise<Response>(resolve => { resolveResponse = resolve; }); }));
    const first = render(<Harness />); fireEvent.click(screen.getByRole('button', { name: /^Create$/ })); first.unmount();
    expect(sent.signal!.aborted).toBe(true);
    await act(async () => { resolveResponse(acknowledge(sent)); });
    expect(sessionStorage.length).toBe(1); render(<Harness />); expect(screen.getByLabelText('Creation phase')).toHaveTextContent('uncertain');
  });
  it('does not send when the browser cannot persist the retry identity', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    vi.spyOn(Object.getPrototypeOf(sessionStorage), 'setItem').mockImplementation(() => { throw new DOMException('Quota exceeded'); });
    render(<Harness />); fireEvent.click(screen.getByRole('button', { name: /^Create$/ }));
    expect(screen.getByLabelText('Creation phase')).toHaveTextContent('storage_error'); expect(fetcher.mock.calls).toHaveLength(0);
  });
  it('does not replace a corrupt saved identity with a new mutation', () => {
    sessionStorage.setItem('ff-car-creation:alice:search-one', '{'); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    render(<Harness />); expect(screen.getByLabelText('Creation phase')).toHaveTextContent('storage_error');
    expect(screen.getByRole('button', { name: /^Create$/ })).toBeDisabled(); expect(fetcher.mock.calls).toHaveLength(0);
  });
});

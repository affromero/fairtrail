/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { carTrackerViewFixture } from '@/test/car-fixtures';
import type { CarTrackerView } from '@/lib/cars/tracker-view';
import { CarTrackers } from './CarTrackers';
import en from '../../../messages/en/cars.json';
import es from '../../../messages/es/cars.json';
import fr from '../../../messages/fr/cars.json';
import de from '../../../messages/de/cars.json';
import pt from '../../../messages/pt/cars.json';

vi.unmock('next-intl');
const locales = { en, es, fr, de, pt };
function View({ admin = false, locale = 'en' }: { admin?: boolean; locale?: keyof typeof locales }) {
  return <NextIntlClientProvider locale={locale} messages={locales[locale]}><CarTrackers admin={admin} /></NextIntlClientProvider>;
}
function tracker(id = 'one'): CarTrackerView { return { ...carTrackerViewFixture(), id, label: `Rental ${id}` }; }
function response(trackers: unknown[], nextCursor: string | null = null) { return new Response(JSON.stringify({ ok: true, data: { trackers, nextCursor } }), { headers: { 'Content-Type': 'application/json' } }); }
function denied(status: number) { return new Response(JSON.stringify({ ok: false, error: 'Access unavailable' }), { status, headers: { 'Content-Type': 'application/json' } }); }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('saved rental dashboard', () => {
  it.each(Object.keys(locales) as (keyof typeof locales)[])('renders %s saved rentals with honest prices and station-local dates', async locale => {
    const row = tracker(); row.active = false; row.lastError = 'One provider failed';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([row])));
    render(<View locale={locale} />);
    const link = await screen.findByRole('link', { name: /Rental one/ });
    expect(link).toHaveAttribute('href', '/cars/one');
    expect(link).toHaveTextContent(locales[locale].Cars.trackerPaused);
    expect(link).toHaveTextContent(locales[locale].Cars.latestCheckAttention);
    expect(link).toHaveTextContent(locales[locale].Cars.retainedPrice);
    expect(link.querySelector('time')).toHaveAttribute('datetime', row.search.pickupAt.instant);
    expect(link).toHaveTextContent('Europe/London');
    expect(screen.getByText(locales[locale].Cars.listHistoricalHelp)).toBeInTheDocument();
    link.focus(); expect(link).toHaveFocus();
  });
  it('shows missing prices as unknown, not zero or a fresh quote', async () => {
    const row = { ...tracker(), latestPriceMinor: null };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([row]))); render(<View />);
    expect(await screen.findByRole('link', { name: /Rental one/ })).toHaveTextContent('Unknown');
    expect(screen.queryByText('£0.00')).not.toBeInTheDocument();
    expect(screen.queryByText('Last check attempted')).not.toBeInTheDocument();
  });
  it('distinguishes loading, a failed request and a confirmed empty list', async () => {
    let resolve!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Offline')).mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; })));
    render(<View />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be updated');
    expect(screen.queryByText(/No saved rental trackers/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry rental list' }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    await act(async () => { resolve(response([])); });
    expect(screen.getByText(/No saved rental trackers/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('loads every page without duplicate rows and retries a failed page at the same position', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response([tracker('one')], 'page_two')).mockRejectedValueOnce(new TypeError('Offline')).mockResolvedValueOnce(response([tracker('one'), tracker('two')]));
    vi.stubGlobal('fetch', fetcher); render(<View />);
    await screen.findByRole('link', { name: /Rental one/ });
    fireEvent.click(screen.getByRole('button', { name: 'Load more rentals' }));
    await screen.findByRole('alert'); expect(screen.getByRole('link', { name: /Rental one/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry rental list' }));
    await screen.findByRole('link', { name: /Rental two/ });
    expect(screen.getAllByRole('link')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Load more rentals' })).not.toBeInTheDocument();
    expect(fetcher.mock.calls.slice(1).map(call => call[0])).toEqual(['/api/cars?limit=25&cursor=page_two', '/api/cars?limit=25&cursor=page_two']);
  });
  it.each(['repeated cursor', 'repeated rows', 'invalid row', 'oversized page', 'invalid cursor'] as const)('rejects a %s without replacing the confirmed list', async kind => {
    const bad = kind === 'invalid row' ? [{ ...tracker('two'), latestPriceMinor: -1 }] : kind === 'oversized page' ? Array.from({ length: 26 }, (_, index) => tracker(String(index))) : kind === 'repeated rows' ? [tracker('one')] : [tracker('two')];
    const next = kind === 'repeated cursor' ? 'page_two' : kind === 'invalid cursor' ? '!invalid' : null;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response([tracker('one')], 'page_two')).mockResolvedValueOnce(response(bad, next))); render(<View />);
    await screen.findByRole('link', { name: /Rental one/ }); fireEvent.click(screen.getByRole('button', { name: 'Load more rentals' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be updated');
    expect(screen.getByRole('link', { name: /Rental one/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Rental two/ })).not.toBeInTheDocument();
  });
  it.each([401, 403, 404])('hides all loaded rows after %s and never reveals them on a subsequent network error', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response([tracker('one')], 'page_two')).mockResolvedValueOnce(response([tracker('two')], 'page_three')).mockResolvedValueOnce(denied(status)).mockRejectedValueOnce(new TypeError('Offline')).mockResolvedValueOnce(response([tracker('new')])));
    render(<View />); await screen.findByRole('link', { name: /Rental one/ }); fireEvent.click(screen.getByRole('button', { name: 'Load more rentals' }));
    await screen.findByRole('link', { name: /Rental two/ }); fireEvent.click(screen.getByRole('button', { name: 'Load more rentals' }));
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=%2Fcars');
    expect(screen.queryByRole('link', { name: /Rental/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry rental list' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry rental list' })).toBeEnabled());
    expect(screen.queryByRole('link', { name: /Rental/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry rental list' }));
    expect(await screen.findByRole('link', { name: /Rental new/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Rental one|Rental two/ })).not.toBeInTheDocument();
  });
  it('refresh supersedes an in-flight next page and discards its late response', async () => {
    let finish!: (value: Response) => void, signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response([tracker('one')], 'page_two')).mockImplementationOnce((url: string, init: RequestInit) => { signal = init.signal!; return new Promise<Response>(done => { finish = done; }); }).mockResolvedValueOnce(response([tracker('new')])));
    render(<View />); await screen.findByRole('link', { name: /Rental one/ }); fireEvent.click(screen.getByRole('button', { name: 'Load more rentals' }));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh rental list' }));
    await screen.findByRole('link', { name: /Rental new/ }); expect(signal?.aborted).toBe(true);
    await act(async () => { finish(response([tracker('late')])); });
    expect(screen.queryByRole('link', { name: /Rental one|Rental late/ })).not.toBeInTheDocument();
  });
  it('aborts an unresponsive page after fifteen seconds and restores retry controls', async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => { signal = init.signal!; return new Promise<Response>((...callbacks) => { signal!.addEventListener('abort', () => callbacks[1](new DOMException('Aborted', 'AbortError'))); }); }));
    render(<View />); await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Retry rental list' })).toBeEnabled();
    expect(screen.queryByText(/No saved rental trackers/)).not.toBeInTheDocument();
  });
  it('requests administrator scope explicitly and clears its rows when switching to a personal list', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(response([tracker('admin')])).mockResolvedValueOnce(response([])); vi.stubGlobal('fetch', fetcher);
    const view = render(<View admin />); await screen.findByRole('link', { name: /Rental admin/ });
    expect(fetcher.mock.calls[0]![0]).toBe('/api/cars?limit=25&admin=true');
    view.rerender(<View />); await screen.findByText(/No saved rental trackers/);
    expect(screen.queryByRole('link', { name: /Rental admin/ })).not.toBeInTheDocument();
    expect(fetcher.mock.calls[1]![0]).toBe('/api/cars?limit=25');
  });
});

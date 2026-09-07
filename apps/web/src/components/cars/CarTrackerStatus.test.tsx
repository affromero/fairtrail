/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { carOfferFixture, carTrackerViewFixture } from '@/test/car-fixtures';
import { validateCarDetailView, type CarDetailView } from '@/lib/cars/detail-view';
import { carContractHash } from '@/lib/cars/selection';
import { CarTrackerStatus } from './CarTrackerStatus';
import en from '../../../messages/en/cars.json';
import es from '../../../messages/es/cars.json';
import fr from '../../../messages/fr/cars.json';
import de from '../../../messages/de/cars.json';
import pt from '../../../messages/pt/cars.json';

vi.unmock('next-intl');
const locales = { en, es, fr, de, pt };
function fixture(): CarDetailView {
  const tracker = carTrackerViewFixture(), observedAt = new Date(Date.now() - 86_400_000).toISOString(), offer = carOfferFixture(observedAt);
  const snapshot = { id: 'observation-one', runId: 'run-one', source: offer.contract.source, contractHash: carContractHash(offer.contract), offer, currency: 'GBP', totalMinor: 10000, eligible: true, reasons: [], observedAt, evaluatedAt: observedAt };
  return validateCarDetailView({ tracker, snapshots: [snapshot], latestObservation: snapshot, runs: [{ id: 'run-one', trackerId: tracker.id, status: 'success', createdAt: observedAt, completedAt: observedAt, error: null }], notificationsConfigured: false, canReassign: false }, tracker.id);
}
function View({ initial, locale = 'en' }: { initial: CarDetailView; locale?: keyof typeof locales }) {
  return <NextIntlClientProvider locale={locale} messages={locales[locale]}><CarTrackerStatus initial={initial} actorScope="alice" /></NextIntlClientProvider>;
}
function response(value: unknown, status = 200) { return new Response(JSON.stringify(status === 200 ? { ok: true, data: value } : { ok: false, error: 'Access unavailable' }), { status, headers: { 'Content-Type': 'application/json' } }); }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('private rental history and status recovery', () => {
  it('separates a failed attempt from the timestamp of the retained verified price', () => {
    const initial = fixture(); initial.tracker.lastError = 'Provider blocked this check';
    render(<View initial={initial} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Failed checks do not refresh');
    expect(screen.getByText('Latest evidence for this total').nextElementSibling?.querySelector('time')).toHaveAttribute('datetime', initial.latestObservation!.observedAt);
    expect(screen.getByText('Last check attempted').nextElementSibling?.querySelector('time')).toHaveAttribute('datetime', initial.tracker.lastCheckedAt);
    expect(screen.getByText('Last verified rental total').nextElementSibling).toHaveTextContent('£100.00');
    expect(screen.getByText('Lowest verified total recorded').nextElementSibling).toHaveTextContent('£90.00');
    expect(screen.getByText(/not current availability/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Track this rental/ })).not.toBeInTheDocument();
  });
  it('keeps excluded observations out of verified history and preserves their reasons', async () => {
    const initial = fixture(); initial.snapshots[0] = { ...initial.snapshots[0]!, eligible: false, reasons: ['Different selected contract'] };
    render(<View initial={initial} />);
    const verified = screen.getByRole('region', { name: 'Verified price history' });
    expect(verified).toHaveTextContent('No verified observations');
    expect(verified).not.toHaveTextContent('£100.00');
    const excluded = screen.getByRole('region', { name: 'Excluded observations' });
    await userEvent.setup().click(within(excluded).getByText(/DiscoverCars · Example supplier/));
    expect(excluded).toHaveTextContent('Different selected contract');
    expect(excluded).toHaveTextContent('not verified');
    expect(excluded).toHaveTextContent('do not update');
  });
  it('does not invent evidence timestamps or substitute zero for missing prices', () => {
    const initial = fixture(); initial.latestObservation = null; initial.tracker.latestPriceMinor = null; initial.tracker.historicalLowMinor = null; initial.snapshots = []; initial.runs = [];
    render(<View initial={initial} />);
    expect(screen.getByText('Last verified rental total').nextElementSibling).toHaveTextContent('Unknown');
    expect(screen.getByText('Latest evidence for this total').nextElementSibling).toHaveTextContent('Not recorded');
    expect(screen.queryByText('Evidence for the retained price')).not.toBeInTheDocument();
    expect(screen.getByText('No checks recorded.')).toBeInTheDocument();
  });
  it.each(Object.keys(locales) as (keyof typeof locales)[])('renders %s history and focusable evidence without creation controls', async locale => {
    const initial = fixture(); render(<View initial={initial} locale={locale} />);
    expect(screen.getByRole('heading', { name: locales[locale].Cars.verifiedHistory })).toBeInTheDocument();
    const summary = screen.getByText(locales[locale].Cars.retainedEvidence);
    summary.focus(); expect(summary).toHaveFocus();
    await userEvent.setup().click(summary);
    expect(summary.closest('details')).toHaveAttribute('open');
    expect(screen.getAllByText(/Europe\/London/)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: locales[locale].Cars.track })).not.toBeInTheDocument();
  });
  it('retains the last confirmed history through a network failure and explicitly recovers', async () => {
    const initial = fixture(), next = structuredClone(initial); next.tracker.label = 'Updated rental'; next.tracker.revision++;
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('Network down')).mockResolvedValueOnce(response(next)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('last confirmed view');
    expect(screen.getByRole('heading', { name: 'London weekend' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry status updates' }));
    expect(await screen.findByRole('heading', { name: 'Updated rental' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetcher.mock.calls[1]![1]).toMatchObject({ cache: 'no-store' });
  });
  it.each([401, 403, 404])('hides private history on %s and keeps it hidden through a subsequent network failure', async status => {
    const initial = fixture(); vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(null, status)).mockRejectedValueOnce(new TypeError('Network down')).mockResolvedValueOnce(response(initial)));
    render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(await screen.findByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login?next=%2Fcars%2Ftracker-one');
    expect(screen.queryByRole('heading', { name: 'London weekend' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry status updates' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry status updates' })).toBeEnabled());
    expect(screen.queryByRole('heading', { name: 'London weekend' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry status updates' }));
    expect(await screen.findByRole('heading', { name: 'London weekend' })).toBeInTheDocument();
  });
  it('polls queued work until completion without starting another check', async () => {
    vi.useFakeTimers(); const initial = fixture(), next = structuredClone(initial); initial.runs[0]!.status = 'queued'; initial.runs[0]!.completedAt = null;
    const fetcher = vi.fn().mockResolvedValue(response(next)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={initial} />);
    expect(screen.getByRole('region', { name: 'Recent checks' })).toHaveTextContent('Waiting');
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    expect(screen.getByRole('region', { name: 'Recent checks' })).toHaveTextContent('Checked');
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(fetcher.mock.calls).toHaveLength(1);
    expect(fetcher.mock.calls[0]![0]).toBe('/api/cars/tracker-one');
    expect(fetcher.mock.calls[0]![1]).not.toHaveProperty('method');
  });
  it.each(['tracker', 'search', 'revision', 'money'] as const)('rejects inconsistent %s responses and preserves the confirmed view', async kind => {
    const initial = fixture(), next = structuredClone(initial); initial.tracker.revision = 2; next.tracker.revision = 2;
    if (kind === 'tracker') next.tracker.id = 'another-tracker';
    if (kind === 'search') next.tracker.search.pickup.name = 'Unrelated airport';
    if (kind === 'revision') next.tracker.revision = 1;
    if (kind === 'money') next.snapshots[0]!.totalMinor = 10001;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(next)));
    render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('last confirmed view');
    expect(screen.getByRole('heading', { name: 'London weekend' })).toBeInTheDocument();
    expect(screen.queryByText('Unrelated airport')).not.toBeInTheDocument();
  });
  it('aborts a hanging request on its deadline and allows a manual status retry', async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      expect(url).toBe('/api/cars/tracker-one');
      signal = init.signal!;
      return new Promise<Response>((...callbacks) => {
        signal!.addEventListener('abort', () => callbacks[1](new DOMException('Aborted', 'AbortError')), { once: true });
      });
    }));
    render(<View initial={fixture()} />); fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(signal?.aborted).toBe(true);
    expect(screen.getByRole('button', { name: 'Retry status updates' })).toBeEnabled();
    expect(screen.getByRole('heading', { name: 'London weekend' })).toBeInTheDocument();
  });
  it.each(['timestamp', 'terminal', 'running'] as const)('rejects same-revision %s regressions without replacing confirmed history', async kind => {
    const initial = fixture(), next = structuredClone(initial);
    if (kind === 'timestamp') next.tracker.updatedAt = new Date(Date.parse(initial.tracker.updatedAt) - 1000).toISOString();
    if (kind === 'terminal') { next.runs[0]!.status = 'running'; next.runs[0]!.completedAt = null; }
    if (kind === 'running') { initial.runs[0]!.status = 'running'; initial.runs[0]!.completedAt = null; next.runs[0]!.status = 'queued'; next.runs[0]!.completedAt = null; }
    if (kind === 'timestamp') { initial.tracker.createdAt = new Date(Date.parse(initial.tracker.updatedAt) - 2000).toISOString(); next.tracker.createdAt = initial.tracker.createdAt; }
    next.tracker.label = 'Stale rental';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(next)));
    render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('last confirmed view');
    expect(screen.queryByRole('heading', { name: 'Stale rental' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'London weekend' })).toBeInTheDocument();
  });
  it('keeps verified observations visible when a partial check carries a warning', () => {
    const initial = fixture(); initial.runs[0]!.status = 'partial'; initial.tracker.lastError = 'One provider could not be checked';
    render(<View initial={initial} />);
    expect(screen.getByRole('alert')).toHaveTextContent('needs attention');
    expect(screen.getByRole('alert')).not.toHaveTextContent('latest check failed');
    expect(screen.getByRole('region', { name: 'Verified price history' })).toHaveTextContent('£100.00');
    expect(screen.getByRole('region', { name: 'Recent checks' })).toHaveTextContent('Partially checked');
  });
});

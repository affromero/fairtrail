/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
beforeEach(() => { sessionStorage.clear(); });
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
  it('pauses a tracker using the displayed revision and confirms the saved state', async () => {
    const initial = fixture(), next = structuredClone(initial); next.tracker.active = false; next.tracker.revision++;
    const fetcher = vi.fn().mockResolvedValueOnce(response({ tracker: next.tracker })).mockResolvedValueOnce(response(next)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Pause tracking' }));
    expect(await screen.findByRole('button', { name: 'Resume tracking' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('Settings saved and confirmed');
    expect(fetcher.mock.calls[0]![1]).toMatchObject({ method: 'PATCH', headers: expect.any(Headers) });
    expect(new Headers(fetcher.mock.calls[0]![1].headers).get('X-Car-Revision')).toBe('0');
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ active: false });
    expect(sessionStorage.getItem('ff-car-management:alice:tracker-one')).toBeNull();
  });
  it('saves localized monetary targets without changing the fixed matching mode', async () => {
    const initial = fixture(), next = structuredClone(initial); next.tracker.options.target = { currency: 'GBP', minor: 8575 }; next.tracker.revision++;
    const fetcher = vi.fn().mockResolvedValueOnce(response({ tracker: next.tracker })).mockResolvedValueOnce(response(next)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={initial} locale="de" />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(de.Cars.target.replace('{currency}', 'GBP')), { target: { value: '85,75' } });
    fireEvent.click(screen.getByRole('button', { name: de.Cars.saveSettings }));
    expect(await screen.findByText(de.Cars.settingsSaved)).toBeInTheDocument();
    expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({ target: { currency: 'GBP', minor: 8575 }, notifyLows: true, scrapeInterval: 3 });
  });
  it('recovers a lost edit acknowledgement with its original revision even after the edit has completed', async () => {
    const initial = fixture(), next = structuredClone(initial); next.tracker.active = false; next.tracker.revision++;
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('Lost response')).mockResolvedValueOnce(response(initial)).mockResolvedValueOnce(response(null, 412)).mockResolvedValueOnce(response(next)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Pause tracking' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recover this action' })).toBeEnabled());
    const saved = sessionStorage.getItem('ff-car-management:alice:tracker-one'); expect(saved).toContain('"revision":0');
    fireEvent.click(screen.getByRole('button', { name: 'Retry status updates' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh status' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Pause tracking' })).toBeDisabled();
    expect(sessionStorage.getItem('ff-car-management:alice:tracker-one')).toBe(saved);
    fireEvent.click(screen.getByRole('button', { name: 'Recover this action' }));
    expect(await screen.findByText('The requested settings are currently saved.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Resume tracking' })).toBeEnabled();
    const writes = fetcher.mock.calls.filter(([, init]) => init.method === 'PATCH');
    expect(writes).toHaveLength(2);
    expect(writes.map(([, init]) => new Headers(init.headers).get('X-Car-Revision'))).toEqual(['0', '0']);
    expect(writes[0]![1].body).toBe(writes[1]![1].body);
  });
  it('requires explicit review when a different edit wins rather than resubmitting against its newer revision', async () => {
    const initial = fixture(), next = structuredClone(initial); next.tracker.label = 'Changed elsewhere'; next.tracker.revision++;
    const fetcher = vi.fn().mockResolvedValueOnce(response(null, 412)).mockResolvedValueOnce(response(next)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Pause tracking' }));
    const accept = await screen.findByRole('button', { name: 'Use current saved settings' });
    expect(screen.getByRole('button', { name: 'Pause tracking' })).toBeDisabled();
    expect(screen.getByRole('heading', { name: 'Changed elsewhere' })).toBeInTheDocument();
    fireEvent.click(accept);
    expect(screen.getByRole('button', { name: 'Pause tracking' })).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('Current saved settings accepted');
    expect(screen.queryByText('The requested settings are currently saved.')).not.toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([, init]) => init.method === 'PATCH')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Load current settings' }));
    expect(screen.getByLabelText('Tracker label')).toHaveValue('Changed elsewhere');
  });
  it('restores an unresolved intent after remount without silently sending it', async () => {
    const initial = fixture(), next = structuredClone(initial); next.tracker.active = false; next.tracker.revision++;
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('Lost response')).mockResolvedValueOnce(response(null, 412)).mockResolvedValueOnce(response(next)); vi.stubGlobal('fetch', fetcher);
    const first = render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Pause tracking' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recover this action' })).toBeEnabled()); first.unmount();
    render(<View initial={next} />);
    expect(screen.getByRole('button', { name: 'Resume tracking' })).toBeDisabled();
    expect(fetcher.mock.calls).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Recover this action' }));
    expect(await screen.findByText('The requested settings are currently saved.')).toBeInTheDocument();
    expect(new Headers(fetcher.mock.calls[1]![1].headers).get('X-Car-Revision')).toBe('0');
  });
  it('invalidates an open delete confirmation when polling discovers a newer revision', async () => {
    const initial = fixture(), next = structuredClone(initial); next.tracker.revision++; next.tracker.label = 'Someone edited this';
    const fetcher = vi.fn().mockResolvedValue(response(next)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Delete tracker' }));
    expect(screen.getByRole('button', { name: 'Yes, delete tracker' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    await screen.findByRole('heading', { name: 'Someone edited this' });
    expect(screen.getByRole('button', { name: 'Yes, delete tracker' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete tracker' }));
    expect(fetcher.mock.calls.filter(([, init]) => init.method === 'DELETE')).toHaveLength(0);
  });
  it('requires explicit confirmation and hides deleted tracker data after an acknowledged deletion', async () => {
    const fetcher = vi.fn().mockResolvedValue(response({ id: 'tracker-one', deleted: true })); vi.stubGlobal('fetch', fetcher);
    render(<View initial={fixture()} />); fireEvent.click(screen.getByRole('button', { name: 'Delete tracker' }));
    expect(fetcher.mock.calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Keep tracker' })); expect(screen.queryByRole('button', { name: 'Yes, delete tracker' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete tracker' })); fireEvent.click(screen.getByRole('button', { name: 'Yes, delete tracker' }));
    expect(await screen.findByText('Rental tracker deleted. No booking was cancelled.')).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('heading', { name: 'London weekend' })).not.toBeInTheDocument();
    expect(fetcher.mock.calls[0]![1].method).toBe('DELETE');
    expect(new Headers(fetcher.mock.calls[0]![1].headers).get('X-Car-Revision')).toBe('0');
  });
  it('does not attribute a missing tracker to an uncertain deletion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new TypeError('Lost response')).mockResolvedValueOnce(response(null, 404)));
    render(<View initial={fixture()} />); fireEvent.click(screen.getByRole('button', { name: 'Delete tracker' })); fireEvent.click(screen.getByRole('button', { name: 'Yes, delete tracker' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recover this action' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Retry status updates' }));
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Rental tracker deleted. No booking was cancelled.')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'London weekend' })).not.toBeInTheDocument();
  });
  it('does not send a mutation when its durable browser identity cannot be saved', async () => {
    vi.spyOn(Object.getPrototypeOf(sessionStorage), 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    render(<View initial={fixture()} />); fireEvent.click(screen.getByRole('button', { name: 'Pause tracking' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Browser recovery storage');
    expect(fetcher.mock.calls).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Pause tracking' })).toBeDisabled();
  });
  it('supersedes an outstanding poll and ignores its late response after a mutation', async () => {
    const initial = fixture(), next = structuredClone(initial); next.tracker.revision++; next.tracker.active = false;
    let finish: (value: Response) => void = () => { throw new Error('Poll did not start'); }, signal: AbortSignal | undefined;
    const fetcher = vi.fn().mockImplementationOnce((url: string, init: RequestInit) => { expect(url).toBe('/api/cars/tracker-one'); signal = init.signal!; return new Promise<Response>(resolve => { finish = resolve; }); }).mockResolvedValueOnce(response({ tracker: next.tracker })).mockResolvedValueOnce(response(next)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause tracking' }));
    expect(await screen.findByRole('button', { name: 'Resume tracking' })).toBeEnabled(); expect(signal?.aborted).toBe(true);
    await act(async () => { finish(response(initial)); });
    expect(screen.getByRole('button', { name: 'Resume tracking' })).toBeEnabled();
    expect(screen.queryByRole('button', { name: 'Pause tracking' })).not.toBeInTheDocument();
  });
  it('recovers corrupt metadata only through an explicit revision-guarded pause', async () => {
    const initial = fixture(), next = structuredClone(initial); next.tracker.active = false; next.tracker.revision++;
    sessionStorage.setItem('ff-car-management:alice:tracker-one', '{broken');
    const fetcher = vi.fn().mockResolvedValueOnce(response(initial)).mockImplementationOnce(async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/cars/tracker-one'); expect(init.method).toBe('PATCH');
      expect(JSON.parse(sessionStorage.getItem('ff-car-management:alice:tracker-one')!)).toMatchObject({ revision: 0, action: { kind: 'active', active: false } });
      return response({ tracker: next.tracker });
    }).mockResolvedValueOnce(response(next)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={initial} />);
    expect(screen.getByRole('button', { name: 'Pause tracking' })).toBeDisabled(); expect(fetcher.mock.calls).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Pause and recover controls' }));
    expect(await screen.findByRole('button', { name: 'Resume tracking' })).toBeEnabled();
    expect(sessionStorage.getItem('ff-car-management:alice:tracker-one')).toBeNull();
  });
  it('preserves the original action when removing its recovery record fails after success', async () => {
    const initial = fixture(), next = structuredClone(initial); next.tracker.active = false; next.tracker.revision++;
    const removal = vi.spyOn(Object.getPrototypeOf(sessionStorage), 'removeItem').mockImplementation(() => { throw new Error('Storage inaccessible'); });
    const fetcher = vi.fn().mockResolvedValueOnce(response({ tracker: next.tracker })).mockResolvedValueOnce(response(next)).mockResolvedValueOnce(response(null, 412)).mockResolvedValueOnce(response(next)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Pause tracking' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recover this action' })).toBeEnabled());
    expect(sessionStorage.getItem('ff-car-management:alice:tracker-one')).toContain('"revision":0');
    removal.mockRestore(); fireEvent.click(screen.getByRole('button', { name: 'Recover this action' }));
    expect(await screen.findByText('The requested settings are currently saved.')).toBeInTheDocument();
    expect(new Headers(fetcher.mock.calls[2]![1].headers).get('X-Car-Revision')).toBe('0');
  });
  it('retains a timed-out PATCH while the original operation can still commit', async () => {
    vi.useFakeTimers(); const initial = fixture(), next = structuredClone(initial); next.tracker.active = false; next.tracker.revision++;
    const fetcher = vi.fn().mockImplementationOnce((url: string, init: RequestInit) => {
      expect(url).toBe('/api/cars/tracker-one');
      return new Promise<Response>((...callbacks) => { init.signal!.addEventListener('abort', () => callbacks[1](new DOMException('Aborted', 'AbortError')), { once: true }); });
    }).mockResolvedValueOnce(response(initial)).mockResolvedValueOnce(response(next)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Pause tracking' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    const saved = sessionStorage.getItem('ff-car-management:alice:tracker-one');
    expect(saved).toContain('"revision":0');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry status updates' })); });
    expect(screen.getByRole('button', { name: 'Pause tracking' })).toBeDisabled();
    expect(sessionStorage.getItem('ff-car-management:alice:tracker-one')).toBe(saved);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Refresh status' })); });
    expect(screen.getByRole('button', { name: 'Resume tracking' })).toBeEnabled();
    expect(screen.getByText('The requested settings are currently saved.')).toBeInTheDocument();
    expect(fetcher.mock.calls.filter(([, init]) => init.method === 'PATCH')).toHaveLength(1);
  });
  it.each(['revision', 'fields', 'identity', 'json'] as const)('keeps the edit unresolved after a malformed %s acknowledgement', async kind => {
    const initial = fixture(), next = structuredClone(initial); next.tracker.revision++; next.tracker.active = false;
    if (kind === 'revision') next.tracker.revision++;
    if (kind === 'fields') next.tracker.active = true;
    if (kind === 'identity') next.tracker.id = 'unrelated';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(kind === 'json' ? new Response('<html>Gateway error</html>') : response({ tracker: next.tracker })));
    render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Pause tracking' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Recover this action' })).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Pause tracking' })).toBeDisabled();
    expect(sessionStorage.getItem('ff-car-management:alice:tracker-one')).toContain('"revision":0');
  });
  it('allows a new deliberate edit after a definite server rejection', async () => {
    const fetcher = vi.fn().mockResolvedValue(response(null, 409)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={fixture()} />); fireEvent.click(screen.getByRole('button', { name: 'Pause tracking' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pause tracking' })).toBeEnabled());
    expect(screen.getByRole('alert')).toHaveTextContent('Access unavailable');
    expect(sessionStorage.getItem('ff-car-management:alice:tracker-one')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Recover this action' })).not.toBeInTheDocument();
  });
  it('retains an unresolved edit across authentication loss and reconciles after sign-in', async () => {
    const initial = fixture(), next = structuredClone(initial); next.tracker.active = false; next.tracker.revision++;
    const fetcher = vi.fn().mockResolvedValueOnce(response(null, 401)).mockResolvedValueOnce(response(next)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Pause tracking' }));
    await screen.findByRole('link', { name: 'Sign in' });
    expect(screen.queryByRole('heading', { name: 'London weekend' })).not.toBeInTheDocument();
    expect(sessionStorage.getItem('ff-car-management:alice:tracker-one')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry status updates' }));
    expect(await screen.findByRole('button', { name: 'Resume tracking' })).toBeEnabled();
    expect(fetcher.mock.calls.filter(([, init]) => init.method === 'PATCH')).toHaveLength(1);
  });
  it('recovers an account-list failure and reassigns only to an explicitly selected account', async () => {
    const initial = fixture(), next = structuredClone(initial); initial.canReassign = true; next.canReassign = true; next.tracker.userId = 'bob'; next.tracker.revision++;
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('Network down')).mockResolvedValueOnce(response({ users: [{ id: 'alice', username: 'alice', displayName: 'Alice' }, { id: 'bob', username: 'bob', displayName: 'Bob' }] })).mockResolvedValueOnce(response({ tracker: next.tracker })).mockResolvedValueOnce(response(next)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={initial} />);
    await screen.findByText(/The account list could not be loaded/);
    fireEvent.click(screen.getByRole('button', { name: 'Retry account list' }));
    await screen.findByRole('option', { name: 'Bob' });
    expect(screen.getByRole('button', { name: 'Reassign tracker' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('New owner'), { target: { value: 'bob' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reassign tracker' }));
    await screen.findByText('Settings saved and confirmed.');
    expect(JSON.parse(fetcher.mock.calls[2]![1].body)).toEqual({ userId: 'bob' });
    expect(new Headers(fetcher.mock.calls[2]![1].headers).get('X-Car-Revision')).toBe('0');
  });
  it('hides history if a successful reassignment is followed by lost access', async () => {
    const initial = fixture(), next = structuredClone(initial); initial.canReassign = true; next.tracker.userId = 'bob'; next.tracker.revision++;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ users: [{ id: 'bob', username: 'bob', displayName: 'Bob' }] })).mockResolvedValueOnce(response({ tracker: next.tracker })).mockResolvedValueOnce(response(null, 404)));
    render(<View initial={initial} />); await screen.findByRole('option', { name: 'Bob' });
    fireEvent.change(screen.getByLabelText('New owner'), { target: { value: 'bob' } }); fireEvent.click(screen.getByRole('button', { name: 'Reassign tracker' }));
    await screen.findByRole('link', { name: 'Sign in' });
    expect(screen.queryByRole('heading', { name: 'London weekend' })).not.toBeInTheDocument();
    expect(screen.queryByText('Settings saved and confirmed.')).not.toBeInTheDocument();
  });
  it.each(['edit', 'delete'] as const)('does not retry a recovery pause at a newer revision when the unknown original %s wins', async original => {
    const initial = fixture(), next = structuredClone(initial); next.tracker.revision++; next.tracker.label = 'Earlier edit committed';
    sessionStorage.setItem('ff-car-management:alice:tracker-one', '{broken');
    const fetcher = vi.fn().mockResolvedValueOnce(response(initial)).mockResolvedValueOnce(response(null, 412)).mockResolvedValueOnce(original === 'delete' ? response(null, 404) : response(next)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Pause and recover controls' }));
    if (original === 'delete') {
      await screen.findByRole('link', { name: 'Sign in' });
      expect(screen.queryByRole('heading', { name: 'London weekend' })).not.toBeInTheDocument();
    } else {
      await screen.findByRole('button', { name: 'Use current saved settings' });
      expect(screen.getByRole('button', { name: 'Pause tracking' })).toBeDisabled();
    }
    expect(fetcher.mock.calls.filter(([, init]) => init.method === 'PATCH')).toHaveLength(1);
    expect(new Headers(fetcher.mock.calls[1]![1].headers).get('X-Car-Revision')).toBe('0');
  });
  it('does not send a recovery pause after its preliminary read is superseded by unmount', async () => {
    const initial = fixture(); sessionStorage.setItem('ff-car-management:alice:tracker-one', '{broken');
    let finish: (value: Response) => void = () => { throw new Error('Read did not start'); };
    const fetcher = vi.fn().mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; })); vi.stubGlobal('fetch', fetcher);
    const view = render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Pause and recover controls' })); view.unmount();
    await act(async () => { finish(response(initial)); });
    expect(fetcher.mock.calls.filter(([, init]) => init.method === 'PATCH')).toHaveLength(0);
    expect(sessionStorage.getItem('ff-car-management:alice:tracker-one')).toBe('{broken');
  });
  it('explicitly replaces an unresolved deletion with a pause at the same revision', async () => {
    const initial = fixture(), next = structuredClone(initial); next.tracker.active = false; next.tracker.revision++;
    sessionStorage.setItem('ff-car-management:alice:tracker-one', JSON.stringify({ trackerId: 'tracker-one', revision: 0, action: { kind: 'delete' } }));
    const fetcher = vi.fn().mockResolvedValueOnce(response(initial)).mockResolvedValueOnce(response({ tracker: next.tracker })).mockResolvedValueOnce(response(next)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Pause and close pending action' }));
    expect(await screen.findByRole('button', { name: 'Resume tracking' })).toBeEnabled();
    expect(fetcher.mock.calls.filter(([, init]) => init.method === 'DELETE')).toHaveLength(0);
    expect(new Headers(fetcher.mock.calls[1]![1].headers).get('X-Car-Revision')).toBe('0');
    expect(JSON.parse(fetcher.mock.calls[1]![1].body)).toEqual({ active: false });
  });
  it('does not send a pause when the original action is already resolved by the recovery read', async () => {
    const initial = fixture(), next = structuredClone(initial); next.tracker.label = 'Earlier change'; next.tracker.revision++;
    sessionStorage.setItem('ff-car-management:alice:tracker-one', JSON.stringify({ trackerId: 'tracker-one', revision: 0, action: { kind: 'settings', options: initial.tracker.options, label: 'Earlier change' } }));
    const fetcher = vi.fn().mockResolvedValue(response(next)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Pause and close pending action' }));
    await screen.findByText('The requested settings are currently saved.');
    expect(screen.getByRole('button', { name: 'Pause tracking' })).toBeEnabled();
    expect(fetcher.mock.calls.filter(([, init]) => init.method === 'PATCH')).toHaveLength(0);
  });
  it('keeps a known pending intent when the replacement pause cannot be persisted', async () => {
    const initial = fixture(), saved = JSON.stringify({ trackerId: 'tracker-one', revision: 0, action: { kind: 'delete' } });
    sessionStorage.setItem('ff-car-management:alice:tracker-one', saved);
    vi.spyOn(Object.getPrototypeOf(sessionStorage), 'setItem').mockImplementation(() => { throw new Error('Quota exceeded'); });
    const fetcher = vi.fn().mockResolvedValue(response(initial)); vi.stubGlobal('fetch', fetcher);
    render(<View initial={initial} />); fireEvent.click(screen.getByRole('button', { name: 'Pause and close pending action' }));
    await screen.findByText(/Browser recovery storage/);
    expect(fetcher.mock.calls.filter(([, init]) => init.method === 'PATCH')).toHaveLength(0);
    expect(sessionStorage.getItem('ff-car-management:alice:tracker-one')).toBe(saved);
    expect(screen.getByRole('button', { name: 'Pause tracking' })).toBeDisabled();
  });
});

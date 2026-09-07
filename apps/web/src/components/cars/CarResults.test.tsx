/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { carOfferFixture, carReportFixture, carSearchFixture } from '@/test/car-fixtures';
import type { CarSearch, CarSearchReport } from '@/lib/cars/types';
import { MAX_CAR_OFFER_AGE_MS } from '@/lib/cars/pricing';
import { carRequirementTerms } from '@/lib/cars/requirements';
import { CarResults } from './CarResults';
import { CarTrackingOptions } from './CarTrackingOptions';
import { defaultCarOptionsDraft } from './presentation';
import en from '../../../messages/en/cars.json';
import es from '../../../messages/es/cars.json';
import fr from '../../../messages/fr/cars.json';
import de from '../../../messages/de/cars.json';
import pt from '../../../messages/pt/cars.json';

vi.unmock('next-intl');
const locales = { en, es, fr, de, pt };
function Results({ report = carReportFixture(), status = 'success', locale = 'en', search = carSearchFixture() }: { report?: CarSearchReport; status?: string; locale?: keyof typeof locales; search?: CarSearch }) {
  return <NextIntlClientProvider locale={locale} messages={locales[locale]}><CarResults actorScope="alice" searchId="search-one" search={search} report={report} status={status} /></NextIntlClientProvider>;
}
beforeEach(() => { sessionStorage.clear(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('rental results and honest tracking controls', () => {
  it('separates a verified rental total from unknown deposit and liability', async () => {
    render(<Results />);
    expect(screen.getByRole('heading', { name: /Example car or similar/ })).toBeInTheDocument();
    expect(screen.getByText('Verified total')).toBeInTheDocument();
    expect(screen.getByText('For the whole rental')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Track this rental' })).toBeEnabled();
    const user = userEvent.setup(); await user.click(screen.getByText('Charges, extras and rental conditions'));
    const deposit = screen.getByText('Security deposit').closest('details')!;
    expect(within(deposit).getByText(/Unknown · Unknown/)).toBeInTheDocument();
    expect(deposit).not.toHaveTextContent('£0.00');
    expect(screen.getByText(/Unknown does not mean zero/)).toBeInTheDocument();
    expect(screen.getAllByText(/Europe\/London/)).toHaveLength(2);
  });
  it('keeps a verified offer trackable alongside a failed provider and incomplete candidate', () => {
    const report = carReportFixture();
    report.providers[1]!.status = 'blocked'; report.successfulProviders = 1;
    report.errors = [{ source: 'autoeurope', message: 'Provider blocked this check' }];
    report.candidates = [{ source: 'autoeurope', supplier: 'Other supplier', model: 'Unverified car', bookingUrl: 'https://book.autoeurope.com/offer', observedAt: new Date().toISOString(), advertisedTotal: { ...carOfferFixture().total, status: 'estimated', sourceUrl: 'https://book.autoeurope.com/offer', value: { currency: 'GBP', minor: 7000 } }, requirements: [], reasons: ['Mandatory cover is not priced'] }];
    render(<Results report={report} status="partial" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Provider blocked this check');
    expect(screen.getByRole('button', { name: 'Track this rental' })).toBeEnabled();
    const candidates = screen.getByRole('region', { name: 'Offers needing verification' });
    expect(candidates).toHaveTextContent('Mandatory cover is not priced');
    expect(candidates).toHaveTextContent('Advertised total · unverified');
    expect(within(candidates).queryByRole('button')).not.toBeInTheDocument();
  });
  it('reports bounded provider coverage without implying market-wide availability', () => {
    const report = carReportFixture(); report.providers[0] = { source: 'discovercars', status: 'running', checked: 1, discoveredVisible: 20, limit: 8, truncated: true };
    render(<Results report={report} status="running" />);
    expect(screen.getByRole('list', { name: 'Provider progress' })).toHaveTextContent('1 of 20 visible offers checked');
    expect(screen.getByText(/Check limited to 8 offers/)).toBeInTheDocument();
    expect(screen.getByText(/not the entire market/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Track this rental' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('when the search finishes');
  });
  it('does not show a completed empty result while checks are running', () => {
    const report = carReportFixture([]); render(<Results report={report} status="running" />);
    expect(screen.queryByText(/returned no verified offers/)).not.toBeInTheDocument();
  });
  it.each(['cancelled', 'failed'] as const)('makes the terminal %s state clear even when earlier provider progress was running', status => {
    const report = carReportFixture(); report.providers[0]!.status = 'running';
    render(<Results report={report} status={status} />);
    expect(screen.getByRole('status')).toHaveTextContent(en.Cars[status]);
    expect(screen.getByRole('button', { name: 'Track this rental' })).toBeDisabled();
  });
  it('disables expired offers while idle without requiring a user interaction', async () => {
    vi.useFakeTimers(); const offer = carOfferFixture(new Date(Date.now() - MAX_CAR_OFFER_AGE_MS + 1000).toISOString());
    render(<Results report={carReportFixture([offer])} />);
    expect(screen.getByRole('button', { name: 'Track this rental' })).toBeEnabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1002); });
    expect(screen.getByRole('button', { name: 'Track this rental' })).toBeDisabled();
    expect(screen.getByText(/Rental quote has expired/)).toBeInTheDocument();
  });
  it('rechecks eligibility at submission even if a background tab delayed the expiry timer', () => {
    vi.useFakeTimers(); const offer = carOfferFixture(); const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    render(<Results report={carReportFixture([offer])} />);
    vi.setSystemTime(Date.now() + MAX_CAR_OFFER_AGE_MS + 1);
    fireEvent.click(screen.getByRole('button', { name: 'Track this rental' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Refresh the search'); expect(fetcher.mock.calls).toHaveLength(0);
  });
  it('excludes an unconfirmed tax total and omits an unsafe provider link', () => {
    const offer = carOfferFixture(); offer.taxesIncluded.status = 'unknown'; offer.bookingUrl = 'javascript:alert(1)';
    render(<Results report={carReportFixture([offer])} />);
    expect(screen.getByRole('button', { name: 'Track this rental' })).toBeDisabled();
    expect(screen.getByText('Provider total · not verified')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'View on provider' })).not.toBeInTheDocument();
  });
  it('submits exact minor units and the chosen matching and alert settings using the keyboard', async () => {
    const requests: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init: RequestInit) => { requests.push(init); return new Response(JSON.stringify({ ok: true, data: { tracker: { id: 'tracker-one' }, creationKey: new Headers(init.headers).get('Idempotency-Key') } })); }));
    render(<Results />); const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Offer matching'), 'contract');
    await user.type(screen.getByLabelText('Alert at or below total (GBP)'), '99.99');
    await user.clear(screen.getByLabelText('Check every (hours)')); await user.type(screen.getByLabelText('Check every (hours)'), '6');
    await user.click(screen.getByLabelText('Notify me of new verified lows'));
    screen.getByRole('button', { name: 'Track this rental' }).focus(); await user.keyboard('{Enter}');
    expect(await screen.findByRole('link', { name: 'Open rental tracker' })).toHaveAttribute('href', '/cars/tracker-one');
    expect(JSON.parse(requests[0]!.body as string)).toMatchObject({ mode: 'contract', target: { currency: 'GBP', minor: 9999 }, scrapeInterval: 6, notifyLows: false, searchId: 'search-one', offerId: 'verified-quote' });
  });
  it('explains invalid target precision and restores tracking after correction', async () => {
    render(<Results />); const user = userEvent.setup(), target = screen.getByLabelText('Alert at or below total (GBP)');
    await user.type(target, '10.001'); expect(screen.getByRole('button', { name: 'Track this rental' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('smallest units');
    await user.clear(target); await user.type(target, '10.01');
    expect(screen.getByRole('button', { name: 'Track this rental' })).toBeEnabled();
  });
  it('shows the original immutable settings when recovering after a reload', async () => {
    let calls = 0; vi.stubGlobal('fetch', vi.fn().mockImplementation(async (url: string, init: RequestInit) => { if (++calls === 1) throw new TypeError('Lost acknowledgement'); return new Response(JSON.stringify({ ok: true, data: { tracker: { id: 'recovered' }, creationKey: new Headers(init.headers).get('Idempotency-Key') } })); }));
    const first = render(<Results />); fireEvent.change(screen.getByLabelText('Offer matching'), { target: { value: 'contract' } });
    fireEvent.change(screen.getByLabelText('Alert at or below total (GBP)'), { target: { value: '85.75' } });
    fireEvent.click(screen.getByRole('button', { name: 'Track this rental' })); await screen.findByText('Creation outcome not yet confirmed'); first.unmount();
    render(<Results />); expect(screen.getByLabelText('Settings being recovered')).toHaveTextContent('This rental contract');
    expect(screen.getByLabelText('Settings being recovered')).toHaveTextContent('£85.75');
    expect(screen.getByLabelText('Settings being recovered')).toHaveTextContent('Example supplier · Example car · verified-quote');
    expect(screen.queryByLabelText('Offer matching')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Recover this creation' }));
    expect(await screen.findByRole('link', { name: 'Open rental tracker' })).toHaveAttribute('href', '/cars/recovered');
  });
  it.each(Object.keys(locales) as (keyof typeof locales)[])('renders complete result controls in %s', locale => {
    render(<Results locale={locale} />); const copy = locales[locale].Cars;
    expect(screen.getByRole('heading', { name: copy.results })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: copy.track })).toBeEnabled();
    expect(screen.getByText(copy.securityHelp)).toBeInTheDocument();
    expect(screen.getByLabelText(copy.mode)).toHaveValue('best');
  });
  it('displays provider evidence as text without executing markup', async () => {
    const offer = carOfferFixture(); offer.deposit.text = '<script>window.compromised=true</script>';
    render(<Results report={carReportFixture([offer])} />); fireEvent.click(screen.getByText('Charges, extras and rental conditions'));
    fireEvent.click(screen.getByText('Security deposit'));
    await waitFor(() => expect(screen.getByText(offer.deposit.text)).toBeInTheDocument());
    expect(document.querySelector('script')).toBeNull();
    for (const link of screen.getAllByRole('link', { name: 'Provider evidence' })) expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
  it.each([['JPY', '1234'], ['KWD', '1234.555']] as const)('uses a valid smallest-unit example for %s', (currency, example) => {
    render(<NextIntlClientProvider locale="en" messages={en}><CarTrackingOptions currency={currency} value={defaultCarOptionsDraft} onChange={() => undefined} disabled={false} invalid={false} /></NextIntlClientProvider>);
    expect(screen.getByRole('textbox')).toHaveAccessibleDescription(`Optional. Use ${example}, without thousands separators.`);
  });
  it('shows a requested extra charge once and keeps conditional supplier requirements visible', () => {
    const search = carSearchFixture(), offer = carOfferFixture();
    search.extras.childSeats = [{ category: 'child', quantity: 1 }];
    offer.contract.extras = [{ kind: 'child_seat', productId: 'seat-child', category: 'child', quantity: 1 }];
    offer.extras = [{ ...offer.contract.extras[0]!, availability: { ...offer.available }, eligibility: { ...offer.driverEligible }, included: { ...offer.available, value: false }, chargeId: 'child-seat-charge' }];
    offer.charges.push({ id: 'child-seat-charge', label: 'Child seat for the whole rental', kind: 'extra', payment: 'pickup', amount: { ...offer.total, value: { currency: 'GBP', minor: 2000 } } });
    offer.total.value = { currency: 'GBP', minor: 12000 };
    offer.requirements = [{ kind: 'flight_ticket', appliesTo: 'main_driver', condition: 'Present a return flight ticket', evidence: { ...offer.available, value: 'The supplier requires a return flight ticket' } }];
    offer.contract.rentalRequirements = carRequirementTerms(offer.requirements);
    render(<Results report={carReportFixture([offer])} search={search} />);
    expect(screen.getByRole('button', { name: 'Track this rental' })).toBeEnabled();
    fireEvent.click(screen.getByText('Charges, extras and rental conditions'));
    expect(screen.getAllByText('Child seat for the whole rental · Pay at pickup')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Child seat × 1' })).toBeInTheDocument();
    expect(screen.getByText('Main driver: Present a return flight ticket')).toBeInTheDocument();
    expect(screen.getByText(/does not confirm that you personally meet/)).toBeInTheDocument();
  });
});

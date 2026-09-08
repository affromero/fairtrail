/** @vitest-environment jsdom */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { carOfferFixture, carReportFixture, carSearchFixture } from '@/test/car-fixtures';
import { carContractHash } from '@/lib/cars/selection';
import type { CarSearch, CarSearchReport } from '@/lib/cars/types';
import { CarResults } from './CarResults';
import en from '../../../messages/en/cars.json';
import es from '../../../messages/es/cars.json';
import fr from '../../../messages/fr/cars.json';
import de from '../../../messages/de/cars.json';
import pt from '../../../messages/pt/cars.json';

vi.unmock('next-intl');
const locales = { en, es, fr, de, pt }, choiceId = 'c51f31ce-1f53-486b-b84c-2817429f3a73';
function report(): CarSearchReport {
  const value = carReportFixture();
  value.protection = [{ offerId: 'verified-quote', status: 'complete', error: null, choices: [{ id: choiceId, source: 'discovercars', productId: '35',
    name: 'Full Coverage', termsSummary: 'Reimbursement subject to exclusions. Tyres excluded.', policyLinks: ['https://www.sincerainsurance.com/policy'],
    observedExtraPrice: { currency: 'GBP', minor: 1800 }, sourceUrl: 'https://www.discovercars.com/offer/coverage/example', observedAt: value.offers[0]!.observedAt }] }];
  return value;
}
function Surface({ value = report(), search = carSearchFixture(), locale = 'en', status = 'success', disabled = false }: { value?: CarSearchReport; search?: CarSearch; locale?: keyof typeof locales; status?: string; disabled?: boolean }) {
  return <NextIntlClientProvider locale={locale} messages={locales[locale]}><CarResults actorScope="alice" searchId="original" search={search} report={value} status={status} mutationsDisabled={disabled} /></NextIntlClientProvider>;
}
function protectedQuote() {
  const offer = carOfferFixture(), search = carSearchFixture();
  search.sources = ['discovercars']; search.extras.protection = [{ source: 'discovercars', productId: '35' }];
  search.protectionRecheck = { searchId: 'base-search', offerId: offer.id, choiceId, baseContractHash: carContractHash(offer.contract), baseCoverageTerms: offer.contract.coverageTerms };
  const identity = { kind: 'protection' as const, productId: '35', quantity: 1, category: null };
  offer.contract.extras.push(identity); offer.contract.coverageProductIds.push('35');
  offer.contract.coverageTerms += ' Current exclusions apply.';
  offer.extras.push({ ...identity, availability: { ...offer.available, text: 'Full Coverage' }, eligibility: { ...offer.driverEligible, text: 'Current exclusions apply.' }, included: { ...offer.available, value: false }, chargeId: 'protection' });
  offer.charges.push({ id: 'protection', label: 'Full Coverage', kind: 'extra', payment: 'now', amount: { ...offer.total, value: { currency: 'GBP', minor: 1800 } } });
  offer.total.value = { currency: 'GBP', minor: 11800 };
  return { search, value: carReportFixture([offer], ['discovercars']) };
}
beforeEach(() => sessionStorage.clear());
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('protection options and fresh rental review', () => {
  it('requests protection for itemized seat estimates while keeping tracking disabled', async () => {
    const value = report(), search = carSearchFixture(), offer = value.offers[0]!;
    search.extras.childSeats = [{ category: 'child', quantity: 2 }];
    const extra = { kind: 'child_seat' as const, category: 'child' as const, quantity: 2, productId: 'child-seat' };
    const unknown = { ...offer.available, value: null, status: 'unknown' as const, text: 'Supplier availability and suitability require confirmation.' };
    offer.contract.extras.push(extra);
    offer.extras.push({ ...extra, availability: unknown, eligibility: unknown, included: { ...offer.available, value: false }, chargeId: 'seats' });
    offer.charges.push({ id: 'seats', label: 'Two child seats', kind: 'extra', payment: 'pickup', amount: { ...offer.total, value: { currency: 'GBP', minor: 4000 }, status: 'estimated' } });
    offer.total = { ...offer.total, value: { currency: 'GBP', minor: 14000 }, status: 'estimated' };
    const requests: unknown[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true, data: { id: 'estimated-child', status: 'queued', creationKey: new Headers(init.headers).get('Idempotency-Key') } }));
    }));
    render(<Surface value={value} search={search} />);
    const user = userEvent.setup();
    expect(screen.getByRole('button', { name: en.Cars.track })).toBeDisabled();
    expect(screen.getByText(en.Cars.unverifiedTotal)).toBeVisible();
    await user.click(screen.getByText(en.Cars.Protection.options));
    await user.click(screen.getByRole('radio', { name: /Full Coverage/ }));
    await user.click(screen.getByLabelText(en.Cars.Protection.reviewOption));
    await user.click(screen.getByRole('button', { name: en.Cars.Protection.recheck }));
    expect(await screen.findByRole('link', { name: en.Cars.Protection.open })).toHaveAttribute('href', '/cars/search/estimated-child');
    expect(requests).toEqual([{ url: '/api/cars/search/original/protection', body: { offerId: offer.id, choiceId } }]);
    expect(screen.getByRole('button', { name: en.Cars.track })).toBeDisabled();
  });
  it.each(Object.keys(locales) as (keyof typeof locales)[])('requires an explicit option and terms review in %s without adding its observed price to the base total', async locale => {
    const copy = locales[locale].Cars, requests: { url: string; body: unknown }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ ok: true, data: { id: 'new-check', status: 'queued', creationKey: new Headers(init.headers).get('Idempotency-Key') } }));
    }));
    render(<Surface locale={locale} />); const user = userEvent.setup();
    expect(screen.getByText(copy.Protection.options).closest('details')).not.toHaveAttribute('open');
    await user.click(screen.getByText(copy.Protection.options));
    const radio = screen.getByRole('radio', { name: /Full Coverage/ }); expect(radio).not.toBeChecked();
    expect(screen.getByRole('button', { name: copy.Protection.recheck })).toBeDisabled();
    await user.click(radio); expect(screen.getByRole('button', { name: copy.Protection.recheck })).toBeDisabled();
    expect(screen.getByRole('region', { name: copy.Protection.terms })).toHaveTextContent('Tyres excluded.');
    const policy = screen.getByRole('link', { name: copy.Protection.policy.replace('{number}', '1') });
    expect(policy).toHaveAttribute('rel', 'noopener noreferrer'); expect(policy).toHaveAttribute('href', 'https://www.sincerainsurance.com/policy');
    expect(screen.queryByText(/118[.,]00/)).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(copy.Protection.reviewOption));
    screen.getByRole('button', { name: copy.Protection.recheck }).focus(); await user.keyboard('{Enter}');
    expect(await screen.findByRole('link', { name: copy.Protection.open })).toHaveAttribute('href', '/cars/search/new-check');
    expect(requests).toEqual([{ url: '/api/cars/search/original/protection', body: { offerId: 'verified-quote', choiceId } }]);
    expect(screen.getByRole('button', { name: copy.track })).toBeDisabled();
  });
  it('requires review of fresh protected terms and resets it when price or terms change', () => {
    const data = protectedQuote(), mounted = render(<Surface {...data} />);
    expect(screen.getByRole('link', { name: en.Cars.Protection.original })).toHaveAttribute('href', '/cars/search/base-search');
    expect(screen.getByRole('region', { name: en.Cars.Protection.freshTerms })).toHaveTextContent('Current exclusions apply.');
    expect(screen.getByRole('button', { name: en.Cars.track })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(en.Cars.Protection.reviewFresh));
    expect(screen.getByRole('button', { name: en.Cars.track })).toBeEnabled();
    const next = structuredClone(data); next.value.offers[0]!.total.value!.minor += 100; next.value.offers[0]!.charges[0]!.amount.value!.minor += 100;
    mounted.rerender(<Surface {...next} />);
    expect(screen.getByLabelText(en.Cars.Protection.reviewFresh)).not.toBeChecked(); expect(screen.getByRole('button', { name: en.Cars.track })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(en.Cars.Protection.reviewFresh));
    next.value.offers[0]!.extras[0]!.eligibility.text = 'Updated exclusions.';
    mounted.rerender(<Surface {...next} />);
    expect(screen.getByRole('button', { name: en.Cars.track })).toBeDisabled();
  });
  it('allows a fresh recheck of an expired base quote only after its search has completed', () => {
    const value = report(), old = new Date(Date.now() - 60 * 60_000).toISOString();
    value.offers[0] = carOfferFixture(old); value.protection![0]!.choices[0]!.observedAt = old;
    const mounted = render(<Surface value={value} status="running" />);
    fireEvent.click(screen.getByText(en.Cars.Protection.options)); expect(screen.getByRole('radio')).toBeDisabled();
    mounted.rerender(<Surface value={value} />);
    fireEvent.click(screen.getByRole('radio')); fireEvent.click(screen.getByLabelText(en.Cars.Protection.reviewOption));
    expect(screen.getByRole('button', { name: en.Cars.Protection.recheck })).toBeEnabled();
    expect(screen.getByRole('button', { name: en.Cars.track })).toBeDisabled();
  });
  it('distinguishes missing, failed and empty discovery while keeping the base quote inspectable', () => {
    const value = report(); delete value.protection;
    const mounted = render(<Surface value={value} />); fireEvent.click(screen.getByText(en.Cars.Protection.options));
    expect(screen.getByText(en.Cars.Protection.unchecked)).toBeVisible();
    value.protection = [{ offerId: 'verified-quote', status: 'failed', choices: [], error: 'Provider check failed' }];
    mounted.rerender(<Surface value={value} />); expect(screen.getByText(en.Cars.Protection.failed)).toBeVisible();
    value.protection[0] = { offerId: 'verified-quote', status: 'complete', choices: [], error: null };
    mounted.rerender(<Surface value={value} />); expect(screen.getByText(en.Cars.Protection.empty)).toBeVisible();
    expect(screen.getByRole('button', { name: en.Cars.track })).toBeEnabled();
  });
  it('omits unsafe policy links and renders provider terms as text', () => {
    const value = report(); value.protection![0]!.choices[0]!.policyLinks = ['javascript:alert(1)', 'https://www.sincerainsurance.com.evil.test/policy'];
    value.protection![0]!.choices[0]!.termsSummary = '<script>window.compromised=true</script>';
    render(<Surface value={value} />); fireEvent.click(screen.getByText(en.Cars.Protection.options)); fireEvent.click(screen.getByRole('radio'));
    expect(screen.getByText('<script>window.compromised=true</script>')).toBeVisible(); expect(document.querySelector('script')).toBeNull();
    expect(within(screen.getByRole('region', { name: en.Cars.Protection.terms })).queryByRole('link')).not.toBeInTheDocument();
  });
  it.each(['track', 'protection'] as const)('keeps a simultaneous second mutation locked when %s starts first', async first => {
    const requests: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => { requests.push(url); throw new TypeError('Offline'); }));
    render(<Surface />); fireEvent.click(screen.getByText(en.Cars.Protection.options)); fireEvent.click(screen.getByRole('radio')); fireEvent.click(screen.getByLabelText(en.Cars.Protection.reviewOption));
    const track = screen.getByRole('button', { name: en.Cars.track }), protection = screen.getByRole('button', { name: en.Cars.Protection.recheck });
    await act(async () => { fireEvent.click(first === 'track' ? track : protection); fireEvent.click(first === 'track' ? protection : track); });
    expect(requests).toEqual([first === 'track' ? '/api/cars' : '/api/cars/search/original/protection']);
    expect(track).toBeDisabled(); expect(protection).toBeDisabled();
    expect(screen.getByRole('button', { name: first === 'track' ? en.Cars.retryCreation : en.Cars.Protection.retry })).toBeEnabled();
  });
  it('propagates protection-side permanent closure to tracker controls without waiting for polling', async () => {
    sessionStorage.setItem('ff-car-protection:alice:original', '{');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { id: 'original', trackingClosed: true } }))));
    render(<Surface />); fireEvent.click(screen.getByText(en.Cars.closeTrackingTitle));
    expect(screen.getByText(en.Cars.Protection.closeHelp)).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: en.Cars.closeTrackingConfirm }));
    expect(await screen.findByRole('heading', { name: en.Cars.trackingClosed })).toBeVisible();
    expect(screen.getByRole('button', { name: en.Cars.track })).toBeDisabled(); expect(screen.queryByLabelText(en.Cars.mode)).not.toBeInTheDocument();
  });
});

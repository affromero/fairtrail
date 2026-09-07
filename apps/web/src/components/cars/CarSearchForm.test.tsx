/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CarSearchForm } from './CarSearchForm';
import type { CarLocationChoice } from '@/lib/cars/location-types';
import { carFormOptions } from '@/lib/cars/form-options';
import en from '../../../messages/en/cars.json';
import es from '../../../messages/es/cars.json';
import pt from '../../../messages/pt/cars.json';
import fr from '../../../messages/fr/cars.json';
import de from '../../../messages/de/cars.json';

vi.unmock('next-intl');
const place: CarLocationChoice = { id: 'ourairports:2434', version: 'a'.repeat(64), name: 'London Heathrow Airport', kind: 'airport', city: 'London', country: 'GB', region: 'England', timeZone: 'Europe/London', latitude: 51.47, longitude: -.45, iata: 'LHR' };
const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));
const surface = (locale = 'en', messages = en) => <NextIntlClientProvider locale={locale} messages={messages}><CarSearchForm actorScope="alice" defaultCurrency="GBP" defaultSources={['discovercars', 'autoeurope']} options={carFormOptions(locale)} /></NextIntlClientProvider>;
beforeEach(() => { vi.useFakeTimers(); sessionStorage.clear(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
async function completeForm(copy = en.Cars.Search) {
  fireEvent.change(screen.getByRole('combobox', { name: copy.pickupLocation }), { target: { value: 'LHR' } });
  await act(async () => { await vi.advanceTimersByTimeAsync(250); });
  fireEvent.click(screen.getByRole('option', { name: /LHR · London Heathrow/ }));
  const year = new Date().getUTCFullYear() + 1;
  fireEvent.change(screen.getByLabelText(copy.pickupDate), { target: { value: `${year}-01-15` } });
  fireEvent.change(screen.getByLabelText(copy.returnDate), { target: { value: `${year}-01-18` } });
  for (const field of screen.getAllByLabelText(copy.localTime)) fireEvent.change(field, { target: { value: '11:00' } });
  fireEvent.change(screen.getByLabelText(copy.driverAge), { target: { value: '35' } });
  fireEvent.change(screen.getByLabelText(copy.licenceYears), { target: { value: '5' } });
  fireEvent.change(screen.getByLabelText(copy.residence), { target: { value: 'GB' } });
}

describe('independent rental search form', () => {
  it('accepts a local comma decimal without changing the currency or rounding minor units', async () => {
    let submitted: Record<string, unknown> | undefined;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith('/api/cars/locations?')) return response([place]);
      submitted = JSON.parse(String(init.body));
      return response({ id: 'localized-search', status: 'queued', creationKey: new Headers(init.headers).get('Idempotency-Key') });
    }));
    render(surface('de', de)); await completeForm(de.Cars.Search);
    fireEvent.change(screen.getByLabelText('Maximaler Mietgesamtpreis (GBP)'), { target: { value: '150,50' } });
    fireEvent.click(screen.getByRole('button', { name: de.Cars.Search.search })); await settle();
    expect(submitted).toMatchObject({ currency: 'GBP', filters: { maxTotal: { currency: 'GBP', minor: 15050 } } });
  });
  it('recovers a transient pre-send storage failure with its original identity and no duplicate request', async () => {
    const writes: string[] = [], posts: RequestInit[] = [];
    const prototype = Object.getPrototypeOf(sessionStorage) as Storage, original = prototype.setItem; let blocked = true;
    vi.spyOn(prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      writes.push(value); if (blocked) throw new DOMException('Storage denied'); original.call(this, key, value);
    });
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith('/api/cars/locations?')) return response([place]);
      posts.push(init); return response({ id: 'recovered-search', status: 'queued', creationKey: new Headers(init.headers).get('Idempotency-Key') });
    }));
    render(surface()); await completeForm();
    fireEvent.click(screen.getByRole('button', { name: en.Cars.Search.search })); await settle();
    expect(posts).toEqual([]); blocked = false;
    fireEvent.click(screen.getByRole('button', { name: en.Cars.Search.retryStorage }));
    fireEvent.click(screen.getByRole('button', { name: en.Cars.Search.recoverSearch })); await settle();
    expect(screen.getByRole('link', { name: en.Cars.Search.openSearch })).toHaveAttribute('href', '/cars/search/recovered-search');
    expect(new Set(writes).size).toBe(1);
    expect(new Headers(posts[0]!.headers).get('Idempotency-Key')).toBe(JSON.parse(writes[0]!).key);
  });
  it('never silently discards corrupt recovery data and requires confirmed successful removal', async () => {
    const storageKey = 'ff-car-search:alice'; sessionStorage.setItem(storageKey, '{broken');
    render(surface());
    expect(screen.getByRole('button', { name: en.Cars.Search.search })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: en.Cars.Search.retryStorage }));
    expect(sessionStorage.getItem(storageKey)).toBe('{broken');
    fireEvent.click(screen.getByText(en.Cars.Search.discardLabel));
    expect(screen.getByRole('button', { name: en.Cars.Search.confirmDiscard })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(en.Cars.Search.discardConfirm));
    const remove = vi.spyOn(Object.getPrototypeOf(sessionStorage) as Storage, 'removeItem').mockImplementation(() => { throw new DOMException('Storage denied'); });
    fireEvent.click(screen.getByRole('button', { name: en.Cars.Search.confirmDiscard }));
    expect(screen.getByRole('button', { name: en.Cars.Search.search })).toBeDisabled();
    expect(sessionStorage.getItem(storageKey)).toBe('{broken'); remove.mockRestore();
    fireEvent.click(screen.getByLabelText(en.Cars.Search.discardConfirm));
    fireEvent.click(screen.getByRole('button', { name: en.Cars.Search.confirmDiscard }));
    expect(sessionStorage.getItem(storageKey)).toBeNull();
    expect(screen.getByRole('button', { name: en.Cars.Search.search })).toBeEnabled();
  });
  it.each([{ locale: 'en', messages: en }, { locale: 'es', messages: es }, { locale: 'pt', messages: pt }, { locale: 'fr', messages: fr }, { locale: 'de', messages: de }])('offers a translated search without inventing driver details in $locale', ({ locale, messages }) => {
    render(surface(locale, messages));
    expect(screen.getByRole('heading', { name: messages.Cars.Search.findCar })).toBeInTheDocument();
    expect(screen.getByLabelText(messages.Cars.Search.driverAge)).toHaveValue(null);
    expect(screen.getByLabelText(messages.Cars.Search.residence)).toHaveValue('');
    expect(screen.getByLabelText(messages.Cars.Search.currency)).toHaveValue('GBP');
  });
  it('sends catalog identities and explicit local rental details, then opens the acknowledged search', async () => {
    const posts: RequestInit[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith('/api/cars/locations?')) return response([place]);
      posts.push(init);
      return response({ id: 'search-created', status: 'queued', creationKey: new Headers(init.headers).get('Idempotency-Key') });
    }));
    render(surface()); await completeForm();
    fireEvent.click(screen.getByRole('button', { name: en.Cars.Search.search })); await settle();
    expect(screen.getByRole('link', { name: en.Cars.Search.openSearch })).toHaveAttribute('href', '/cars/search/search-created');
    const body = JSON.parse(String(posts[0]!.body));
    expect(body).toMatchObject({ pickup: { id: place.id, version: place.version }, dropoff: { id: place.id, version: place.version }, driver: { age: 35, licenceYears: 5, residenceCountry: 'GB' }, currency: 'GBP', sources: ['discovercars', 'autoeurope'] });
    expect(Object.keys(body.pickup).sort()).toEqual(['id', 'version']);
    expect(Object.keys(body.pickupAt).sort()).toEqual(['date', 'time']);
  });
  it('recovers a lost acknowledgement across a remount with the same body and idempotency key', async () => {
    const posts: RequestInit[] = []; let offline = true;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      if (url.startsWith('/api/cars/locations?')) return response([place]);
      posts.push(init);
      if (offline) throw new TypeError('Lost response');
      return response({ id: 'original-search', status: 'running', creationKey: new Headers(init.headers).get('Idempotency-Key') });
    }));
    const mounted = render(surface()); await completeForm();
    fireEvent.click(screen.getByRole('button', { name: en.Cars.Search.search })); await settle();
    expect(screen.getByRole('button', { name: en.Cars.Search.search })).toBeDisabled();
    mounted.unmount(); offline = false; render(surface());
    fireEvent.click(screen.getByRole('button', { name: en.Cars.Search.recoverSearch })); await settle();
    expect(screen.getByRole('link', { name: en.Cars.Search.openSearch })).toHaveAttribute('href', '/cars/search/original-search');
    expect(posts[1]!.body).toBe(posts[0]!.body);
    expect(new Headers(posts[1]!.headers).get('Idempotency-Key')).toBe(new Headers(posts[0]!.headers).get('Idempotency-Key'));
  });
  it('keeps an unreadable rejection locked and refuses an acknowledgement for another request', async () => {
    let retry = false;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.startsWith('/api/cars/locations?')) return response([place]);
      return retry ? response({ id: 'wrong-search', status: 'queued', creationKey: crypto.randomUUID() }) : new Response('<html>Bad gateway</html>', { status: 400 });
    }));
    render(surface()); await completeForm();
    fireEvent.click(screen.getByRole('button', { name: en.Cars.Search.search })); await settle(); retry = true;
    fireEvent.click(screen.getByRole('button', { name: en.Cars.Search.recoverSearch })); await settle();
    expect(screen.getByRole('button', { name: en.Cars.Search.search })).toBeDisabled();
    expect(screen.queryByRole('link', { name: en.Cars.Search.openSearch })).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(en.Cars.Search.searchUncertain);
  });
  it('clears a selected location when its text is edited and allows keyboard selection', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response([place])));
    render(surface());
    const input = screen.getByRole('combobox', { name: en.Cars.Search.pickupLocation });
    fireEvent.change(input, { target: { value: 'LHR' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    fireEvent.keyDown(input, { key: 'ArrowDown' }); fireEvent.keyDown(input, { key: 'Enter' });
    expect(input).toHaveValue(place.name);
    expect(screen.getByText(/England · United Kingdom · Europe\/London/)).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'L' } });
    expect(screen.queryByText(/England · United Kingdom · Europe\/London/)).not.toBeInTheDocument();
  });
});

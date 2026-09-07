/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CarRecentSearches } from './CarRecentSearches';
import en from '../../../messages/en/cars.json';

vi.unmock('next-intl');
const row = (id: string) => { const now = new Date().toISOString(); return { id, trackerId: null, label: `Rental ${id}`, status: 'cancelled', createdAt: now, completedAt: now, error: null }; };
const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));
const surface = () => <NextIntlClientProvider locale="en" messages={en}><CarRecentSearches /></NextIntlClientProvider>;
const settle = async () => { await act(async () => { await vi.advanceTimersByTimeAsync(0); }); };
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('private standalone search history', () => {
  it('opens persisted searches and pages through older results without suggesting missing work failed', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => response(url.includes('cursor=') ? { searches: [row('older')], nextCursor: null } : { searches: [row('recent')], nextCursor: 'next-page' })));
    render(surface()); await settle();
    expect(screen.getByRole('link', { name: 'Rental recent' })).toHaveAttribute('href', '/cars/search/recent');
    expect(screen.getByText(en.Cars.Search.recentHelp)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: en.Cars.Search.loadOlder })); await settle();
    expect(screen.getByRole('link', { name: 'Rental older' })).toHaveAttribute('href', '/cars/search/older');
    expect(screen.queryByRole('link', { name: 'Rental recent' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: en.Cars.Search.loadOlder })).not.toBeInTheDocument();
  });
  it('retains the last page through transport failure but hides it after an HTML access-denied response', async () => {
    let outcome = 'ok';
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (outcome === 'offline') throw new TypeError('Offline');
      if (outcome === 'denied') return new Response('<html>Sign in</html>', { status: 401 });
      return response({ searches: [row('private')], nextCursor: null });
    }));
    render(surface()); await settle(); outcome = 'offline';
    fireEvent.click(screen.getByRole('button', { name: en.Cars.Search.refreshSearches })); await settle();
    expect(screen.getByRole('link', { name: 'Rental private' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(en.Cars.Search.searchListFailed); outcome = 'denied';
    fireEvent.click(screen.getByRole('button', { name: en.Cars.Search.refreshSearches })); await settle();
    expect(screen.queryByRole('link', { name: 'Rental private' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.Cars.signIn })).toBeInTheDocument();
  });
  it('rejects malformed or repeated pages without replacing the confirmed history', async () => {
    let bad = false;
    vi.stubGlobal('fetch', vi.fn(async () => response({ searches: bad ? [row('bad'), row('bad')] : [row('good')], nextCursor: null })));
    render(surface()); await settle(); bad = true;
    fireEvent.click(screen.getByRole('button', { name: en.Cars.Search.refreshSearches })); await settle();
    expect(screen.getByRole('link', { name: 'Rental good' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Rental bad' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(en.Cars.Search.searchListFailed);
  });
});

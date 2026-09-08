/** @vitest-environment jsdom */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HotelMapPreferences } from './HotelMapPreferences';
import { HotelMapAdmin } from './HotelMapAdmin';
import { DEFAULT_HOTEL_MAP_CONFIG, HOTEL_MAP_BROWSER_PREFERENCES_KEY } from '@/lib/hotels/map-config';

beforeEach(() => {
  const stored = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());
const response = (data: unknown) => new Response(JSON.stringify({ ok: true, data }), { headers: { 'Content-Type': 'application/json' } });

it('reports corrupt saved preferences and lets the user explicitly replace them', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  render(<HotelMapPreferences initial={{ style: 'invalid' }} account={false} />);
  expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/);
  expect(window.localStorage.getItem(HOTEL_MAP_BROWSER_PREFERENCES_KEY)).toBeNull();
  fireEvent.change(screen.getByLabelText('Map style'), { target: { value: 'bright' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save map preferences' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Changes saved');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(JSON.parse(window.localStorage.getItem(HOTEL_MAP_BROWSER_PREFERENCES_KEY)!)).toEqual({ version: 1, enabled: true, style: 'bright' });
  expect(fetcher).not.toHaveBeenCalled();
});

it('stores solo preferences in a browser-only key without account or map requests', async () => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  render(<HotelMapPreferences initial={null} account={false} />);
  fireEvent.change(screen.getByLabelText('Map style'), { target: { value: 'positron' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save map preferences' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Changes saved');
  expect(JSON.parse(window.localStorage.getItem(HOTEL_MAP_BROWSER_PREFERENCES_KEY)!)).toEqual({ version: 1, enabled: true, style: 'positron' });
  expect(fetcher).not.toHaveBeenCalled();
});

it('saves only personal map presentation preferences without contacting map providers', async () => {
  const fetcher = vi.fn().mockResolvedValue(response({}));
  vi.stubGlobal('fetch', fetcher);
  render(<HotelMapPreferences initial={null} actorScope="user:alice" />);
  fireEvent.change(screen.getByLabelText('Map style'), { target: { value: 'bright' } });
  fireEvent.click(screen.getByLabelText('Enable hotel maps'));
  fireEvent.click(screen.getByRole('button', { name: 'Save map preferences' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Changes saved');
  expect(fetcher.mock.calls.map(([url, init]) => ({ url, body: JSON.parse(init.body as string) }))).toEqual([{ url: '/api/account/settings', body: { hotelMapPreferences: { version: 1, style: 'bright', enabled: false }, hotelMapPreferencesRevision: 0 } }]);
});

it('retains editable preferences and reports a failed save without claiming success', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection lost')));
  render(<HotelMapPreferences initial={{ version: 1, style: 'positron', enabled: true }} actorScope="user:alice" />);
  fireEvent.click(screen.getByRole('button', { name: 'Save map preferences' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Connection lost');
  expect(screen.getByLabelText('Map style')).toHaveValue('positron');
  expect(screen.getByRole('button', { name: 'Save map preferences' })).toBeEnabled();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reload saved preferences' })).toBeEnabled();
});

it('saves isolated admin map configuration with its revision and no provider request', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response({ revision: 4, config: DEFAULT_HOTEL_MAP_CONFIG, actorScope: 'solo' })).mockResolvedValueOnce(response({ revision: 5, config: { ...DEFAULT_HOTEL_MAP_CONFIG, enabled: false }, actorScope: 'solo' }));
  vi.stubGlobal('fetch', fetcher);
  render(<HotelMapAdmin />);
  fireEvent.click(await screen.findByLabelText('Enable hotel maps'));
  fireEvent.click(screen.getByRole('button', { name: 'Save map configuration' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Changes saved');
  const writes = fetcher.mock.calls.filter(([, init]) => init?.method === 'PATCH');
  expect(writes.map(([url, init]) => ({ url, body: JSON.parse(init!.body as string) }))).toEqual([{ url: '/api/admin/hotel-map', body: { revision: 4, config: { ...DEFAULT_HOTEL_MAP_CONFIG, enabled: false } } }]);
  expect(fetcher.mock.calls.every(([url]) => url === '/api/admin/hotel-map')).toBe(true);
});

it('rejects secret-bearing custom endpoints before any settings write', async () => {
  const fetcher = vi.fn().mockResolvedValue(response({ revision: 1, config: DEFAULT_HOTEL_MAP_CONFIG, actorScope: 'solo' }));
  vi.stubGlobal('fetch', fetcher);
  render(<HotelMapAdmin />);
  fireEvent.change(await screen.findByLabelText('Provider'), { target: { value: 'custom' } });
  fireEvent.change(screen.getByLabelText('Style JSON URL'), { target: { value: 'https://tiles.openfreemap.org/style?key=secret' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save map configuration' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/query strings/);
  expect(fetcher.mock.calls.every(([, init]) => !init?.method)).toBe(true);
});

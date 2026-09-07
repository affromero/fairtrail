/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SettingsForm } from './SettingsForm';

const initial = { username: 'traveler', displayName: 'Traveler', avatar: null, theme: null, defaultCurrency: 'GBP', defaultCountry: 'GB', preferredAirlines: ['Example Air'], preferredAggregators: ['google_flights'], preferredCarProviders: [], cabinClass: 'business' };
afterEach(() => vi.unstubAllGlobals());
describe('saving car preferences through account settings', () => {
  it('submits the selected order without changing flight preferences', async () => {
    let saved: Record<string, unknown> | null = null;
    vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
      expect(url).toBe('/api/account/settings');
      saved = JSON.parse(options.body as string);
      return new Response(JSON.stringify({ ok: true, data: saved }));
    });
    render(<SettingsForm initial={initial} adminEnabledAggregators={['google_flights']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Auto Europe up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved');
    expect(saved).toMatchObject({ preferredCarProviders: ['autoeurope', 'discovercars'], preferredAggregators: ['google_flights'], preferredAirlines: ['Example Air'], cabinClass: 'business', defaultCurrency: 'GBP' });
  });
  it('keeps inherited providers unchanged and allows retry after a returned validation error', async () => {
    let retry = false;
    vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
      expect(url).toBe('/api/account/settings');
      expect(JSON.parse(options.body as string).preferredCarProviders).toEqual([]);
      return new Response(JSON.stringify(retry ? { ok: true } : { ok: false, error: 'Please review your settings' }), { status: retry ? 200 : 400 });
    });
    render(<SettingsForm initial={initial} adminEnabledAggregators={['google_flights']} />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Please review your settings');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled());
    retry = true; fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved');
  });
});

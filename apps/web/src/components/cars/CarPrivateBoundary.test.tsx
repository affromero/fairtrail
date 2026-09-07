/** @vitest-environment jsdom */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CarPrivateBoundary } from './CarPrivateBoundary';
import { travelRequest } from '../travel/client';
import en from '../../../messages/en/cars.json';

vi.unmock('next-intl');
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
const surface = (key: string) => <NextIntlClientProvider locale="en" messages={en}><CarPrivateBoundary key={key}><p>Private form</p><p>Private searches</p><p>Private trackers</p></CarPrivateBoundary></NextIntlClientProvider>;
afterEach(() => { vi.unstubAllGlobals(); });

describe('private car dashboard authentication boundary', () => {
  it('hides all sibling surfaces before reading a malformed denial and requires server-authorized remount to reveal them', async () => {
    let status = 401;
    vi.stubGlobal('fetch', vi.fn(async () => status === 401 ? new Response('<html>Sign in</html>', { status }) : new Response(JSON.stringify({ ok: true, data: {} }))));
    const mounted = render(surface('validated-server-render-1'));
    sessionStorage.setItem('ff-car-search:alice', 'pending-receipt');
    await act(async () => { await travelRequest('/api/cars/search').catch(() => undefined); });
    for (const name of ['Private form', 'Private searches', 'Private trackers']) expect(screen.queryByText(name)).not.toBeInTheDocument();
    expect(sessionStorage.getItem('ff-car-search:alice')).toBe('pending-receipt');
    fireEvent.click(screen.getByRole('button', { name: en.Cars.retryStatus }));
    expect(screen.queryByText('Private form')).not.toBeInTheDocument();
    status = 200; await act(async () => { await travelRequest('/api/cars/search'); });
    mounted.rerender(surface('validated-server-render-1'));
    expect(screen.queryByText('Private form')).not.toBeInTheDocument();
    mounted.rerender(surface('validated-server-render-2'));
    expect(screen.getByText('Private form')).toBeInTheDocument();
    sessionStorage.removeItem('ff-car-search:alice');
  });
  it('keeps a missing individual resource from hiding unrelated private surfaces', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>Not found</html>', { status: 404 })));
    render(surface('validated'));
    await act(async () => { await travelRequest('/api/cars/missing').catch(() => undefined); });
    expect(screen.getByText('Private form')).toBeInTheDocument();
  });
});

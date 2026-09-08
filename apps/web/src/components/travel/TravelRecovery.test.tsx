/** @vitest-environment jsdom */
import { StrictMode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TravelRecovery } from './TravelRecovery';
import { TRAVEL_RECOVERY_TIMEOUT_MS } from './useTravelRecovery';
import { TRAVEL_ACCESS_LOST_EVENT } from './client';
import en from '../../../messages/en/admin.json';
import es from '../../../messages/es/admin.json';
import fr from '../../../messages/fr/admin.json';
import de from '../../../messages/de/admin.json';
import pt from '../../../messages/pt/admin.json';

vi.unmock('next-intl');
const locales = { en, es, fr, de, pt }, copy = en.AdminTravel;
const incident = { actorScope: 'user:admin', quarantinedAt: '2026-09-07T12:00:00.000Z', reason: 'Previous browser cleanup is unverified',
  recoveryGeneration: 3, topologyVersion: 2, systemWide: false, vpnEnabled: false,
  leases: [{ id: 'browser', state: 'quarantined', generation: 4, expiresAt: '2026-09-07T12:00:00.000Z' }] };
const reopened = { ...incident, quarantinedAt: null, reason: null, recoveryGeneration: 4, leases: [] };
const reply = (data: unknown) => new Response(JSON.stringify({ ok: true, data }));
function Surface({ locale = 'en' }: { locale?: keyof typeof locales }) {
  return <NextIntlClientProvider locale={locale} messages={locales[locale]}><TravelRecovery /></NextIntlClientProvider>;
}
function check(locale: keyof typeof locales = 'en') {
  fireEvent.click(screen.getByLabelText(locales[locale].AdminTravel.stopped));
  fireEvent.click(screen.getByLabelText(locales[locale].AdminTravel.verified));
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('explicit administrator travel recovery', () => {
  it.each(Object.keys(locales) as (keyof typeof locales)[])('requires both operator checks in %s and submits only the current generation', async locale => {
    const sent: unknown[] = [], t = locales[locale].AdminTravel;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe('/api/admin/travel');
      if (init.method === 'POST') { sent.push(JSON.parse(String(init.body))); return reply(reopened); }
      return reply(incident);
    }));
    render(<Surface locale={locale} />);
    expect(await screen.findByRole('heading', { name: t.paused })).toBeVisible();
    expect(screen.getByRole('button', { name: t.recover })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(t.stopped)); expect(screen.getByRole('button', { name: t.recover })).toBeDisabled();
    fireEvent.click(screen.getByLabelText(t.verified));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: t.recover })); });
    expect(sent).toEqual([{ actorScope: 'user:admin', generation: 3, oldWorkersStopped: true, networkVerified: true }]);
    expect(await screen.findByText(t.reopened)).toBeVisible(); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });
  it('loads fresh status after Strict Mode remount without leaving recovery stuck', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(incident)));
    render(<StrictMode><Surface /></StrictMode>);
    expect(await screen.findByRole('heading', { name: copy.paused })).toBeVisible();
    expect(screen.getByRole('button', { name: copy.reload })).toBeEnabled();
  });
  it('clears confirmations after a failed refresh and requires a new successful read', async () => {
    let offline = false;
    vi.stubGlobal('fetch', vi.fn(async () => { if (offline) throw new TypeError('Offline'); return reply(incident); }));
    render(<Surface />); await screen.findByText(incident.reason); check(); offline = true;
    fireEvent.click(screen.getByRole('button', { name: copy.reload }));
    expect(await screen.findByText(copy.failed)).toBeVisible(); expect(screen.getByLabelText(copy.stopped)).not.toBeChecked();
    expect(screen.getByRole('button', { name: copy.recover })).toBeDisabled(); offline = false;
    fireEvent.click(screen.getByRole('button', { name: copy.reload }));
    await screen.findByText(copy.refreshed); expect(screen.getByLabelText(copy.stopped)).not.toBeChecked();
  });
  it('does not carry checked assertions to another administrator with the same incident generation', async () => {
    let actorScope = incident.actorScope;
    vi.stubGlobal('fetch', vi.fn(async () => reply({ ...incident, actorScope })));
    render(<Surface />); await screen.findByText(incident.reason); check(); actorScope = 'user:other-admin';
    fireEvent.click(screen.getByRole('button', { name: copy.reload }));
    await screen.findByText(copy.refreshed); expect(screen.getByLabelText(copy.stopped)).not.toBeChecked();
    expect(screen.getByRole('button', { name: copy.recover })).toBeDisabled();
  });
  it('bounds an abort-ignoring recovery and ignores its late acknowledgement until a fresh read', async () => {
    vi.useFakeTimers(); let finish!: (value: Response) => void; const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      methods.push(init.method!);
      if (init.method === 'POST') return new Promise<Response>(resolve => { finish = resolve; });
      return reply(methods.includes('POST') ? reopened : incident);
    }));
    await act(async () => { render(<Surface />); }); check();
    const button = screen.getByRole('button', { name: copy.recover });
    await act(async () => { fireEvent.click(button); fireEvent.click(button); });
    await act(async () => { await vi.advanceTimersByTimeAsync(TRAVEL_RECOVERY_TIMEOUT_MS + 1); });
    expect(screen.getByText(copy.uncertain)).toBeVisible(); expect(button).toBeDisabled();
    await act(async () => { finish(reply(reopened)); }); expect(screen.queryByText(copy.reopened)).not.toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: copy.reload })); });
    expect(screen.getByText(copy.refreshed)).toBeVisible(); expect(screen.getByRole('heading', { name: copy.ready })).toBeVisible();
    expect(methods).toEqual(['GET', 'POST', 'GET']);
  });
  it.each(['re-quarantine', 'stale'] as const)('requires fresh review when recovery returns %s instead of a matching reopening', async outcome => {
    const methods: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      methods.push(init.method!);
      if (init.method === 'GET') return reply(incident);
      return outcome === 'stale' ? new Response(JSON.stringify({ ok: false, error: 'Changed' }), { status: 412 }) : reply({ ...incident, recoveryGeneration: 5 });
    }));
    render(<Surface />); await screen.findByText(incident.reason); check();
    fireEvent.click(screen.getByRole('button', { name: copy.recover })); await screen.findByText(copy.changed);
    expect(screen.queryByText(copy.reopened)).not.toBeInTheDocument(); expect(screen.getByRole('button', { name: copy.recover })).toBeDisabled();
    expect(methods).toEqual(['GET', 'POST']);
  });
  it('hides private incident details on access loss and ignores a late recovery success', async () => {
    let finish!: (value: Response) => void;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => init.method === 'POST' ? new Promise<Response>(resolve => { finish = resolve; }) : reply(incident)));
    render(<Surface />); await screen.findByText(incident.reason); check();
    fireEvent.click(screen.getByRole('button', { name: copy.recover }));
    act(() => window.dispatchEvent(new Event(TRAVEL_ACCESS_LOST_EVENT)));
    expect(screen.queryByText(incident.reason)).not.toBeInTheDocument();
    await act(async () => { finish(reply(reopened)); });
    expect(screen.getByText(copy.inaccessible)).toBeVisible(); expect(screen.queryByText(copy.reopened)).not.toBeInTheDocument();
  });
  it('rejects inconsistent status without showing raw private fields or enabling recovery', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply({ ...incident, owner: 'private-lease-secret' })));
    render(<Surface />); expect(await screen.findByText(copy.failed)).toBeVisible();
    expect(screen.queryByText(incident.reason)).not.toBeInTheDocument(); expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent('private-lease-secret');
  });
});

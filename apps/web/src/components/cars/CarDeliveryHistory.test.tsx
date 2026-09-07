/** @vitest-environment jsdom */
import { render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import { carTrackerViewFixture } from '@/test/car-fixtures';
import { validateCarDetailView } from '@/lib/cars/detail-view';
import { CarTrackerHistory } from './CarTrackerHistory';
import en from '../../../messages/en/cars.json';
import es from '../../../messages/es/cars.json';
import fr from '../../../messages/fr/cars.json';
import de from '../../../messages/de/cars.json';
import pt from '../../../messages/pt/cars.json';

vi.unmock('next-intl');
const locales = { en, es, fr, de, pt };
function detail(empty = false) {
  const tracker = carTrackerViewFixture(), now = new Date().toISOString();
  const deliveries = empty ? [] : (['waiting', 'claimed', 'retrying', 'accepted', 'stopped'] as const).map((status, index) => ({
    id: `notification-${index}`, trackerId: tracker.id, status, createdAt: now,
    acknowledgedChannels: status === 'accepted' || status === 'retrying' ? 1 : 0,
    nextAttemptAt: status === 'accepted' || status === 'stopped' ? null : now,
  }));
  return validateCarDetailView({ tracker, snapshots: [], latestObservation: null, runs: [], deliveries, notificationsConfigured: true, canReassign: false }, tracker.id);
}
describe('rental delivery history', () => {
  it.each(Object.keys(locales) as (keyof typeof locales)[])('shows every delivery state with honest acknowledgement and retry labels in %s', locale => {
    const messages = locales[locale], copy = messages.Cars.Delivery;
    render(<NextIntlClientProvider locale={locale} messages={messages}><CarTrackerHistory detail={detail()} /></NextIntlClientProvider>);
    const region = within(screen.getByRole('region', { name: copy.title }));
    expect(region.getByText(copy.help)).toBeInTheDocument();
    for (const state of ['waiting', 'claimed', 'retrying', 'accepted', 'stopped'] as const) expect(region.getByText(copy[state])).toBeInTheDocument();
    expect(region.getAllByText(copy.next)).toHaveLength(3);
    const accepted = region.getByText(copy.accepted).closest('li')!;
    expect(within(accepted).getByText('1')).toBeInTheDocument();
    expect(within(accepted).queryByText(copy.next)).not.toBeInTheDocument();
    expect(region.queryByRole('button')).not.toBeInTheDocument();
  });
  it('shows an explicit empty history without inventing a delivered alert', () => {
    render(<NextIntlClientProvider locale="en" messages={en}><CarTrackerHistory detail={detail(true)} /></NextIntlClientProvider>);
    const region = within(screen.getByRole('region', { name: en.Cars.Delivery.title }));
    expect(region.getByText(en.Cars.Delivery.empty)).toBeInTheDocument();
    expect(region.queryByText(en.Cars.Delivery.accepted)).not.toBeInTheDocument();
  });
});

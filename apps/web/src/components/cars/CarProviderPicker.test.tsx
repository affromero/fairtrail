/** @vitest-environment jsdom */
import { useState } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import { CarProviderPicker } from './CarProviderPicker';
import type { CarSource } from '@/lib/cars/types';
import en from '../../../messages/en/pages.json';
import es from '../../../messages/es/pages.json';
import fr from '../../../messages/fr/pages.json';
import de from '../../../messages/de/pages.json';
import pt from '../../../messages/pt/pages.json';

vi.unmock('next-intl');
const locales = { en, es, fr, de, pt };
function Harness({ initial = [], locale = 'en', disabled = false }: { initial?: CarSource[]; locale?: keyof typeof locales; disabled?: boolean }) {
  const [value, setValue] = useState(initial);
  return <NextIntlClientProvider locale={locale} messages={locales[locale]}><CarProviderPicker value={value} onChange={setValue} disabled={disabled} /><output aria-label="Saved providers">{JSON.stringify(value)}</output></NextIntlClientProvider>;
}
describe('accessible car provider preferences', () => {
  it('shows inherited providers without turning inheritance into explicit saved preferences', () => {
    render(<Harness />);
    expect(screen.getByRole('checkbox', { name: 'DiscoverCars' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Auto Europe' })).toBeChecked();
    expect(screen.getByLabelText('Saved providers')).toHaveTextContent('[]');
    expect(screen.getByRole('button', { name: 'Use default providers' })).toBeDisabled();
  });
  it('materializes selection, protects the final provider and resets to inheritance', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'DiscoverCars' }));
    expect(screen.getByLabelText('Saved providers')).toHaveTextContent('["autoeurope"]');
    expect(screen.getByRole('checkbox', { name: 'Auto Europe' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Use default providers' }));
    expect(screen.getByLabelText('Saved providers')).toHaveTextContent('[]');
    expect(screen.getByRole('checkbox', { name: 'DiscoverCars' })).toBeChecked();
  });
  it('reorders selected providers by keyboard and keeps focus on the moved provider', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const move = screen.getByRole('button', { name: 'Move Auto Europe up' }); move.focus(); await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Saved providers')).toHaveTextContent('["autoeurope","discovercars"]');
    expect(within(screen.getAllByRole('listitem')[0]!).getByRole('checkbox')).toHaveAccessibleName('Auto Europe');
    expect(screen.getByRole('checkbox', { name: 'Auto Europe' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Move Auto Europe up' })).toBeDisabled();
  });
  it.each(Object.keys(locales) as (keyof typeof locales)[])('renders complete preference instructions in %s', locale => {
    render(<Harness locale={locale} />);
    expect(screen.getByRole('group', { name: locales[locale].AccountSettings.carProviderPreference })).toBeInTheDocument();
    expect(screen.getByText(locales[locale].AccountSettings.carProviderMinimum)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: locales[locale].AccountSettings.carProviderReset })).toBeInTheDocument();
  });
  it('prevents preference changes while the enclosing save is running', () => {
    render(<Harness disabled initial={['autoeurope', 'discovercars']} />);
    expect(screen.getAllByRole('checkbox').every(input => (input as HTMLInputElement).matches(':disabled'))).toBe(true);
    expect(screen.getAllByRole('button').every(button => (button as HTMLButtonElement).matches(':disabled'))).toBe(true);
  });
});

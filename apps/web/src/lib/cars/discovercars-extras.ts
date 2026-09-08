import type { Page } from 'playwright';
import { CarError, type CarSearch, type ChildSeatCategory } from './types';
import { carInteger, carRecord, carText } from './validation';
import { carProviderUrl } from './offer-validation';
import { verifyCarProviderContext } from './provider-context';
import { captureDiscoverCarsPriceLines, type DiscoverCarsPriceLine } from './discovercars-price-lines';

const PRODUCTS = {
  infant: { id: 3, label: 'Baby seat (0-13 kg)' },
  child: { id: 4, label: 'Child seat (9-18 kg)' },
  booster: { id: 5, label: 'Booster seat (15-45 kg)' },
  additional_driver: { id: 6, label: 'Additional driver' },
} as const;

export function discoverCarsRequestedExtras(search: CarSearch) {
  return [
    ...search.extras.childSeats.map(seat => ({ ...PRODUCTS[seat.category], kind: 'child_seat' as const, category: seat.category, quantity: seat.quantity })),
    ...(search.extras.additionalDrivers.length ? [{ ...PRODUCTS.additional_driver, kind: 'additional_driver' as const, category: null, quantity: search.extras.additionalDrivers.length }] : []),
  ];
}

export interface DiscoverCarsExtraSelection {
  id: number;
  productId: string;
  kind: 'child_seat' | 'additional_driver';
  category: ChildSeatCategory | null;
  quantity: number;
  label: string;
  visibleUnitPrice: string;
}
export interface DiscoverCarsExtrasCapture {
  offerId: string;
  selections: DiscoverCarsExtraSelection[];
  terms: string;
  visibleTotal: string;
  priceLines: DiscoverCarsPriceLine[];
  observedAt: string;
}

export async function verifyDiscoverCarsExtraSelection(page: Page, selections: DiscoverCarsExtraSelection[]): Promise<void> {
  const options = page.locator('.ExtrasOption:visible'), labels = new Set<string>();
  const count = await options.count();
  if (count > 100) throw new CarError('Provider local-extra controls exceed the capture limit');
  for (let index = 0; index < count; index++) {
    const option = options.nth(index), label = (await option.locator('.ExtrasOption-Title').innerText()).trim();
    if (labels.has(label)) throw new CarError('Provider duplicated local-extra controls');
    labels.add(label);
    const quantity = selections.find(selection => selection.label === label)?.quantity ?? 0;
    if (await option.locator('input[type="checkbox"]').isChecked() !== (quantity > 0) || (await option.locator('.ExtrasOption-QtyNumber').innerText()).trim() !== String(quantity)) throw new CarError('Provider changed requested local-extra quantities');
  }
  if (selections.some(selection => !labels.has(selection.label))) throw new CarError('Provider removed a selected local-extra control');
}

/** Selects visible quote options only. Prices and availability remain unverified. */
export async function captureDiscoverCarsExtras(page: Page, quoteUrl: string, search: CarSearch, rawExtras: unknown): Promise<DiscoverCarsExtrasCapture> {
  const expected = new URL(carProviderUrl(quoteUrl, 'discovercars'));
  const verify = () => {
    const current = new URL(carProviderUrl(page.url(), 'discovercars'));
    if (current.pathname !== expected.pathname || current.searchParams.get('sq') !== expected.searchParams.get('sq')) throw new CarError('Local extras belong to a different rental quote');
    verifyCarProviderContext(current.href, 'discovercars', search);
  };
  verify();
  const offerId = expected.pathname.match(/^\/offer\/([^/]+)$/)?.[1];
  if (!offerId) throw new CarError('Expected a rental detail page for local extras');
  if (!Array.isArray(rawExtras) || rawExtras.length > 100) throw new CarError('Provider local-extra products are unavailable');
  const products = rawExtras.map(carRecord);
  if (products.some(product => product.selectedCount !== 0)) throw new CarError('Provider added a local extra before selection');
  const requested = discoverCarsRequestedExtras(search);
  if (!requested.length) throw new CarError('No local extras were requested');
  const show = page.getByRole('button', { name: 'Show extras', exact: true });
  if (await show.count() !== 1 || !await show.isVisible()) throw new CarError('The provider does not expose local-extra selection controls for this quote');
  await show.click();
  const terms = carText((await page.locator('.OfferDetailsExtras-ExtrasInfo:visible').innerText()).replace(/\s+/g, ' ').trim(), 12000, 'local-extra conditions');
  const options = page.locator('.ExtrasOption:visible');
  if (await options.count() > 100) throw new CarError('Provider local-extra controls exceed the capture limit');
  const selections: DiscoverCarsExtraSelection[] = [];
  for (const request of requested) {
    verify();
    const matches = products.filter(product => product.id === request.id), product = matches[0];
    if (matches.length !== 1 || !product) throw new CarError(`The provider did not offer the requested ${request.label}`);
    const productId = carText(product.idWithMap, 200, 'local-extra product identity');
    if (!productId.startsWith(`${request.id}_`)) throw new CarError('Local-extra product identity disagrees with its category');
    const maximum = carInteger(product.maxQuantity, 0, 100, 'Provider extra limit');
    if (request.quantity > maximum) throw new CarError(`The provider cannot select ${request.quantity} × ${request.label}`);
    const option = options.filter({ has: page.locator('.ExtrasOption-Title').filter({ hasText: new RegExp(`^${request.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
    if (await option.count() !== 1) throw new CarError(`The visible ${request.label} cannot be identified unambiguously`);
    const checkbox = option.locator('input[type="checkbox"]');
    if (await checkbox.isChecked() || (await option.locator('.ExtrasOption-QtyNumber').innerText()).trim() !== '0') throw new CarError('Provider extra was already selected');
    const visibleUnitPrice = carText((await option.locator('.ExtrasOption-Description').innerText()).replace(/\s+/g, ' ').trim(), 300, 'extra period price');
    if (!visibleUnitPrice.endsWith(' for rental period')) throw new CarError('Provider did not identify the extra rental-period price');
    await option.locator('label.Checkbox-Label').click();
    await option.locator('.ExtrasOption-QtyNumber').filter({ hasText: /^1$/ }).waitFor();
    for (let quantity = 2; quantity <= request.quantity; quantity++) {
      const controls = option.locator('button.ExtrasOption-QtyIcon');
      if (await controls.count() !== 2) throw new CarError('Provider extra quantity controls are ambiguous');
      await controls.last().click();
      await option.locator('.ExtrasOption-QtyNumber').filter({ hasText: new RegExp(`^${quantity}$`) }).waitFor();
    }
    if (!await checkbox.isChecked()) throw new CarError('Provider did not retain the requested extra');
    selections.push({ id: request.id, productId, kind: request.kind, category: request.category, quantity: request.quantity, label: request.label, visibleUnitPrice });
  }
  await verifyDiscoverCarsExtraSelection(page, selections);
  verify();
  const summary = page.locator('.OfferPriceBreakdown:visible').first();
  const visibleTotal = await summary.locator('.OfferPriceBreakdown-AmountPriceBlock').innerText();
  const priceLines = await captureDiscoverCarsPriceLines(summary);
  await verifyDiscoverCarsExtraSelection(page, selections);
  verify();
  return { offerId, selections, terms, visibleTotal, priceLines, observedAt: new Date().toISOString() };
}

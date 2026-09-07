import type { Locator } from 'playwright';
import { CarError } from './types';

export interface DiscoverCarsPriceLine {
  label: string;
  amount: string;
  payment: 'now' | 'pickup';
}

export async function captureDiscoverCarsPriceLines(summary: Locator): Promise<DiscoverCarsPriceLine[]> {
  const groups = summary.locator('.OfferPriceBreakdown-Main');
  const lines: DiscoverCarsPriceLine[] = [];
  for (let index = 0; index < await groups.count(); index++) {
    const group = groups.nth(index), items = group.locator('.OfferPriceBreakdown-Extra');
    if (!(await items.count())) continue;
    const heading = (await group.locator(':scope > p').first().innerText()).trim();
    const payment = heading === 'Pay now' ? 'now' : heading === 'To pay at pick-up' ? 'pickup' : null;
    if (!payment) throw new CarError('Provider did not identify when a charge is payable');
    for (let item = 0; item < await items.count(); item++) {
      const row = items.nth(item);
      lines.push({ payment, label: (await row.locator('.OfferPriceBreakdown-ExtraTitle').innerText()).trim(), amount: (await row.locator(':scope > p').last().innerText()).trim() });
    }
  }
  if (!lines.length || lines.length > 100) throw new CarError('Provider payment breakdown is unavailable or oversized');
  return lines;
}

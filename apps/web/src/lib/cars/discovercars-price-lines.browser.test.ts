import { describe, expect, it } from 'vitest';
import { launchBrowser } from '../scraper/browser';
import { captureDiscoverCarsPriceLines } from './discovercars-price-lines';

describe.skipIf(process.env.TRAVEL_BROWSER_TESTS !== '1')('visible rental payment breakdown', () => {
  it('preserves charge labels and payment timing even when amounts are equal', async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent(`<div class="OfferPriceBreakdown">
        <div class="OfferPriceBreakdown-Main"><p>Pay now</p>
          <div class="OfferPriceBreakdown-Extra"><p class="OfferPriceBreakdown-ExtraTitle">Rental prepayment</p><p>$100.00</p></div>
          <div class="OfferPriceBreakdown-Extra"><p class="OfferPriceBreakdown-ExtraTitle">Full Coverage</p><p>$50.00</p></div>
        </div>
        <div class="OfferPriceBreakdown-Main"><p>To pay at pick-up</p>
          <div class="OfferPriceBreakdown-Extra"><p class="OfferPriceBreakdown-ExtraTitle">Rental</p><p>$100.00</p></div>
        </div>
        <div class="OfferPriceBreakdown-Main"><div>Total $250.00</div></div>
      </div>`);
      expect(await captureDiscoverCarsPriceLines(page.locator('.OfferPriceBreakdown'))).toEqual([
        { label: 'Rental prepayment', amount: '$100.00', payment: 'now' },
        { label: 'Full Coverage', amount: '$50.00', payment: 'now' },
        { label: 'Rental', amount: '$100.00', payment: 'pickup' },
      ]);
      await page.locator('.OfferPriceBreakdown-Main > p').first().evaluate(element => { element.textContent = 'Estimated later'; });
      await expect(captureDiscoverCarsPriceLines(page.locator('.OfferPriceBreakdown'))).rejects.toThrow(/payable/);
    } finally { await browser.close(); }
  });
});

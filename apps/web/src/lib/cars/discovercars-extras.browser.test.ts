import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { launchBrowser } from '../scraper/browser';
import { captureDiscoverCarsExtras } from './discovercars-extras';
import { validateCarSearch } from './validation';
import { captureDiscoverCarsProtection } from './discovercars-protection';
import { prepareCarPage } from './navigation';
import { captureDiscoverCarsSeparateExtras } from './discovercars-extras-step';

const location = { name: 'London Heathrow Airport', country: 'GB', timeZone: 'Europe/London', providerIds: { discovercars: '1712' } };
const search = validateCarSearch({ pickup: location, dropoff: location, pickupAt: { date: '2026-10-15', time: '11:00' }, dropoffAt: { date: '2026-10-18', time: '11:00' }, driver: { age: 35, licenceYears: 2, residenceCountry: 'GB' }, sources: ['discovercars'], currency: 'GBP', extras: { childSeats: [{ category: 'child', quantity: 2 }], additionalDrivers: [{ age: 35, licenceYears: 2, residenceCountry: 'GB' }] } }, new Date('2026-09-01'));
const query = Buffer.from(JSON.stringify({ PickupLocationId: 1712, DropOffLocationId: 1712, PickupDateTime: '2026-10-15T11:00:00', DropOffDateTime: '2026-10-18T11:00:00', DriverAge: 35, ResidenceCountry: 'GB' })).toString('base64');
const url = `https://www.discovercars.com/offer/11111111-2222-4333-8444-555555555555-RATE?sq=${encodeURIComponent(query)}`;
const products = () => [{ id: 4, idWithMap: '4_17671', selectedCount: 0, maxQuantity: 3 }, { id: 6, idWithMap: '6_17668', selectedCount: 0, maxQuantity: 3 }];
const disclaimer = 'Prices and availability are controlled by the supplier. Prices are subject to change and are a guide only.';

function fixture(mode = 'normal') {
  const labels = ['Child seat (9-18 kg)', 'Additional driver'];
  if (mode === 'wrong-label') labels[0] = 'Booster seat (15-45 kg)';
  if (mode === 'duplicate') labels.push(labels[0]!);
  return `<meta charset="utf-8"><style>[hidden]{display:none!important}.Checkbox-Label{display:inline-block;width:24px;height:24px;position:relative}.Checkbox-Box{position:absolute;inset:0;background:#eee}</style>
    ${mode === 'absent' ? '' : '<button id="show">Show extras</button>'}
    <div id="options" hidden>${labels.map((label, index) => `<div class="ExtrasOption"><p class="ExtrasOption-Title">${label}</p><p class="ExtrasOption-Description">£${index === 0 ? '38.97' : '36.00'} ${mode === 'daily' ? 'per day' : 'for rental period'}</p><label class="Checkbox-Label"><input type="checkbox"><span class="Checkbox-Box"></span></label><div class="ExtrasOption-QtyNumber">0</div><button class="ExtrasOption-QtyIcon">Remove</button><button class="ExtrasOption-QtyIcon">Add</button></div>`).join('')}<p class="OfferDetailsExtras-ExtrasInfo">${disclaimer}</p></div>
    <div class="OfferPriceBreakdown"><div class="OfferPriceBreakdown-Main"><p>Pay now</p><div class="OfferPriceBreakdown-Extra"><p class="OfferPriceBreakdown-ExtraTitle">Rental prepayment</p><p>£8.19</p></div></div><div class="OfferPriceBreakdown-Main"><p>To pay at pick-up</p><div id="charges"></div></div><p class="${mode.startsWith('late-') ? 'PendingTotal' : 'OfferPriceBreakdown-AmountPriceBlock'}">£44.16</p></div>
    <a class="OfferPriceBreakdown-BookNow" href="/offer/coverage/11111111-2222-4333-8444-555555555555-RATE">Continue</a><script>
    const options = [...document.querySelectorAll('.ExtrasOption')];
    document.querySelector('#show')?.addEventListener('click', () => document.querySelector('#options').hidden = false);
    function render() {
      let total = 44.16;
      let lines = '<div class="OfferPriceBreakdown-Extra"><p class="OfferPriceBreakdown-ExtraTitle">Rental</p><p>£35.97</p></div>';
      options.forEach((option, index) => {
        const quantity = Number(option.querySelector('.ExtrasOption-QtyNumber').textContent);
        option.querySelector('input').checked = quantity > 0;
        if (!quantity) return;
        const amount = quantity * (index === 0 ? 38.97 : 36); total += amount;
        lines += '<div class="OfferPriceBreakdown-Extra"><p class="OfferPriceBreakdown-ExtraTitle">'+option.querySelector('.ExtrasOption-Title').textContent+(quantity > 1 ? ' ('+quantity+')' : '')+'</p><p>£'+amount.toFixed(2)+'</p></div>';
      });
      document.querySelector('#charges').innerHTML = lines;
      document.querySelector('.OfferPriceBreakdown-AmountPriceBlock, .PendingTotal').textContent = '£'+total.toFixed(2);
    }
    options.forEach((option, index) => {
      const count = option.querySelector('.ExtrasOption-QtyNumber');
      option.querySelector('input').onchange = event => { count.textContent = event.target.checked ? '1' : '0'; render();
        ${mode.startsWith('late-') ? `if (index === 1) setTimeout(() => {
          ${mode === 'late-quote' ? "history.replaceState({}, '', '/offer/another-quote?sq=' + new URL(location.href).searchParams.get('sq'));" : "options[0].querySelector('.ExtrasOption-QtyNumber').textContent = '1'; render();"}
          document.querySelector('.PendingTotal').className = 'OfferPriceBreakdown-AmountPriceBlock';
        }, 100);` : ''}
      };
      option.querySelectorAll('button')[1].onclick = () => { count.textContent = String(Number(count.textContent)+1); render(); ${mode === 'changed-quote' ? "history.replaceState({}, '', '/offer/another-quote?sq=' + new URL(location.href).searchParams.get('sq'));" : ''} };
    }); render();
    </script>`;
}

function coverageFixture(reset: boolean) {
  const offerId = '11111111-2222-4333-8444-555555555555-RATE';
  const quote = { offerId, vehicle: {}, priceObject: {}, coverage: { id: 35, name: 'Full Coverage', price: { period: 6, currency: 'GBP' } } };
  return `<meta charset="utf-8"><style>[hidden]{display:none!important}</style>
    <script>self.__next_f=[];</script><script>self.__next_f.push(${JSON.stringify([1, `0:${JSON.stringify(quote)}\n`])});</script>
    <button id="coverage" aria-pressed="false">Book with coverage £2 / day</button>
    <div class="OfferPriceBreakdown"><div class="OfferPriceBreakdown-Main"><p>Pay now</p><div class="OfferPriceBreakdown-Extra"><p class="OfferPriceBreakdown-ExtraTitle">Rental prepayment</p><p>£8.19</p></div><div id="protection-charge"></div></div>
    <div class="OfferPriceBreakdown-Main"><p>To pay at pick-up</p><div class="OfferPriceBreakdown-Extra"><p class="OfferPriceBreakdown-ExtraTitle">Rental</p><p>£35.97</p></div>
    ${reset ? '' : '<div class="OfferPriceBreakdown-Extra"><p class="OfferPriceBreakdown-ExtraTitle">Child seat (9-18 kg) (2)</p><p>£77.94</p></div><div class="OfferPriceBreakdown-Extra"><p class="OfferPriceBreakdown-ExtraTitle">Additional driver</p><p>£36.00</p></div>'}</div>
    <p class="OfferPriceBreakdown-AmountPriceBlock">£${reset ? '44.16' : '158.10'}</p></div>
    <button class="CoverageHero-LearnMore" onclick="document.querySelector('.CoverageLearnMoreModal-Modal').hidden=false">Learn more</button>
    <div class="CoverageLearnMoreModal-Modal" hidden><p class="CoverageLearnMoreModal-CoveredSection">Damage reimbursement.</p><p class="CoverageLearnMoreModal-NotCoveredSection">Personal possessions are excluded.</p></div>
    <script>document.querySelector('#coverage').onclick = event => { event.target.className='CoverageOptions-Card_isSelected';event.target.setAttribute('aria-pressed','true');document.querySelector('#protection-charge').innerHTML='<div class="OfferPriceBreakdown-Extra"><p class="OfferPriceBreakdown-ExtraTitle">Full Coverage</p><p>£6.00</p></div>';document.querySelector('.OfferPriceBreakdown-AmountPriceBlock').textContent='£164.10'; };</script>`;
}

const separateOffer = () => ({ offerId: new URL(url).pathname.split('/').at(-1)!, vehicle: {}, extras: products(), coverage: { id: 35, name: 'Full Coverage', isChecked: false, price: { period: 6, currency: 'GBP' } }, priceObject: {} });
const baseSnapshot = { visibleTotal: '£44.16', priceLines: [{ label: 'Rental prepayment', amount: '£8.19', payment: 'now' as const }, { label: 'Rental', amount: '£35.97', payment: 'pickup' as const }] };
function renderedSeparateOffer(changed = false) {
  const offer = separateOffer();
  if (changed) offer.vehicle = { differentVehicle: true };
  return `<script>self.__next_f=[];</script><script>self.__next_f.push(${JSON.stringify([1, `0:${JSON.stringify(offer)}\n`])});</script>`;
}
function separateCoverageFixture(mode: string) {
  const destination = mode === 'unexpected-checkout' ? '/checkout' : `/offer/${mode === 'unexpected-driver' ? 'driver' : 'extras'}/${mode === 'changed-quote' ? 'different-quote' : separateOffer().offerId}${mode === 'changed-context' ? '?sq=changed' : ''}`;
  return `<meta charset="utf-8"><style>[hidden]{display:none!important}</style>${renderedSeparateOffer()}
    <div class="Steps-Next">Next: ${mode === 'wrong-next' ? 'Driver' : 'Extras'}</div>
    <button id="without" aria-pressed="true">Book without coverage No protection</button><button id="with" aria-pressed="false">Book with coverage £2 / day</button>
    <div class="OfferPriceBreakdown"><div class="OfferPriceBreakdown-Main"><p>Pay now</p><div class="OfferPriceBreakdown-Extra"><p class="OfferPriceBreakdown-ExtraTitle">Rental prepayment</p><p>£8.19</p></div><div id="protection"></div></div><div class="OfferPriceBreakdown-Main"><p>To pay at pick-up</p><div class="OfferPriceBreakdown-Extra"><p class="OfferPriceBreakdown-ExtraTitle">Rental</p><p>£35.97</p></div></div><p class="OfferPriceBreakdown-AmountPriceBlock">£44.16</p></div>
    <button class="CoverageHero-LearnMore" onclick="document.querySelector('#terms').hidden=false">Learn more</button>
    <div id="terms" class="CoverageLearnMoreModal-Modal" hidden><button class="Modal-CloseBtn" onclick="document.querySelector('#terms').hidden=true">Close modal</button><p class="CoverageLearnMoreModal-CoveredSection">Damage reimbursement</p><p class="CoverageLearnMoreModal-NotCoveredSection">Personal possessions excluded.</p></div>
    <button id="continue" class="OfferPriceBreakdown-BookNow">Continue</button><div id="upsell" hidden><button class="CoverageCta-Button_isInPopup" onclick="location.href='${destination}'">No, I'll take the risk</button><button>Book with coverage</button></div>
    <script>
      sessionStorage.removeItem('coverage');
      document.querySelector('#with').onclick=event=>{sessionStorage.setItem('coverage','selected');event.target.setAttribute('aria-pressed','true');event.target.className='CoverageOptions-Card_isSelected';document.querySelector('#without').setAttribute('aria-pressed','false');document.querySelector('#protection').innerHTML='<div class="OfferPriceBreakdown-Extra"><p class="OfferPriceBreakdown-ExtraTitle">Full Coverage</p><p>£6.00</p></div>';document.querySelector('.OfferPriceBreakdown-AmountPriceBlock').textContent='£50.16';document.querySelector('#continue').outerHTML='<a id="continue" class="OfferPriceBreakdown-BookNow" href="${destination}">Continue</a>';};
      document.querySelector('#without').onclick=()=>{};
      document.querySelector('#continue').onclick=()=>{if(sessionStorage.getItem('coverage')||${mode === 'no-popup'}) location.href='${destination}';else document.querySelector('#upsell').hidden=false;};
    </script>`;
}
function separateExtrasFixture(mode: string) {
  const selected = mode === 'dropped-protection' ? 'false' : "sessionStorage.getItem('coverage') === 'selected'";
  const backgroundRequest = ['driver-prefetch', 'driver-fetch', 'post-prefetch', 'wrong-quote-prefetch'].includes(mode)
    ? `<script>fetch('/offer/driver/${mode === 'wrong-quote-prefetch' ? 'another-quote' : separateOffer().offerId}', { method: '${mode === 'post-prefetch' ? 'POST' : 'GET'}', headers: ${mode === 'driver-fetch' ? '{}' : '{"next-router-prefetch":"1"}'} }).catch(()=>{});</script>` : '';
  return renderedSeparateOffer(mode === 'changed-contract') + fixture()
    .replace('<button id="show">Show extras</button>', '<div class="Steps-Next">Next: Driver</div>')
    .replace('<div id="options" hidden>', '<div id="options" class="OfferDetailsExtras-Extras_StepMode">')
    .replace('let total = 44.16;', `let total = 44.16 + (${selected} ? 6 : 0);`)
    .replace('const options =', `if (${selected}) document.querySelector('.OfferPriceBreakdown-Main').insertAdjacentHTML('beforeend','<div class="OfferPriceBreakdown-Extra"><p class="OfferPriceBreakdown-ExtraTitle">Full Coverage</p><p>£6.00</p></div>'); const options =`)
    + `<div class="ExtrasMobilityProtection"><input type="checkbox" aria-label="Add Roadtrip Protection" ${mode === 'unrequested-roadtrip' ? 'checked' : ''}></div>${backgroundRequest}`;
}

describe.skipIf(process.env.TRAVEL_BROWSER_TESTS !== '1')('DiscoverCars local extras in Chromium', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchBrowser(); });
  afterAll(async () => { await browser?.close(); });

  it.each([{ selected: false, mode: 'normal' }, { selected: true, mode: 'normal' }, { selected: false, mode: 'no-popup' }, { selected: true, mode: 'driver-prefetch' }])('captures separate extras with $selected coverage and $mode decline without entering driver details', async ({ selected, mode }) => {
    const page = await browser.newPage();
    let driverRequested = false;
    try {
      await prepareCarPage(page, 'discovercars');
      await page.route('https://www.discovercars.com/**', route => {
        const path = new URL(route.request().url()).pathname;
        if (path.includes('/driver/')) driverRequested = true;
        return route.fulfill({ contentType: 'text/html', body: path.includes('/coverage/') ? separateCoverageFixture(mode) : path.includes('/extras/') ? separateExtrasFixture(mode) : fixture('absent') });
      });
      await page.goto(url);
      const criteria = { ...search, extras: { ...search.extras, protection: selected ? [{ source: 'discovercars' as const, productId: '35' }] : [] } };
      const result = await captureDiscoverCarsSeparateExtras(page, url, criteria, separateOffer(), baseSnapshot);
      expect(result.localExtras).toMatchObject({ visibleTotal: selected ? '£164.10' : '£158.10', selections: [{ category: 'child', quantity: 2 }, { kind: 'additional_driver', quantity: 1 }] });
      expect(result.protection?.selected ?? false).toBe(selected);
      expect(await page.getByRole('checkbox', { name: 'Add Roadtrip Protection' }).isChecked()).toBe(false);
      expect(new URL(page.url()).pathname).toBe(`/offer/extras/${separateOffer().offerId}`);
      expect(driverRequested).toBe(false);
    } finally { await page.close(); }
  });

  it.each(['wrong-next', 'unexpected-driver', 'unexpected-checkout', 'driver-fetch', 'post-prefetch', 'wrong-quote-prefetch', 'changed-quote', 'changed-context', 'changed-contract', 'dropped-protection', 'unrequested-roadtrip', 'cancelled'])('rejects %s in the separate extras sequence', async mode => {
    const page = await browser.newPage();
    let driverRequested = false;
    try {
      await prepareCarPage(page, 'discovercars');
      await page.route('https://www.discovercars.com/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.includes('/driver/') || path === '/checkout') driverRequested = true;
        if (mode === 'cancelled' && path.includes('/extras/')) { await route.abort(); await page.close(); return; }
        return route.fulfill({ contentType: 'text/html', body: path.includes('/coverage/') ? separateCoverageFixture(mode) : path.includes('/extras/') ? separateExtrasFixture(mode) : fixture('absent') });
      });
      await page.goto(url);
      const criteria = { ...search, extras: { ...search.extras, protection: mode === 'dropped-protection' ? [{ source: 'discovercars' as const, productId: '35' }] : [] } };
      await expect(captureDiscoverCarsSeparateExtras(page, url, criteria, separateOffer(), baseSnapshot)).rejects.toThrow();
      expect(driverRequested).toBe(false);
    } finally { await page.close(); }
  });

  it('selects two seats and a driver through visible labels and retains the estimated-price disclaimer', async () => {
    const page = await browser.newPage();
    try {
      await page.route('https://www.discovercars.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture() }));
      await page.goto(url);
      const captured = await captureDiscoverCarsExtras(page, url, search, products());
      expect(captured.selections).toMatchObject([{ productId: '4_17671', category: 'child', quantity: 2, visibleUnitPrice: '£38.97 for rental period' }, { productId: '6_17668', kind: 'additional_driver', quantity: 1 }]);
      expect(captured.visibleTotal).toBe('£158.10');
      expect(captured.priceLines).toEqual(expect.arrayContaining([{ label: 'Child seat (9-18 kg) (2)', amount: '£77.94', payment: 'pickup' }, { label: 'Additional driver', amount: '£36.00', payment: 'pickup' }]));
      expect(captured.terms).toContain('subject to change');
      expect(page.url()).toBe(url);
    } finally { await page.close(); }
  });

  it.each([false, true])('preserves selected extras through protection review or rejects reset=%s', async reset => {
    const page = await browser.newPage();
    try {
      await prepareCarPage(page, 'discovercars');
      await page.route('https://www.discovercars.com/**', route => route.fulfill({ contentType: 'text/html', body: new URL(route.request().url()).pathname.includes('/coverage/') ? coverageFixture(reset) : fixture() }));
      await page.goto(url);
      const extras = await captureDiscoverCarsExtras(page, url, search, products());
      const protection = captureDiscoverCarsProtection(page, url, '35', extras);
      if (reset) await expect(protection).rejects.toThrow(/changed the selected local extras/);
      else {
        const captured = await protection;
        expect(captured).toMatchObject({ selected: true, visibleTotal: '£164.10' });
        expect(captured.priceLines).toEqual(expect.arrayContaining(extras.priceLines));
        expect(captured.terms).toContain('Personal possessions are excluded');
      }
    } finally { await page.close(); }
  });

  it.each(['absent', 'duplicate', 'wrong-label', 'daily', 'changed-quote', 'late-quote', 'late-quantity'])('rejects %s controls without certifying selected extras', async mode => {
    const page = await browser.newPage();
    try {
      await page.route('https://www.discovercars.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture(mode) }));
      await page.goto(url);
      await expect(captureDiscoverCarsExtras(page, url, search, products())).rejects.toThrow();
    } finally { await page.close(); }
  });

  it.each(['over-limit', 'wrong-id', 'preselected', 'duplicate-product'])('rejects %s product evidence before accepting a selection', async mode => {
    const page = await browser.newPage(), raw = products();
    if (mode === 'over-limit') raw[0]!.maxQuantity = 1;
    if (mode === 'wrong-id') raw[0]!.idWithMap = '5_17671';
    if (mode === 'preselected') raw[0]!.selectedCount = 1;
    if (mode === 'duplicate-product') raw.push({ ...raw[0]! });
    try {
      await page.route('https://www.discovercars.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture() }));
      await page.goto(url);
      await expect(captureDiscoverCarsExtras(page, url, search, raw)).rejects.toThrow();
    } finally { await page.close(); }
  });
});

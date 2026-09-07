import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from 'playwright';
import { launchBrowser } from '../scraper/browser';
import { collectDiscoverCarsOffers, fillDiscoverCarsSearch, submitDiscoverCarsSearch } from './discovercars-navigation';
import { prepareCarPage } from './navigation';
import { validateCarSearch } from './validation';

const location = { name: 'Example Airport (EXA)', country: 'GB', timeZone: 'Europe/London', providerIds: { discovercars: '1712' } };
const search = validateCarSearch({ pickup: location, dropoff: location, pickupAt: { date: '2026-12-30', time: '14:30' }, dropoffAt: { date: '2027-01-03', time: '09:00' }, driver: { age: 23, licenceYears: 2, residenceCountry: 'GB' }, currency: 'GBP', sources: ['discovercars'] }, new Date('2026-09-01'));
const request = { PickupLocationId: 1712, DropOffLocationId: 1712, PickupDateTime: '2026-12-30T14:30:00', DropOffDateTime: '2027-01-03T09:00:00', DriverAge: 23, ResidenceCountry: 'GB' };
const query = (value = request) => new URLSearchParams({ sq: Buffer.from(JSON.stringify(value)).toString('base64') }).toString();
const offerUrl = (value = request) => `https://www.discovercars.com/offer/11111111-2222-4333-8444-555555555555-RATE?${query(value)}`;

function form(currency: string, ambiguous = false): string {
  const select = (id: string, initial: string, labels: string[], className = '') => `<div id="${id}" class="${className}"><div class="CustomSelect-SelectHandler">${initial}</div><ul hidden>${labels.map(label => `<li class="CustomSelect-SelectOption">${label}</li>`).join('')}</ul></div>`;
  return `<style>[hidden]{display:none!important}</style>
    <button id="currency">${currency}</button><div id="currencies" hidden><div data-testid="currency-switcher" role="button"><span>GBP</span></div><div data-testid="currency-switcher" role="button"><span>GBP</span></div></div>
    <form><label><input type="checkbox" name="IsSameLocation">Return car in same location</label>
    ${['PickupLocation', 'DropoffLocation'].map(name => `<div class="SearchModifier-LocationAutocomplete"><input name="${name}" value="Old Airport"><div class="Autocomplete"></div><input type="hidden" name="${name}Id" value="999"></div>`).join('')}
    ${select('sb-country', 'United States of America (USA)', ['United States of America (USA)', 'United Kingdom'])}
    ${select('sb-age', '30-65', ['23', '30-65', '66', '80+'])}
    <button type="button" class="DatePicker-CalendarField">Pick-up date</button><div id="calendar" hidden><span class="Calendar-ThisMonth"></span><button type="button" class="Calendar-ToPrevMonth">Previous</button><button type="button" class="Calendar-ToNextMonth">Next</button><div id="months"></div></div>
    <output id="pickup-date"></output><output id="dropoff-date"></output>
    ${select('pickup-time', '11:00 am', ['11:00 am', '2:30 pm', '9:00 am'], 'SearchModifier-TimeSelect')}
    ${select('dropoff-time', '11:00 am', ['11:00 am', '2:30 pm', '9:00 am'], 'SearchModifier-TimeSelect')}
    <button type="submit">Search now</button></form>
    <script>
    const $ = selector => document.querySelector(selector);
    $('#currency').onclick = () => { $('#currencies').hidden = false; };
    document.querySelectorAll('[data-testid="currency-switcher"]').forEach(item => { item.onclick = () => { location.href = '/?currency=GBP'; }; });
    setTimeout(() => document.querySelectorAll('.CustomSelect-SelectHandler').forEach(handler => {
      handler.onclick = () => { handler.nextElementSibling.hidden = !handler.nextElementSibling.hidden; };
      handler.nextElementSibling.querySelectorAll('li').forEach(option => { option.onclick = () => { handler.textContent = option.textContent; handler.nextElementSibling.hidden = true; }; });
    }), 150);
    document.querySelectorAll('.SearchModifier-LocationAutocomplete input:not([type=hidden])').forEach(input => {
      input.oninput = () => {
        const choices = input.parentElement.querySelector('.Autocomplete'); choices.replaceChildren();
        if (!input.value) return;
        const item = document.createElement('div'); item.className = 'Autocomplete-AutocompleteItem';
        const label = document.createElement('span'); label.className = 'Autocomplete-AutocompletePlace'; label.textContent = input.value === 'Return Airport (EXB)' ? 'Return Airport (EXB)' : 'Example Airport (EXA)'; item.append(label);
        item.onclick = () => { input.value = label.textContent; input.parentElement.querySelector('[type=hidden]').value = label.textContent === 'Return Airport (EXB)' ? '1600' : '1712'; choices.replaceChildren(); };
        choices.append(item);
        if (${ambiguous}) choices.append(item.cloneNode(true));
      };
    });
    let month = 8, year = 2026, selected = 0;
    function renderMonths() {
      $('#months').replaceChildren();
      $('.Calendar-ThisMonth').textContent = new Date(Date.UTC(year, month, 1)).toLocaleDateString('en-US', {month:'long',year:'numeric',timeZone:'UTC'});
      for (let offset = 0; offset < 2; offset++) {
        const start = new Date(Date.UTC(year,month+offset,1)), block = document.createElement('div'); block.className = 'rdrMonth';
        const heading = document.createElement('div'); heading.className = 'rdrMonthName'; heading.textContent = start.toLocaleDateString('en-US',{month:'short',year:'numeric',timeZone:'UTC'}); block.append(heading);
        for (let day = 1; day <= new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,0)).getUTCDate(); day++) {
          const button = document.createElement('button'); button.type = 'button'; button.className = 'rdrDay'; button.textContent = String(day);
          button.onclick = () => { const date = new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),day)).toISOString().slice(0,10); $(selected++ % 2 === 0 ? '#pickup-date' : '#dropoff-date').textContent = date; if (selected % 2 === 0) $('#calendar').hidden = true; }; block.append(button);
        }
        $('#months').append(block);
      }
    }
    $('.DatePicker-CalendarField').onclick = () => { $('#calendar').hidden = false; renderMonths(); };
    $('.Calendar-ToPrevMonth').onclick = () => { month--; renderMonths(); };
    $('.Calendar-ToNextMonth').onclick = () => { month++; renderMonths(); };
    $('form').onsubmit = event => {
      event.preventDefault();
      const time = id => ({'2:30 pm':'14:30','9:00 am':'09:00','11:00 am':'11:00'}[$('#'+id+' .CustomSelect-SelectHandler').textContent]);
      const age = $('#sb-age .CustomSelect-SelectHandler').textContent;
      const data = { PickupLocationId:Number($('[name=PickupLocationId]').value), DropOffLocationId:Number($('[name=IsSameLocation]').checked ? $('[name=PickupLocationId]').value : $('[name=DropoffLocationId]').value), PickupDateTime:$('#pickup-date').textContent+'T'+time('pickup-time')+':00', DropOffDateTime:$('#dropoff-date').textContent+'T'+time('dropoff-time')+':00', DriverAge:age==='30-65'?35:Number(age), ResidenceCountry:$('#sb-country .CustomSelect-SelectHandler').textContent==='United Kingdom'?'GB':'US' };
      location.href = '/search/fresh?' + new URLSearchParams({sq:btoa(JSON.stringify(data))});
    };
    </script>`;
}

describe.skipIf(process.env.TRAVEL_BROWSER_TESTS !== '1')('DiscoverCars request controls in Chromium', () => {
  let browser: Browser;
  beforeAll(async () => { browser = await launchBrowser(); });
  afterAll(async () => { await browser?.close(); });

  it('preserves a cross-year rental, explicit times, age and residence after a currency reload', async () => {
    const page = await browser.newPage();
    try {
      await prepareCarPage(page, 'discovercars');
      // HTTP boundary fixture. Redirect security itself has separate live-server tests.
      await page.route('https://www.discovercars.com/**', route => {
        const url = new URL(route.request().url());
        return route.fulfill({ contentType: 'text/html', body: url.pathname.startsWith('/search/')
          ? `<button>GBP</button><a class="SearchCar-CtaBtn" href="${offerUrl()}">Select</a>`
          : form(url.searchParams.get('currency') ?? 'USD') });
      });
      await page.goto('https://www.discovercars.com/');
      await fillDiscoverCarsSearch(page, search);
      expect(await page.locator('[name=IsSameLocation]').isChecked()).toBe(true);
      expect(await page.locator('[name=PickupLocationId]').inputValue()).toBe('1712');
      expect(await page.locator('#pickup-date').textContent()).toBe('2026-12-30');
      expect(await page.locator('#dropoff-date').textContent()).toBe('2027-01-03');
      expect(await submitDiscoverCarsSearch(page, search)).toEqual([offerUrl()]);
      expect(new URL(page.url()).searchParams.get('sq')).toBe(new URLSearchParams(query()).get('sq'));
    } finally { await page.close(); }
  });

  it('rejects unsupported exact ages instead of substituting the provider age bucket', async () => {
    const page = await browser.newPage();
    try { await expect(fillDiscoverCarsSearch(page, { ...search, driver: { ...search.driver, age: 45 } })).rejects.toThrow(/exact driver age/); }
    finally { await page.close(); }
  });

  it('replaces a one-way return and moves the calendar backward for a subsequent search', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(form('GBP'));
      const later = validateCarSearch({ ...search, pickupAt: { date: '2027-03-15', time: '14:30' }, dropoffAt: { date: '2027-03-18', time: '09:00' }, dropoff: { ...location, name: 'Return Airport (EXB)', providerIds: { discovercars: '1600' } } }, new Date('2026-09-01'));
      await fillDiscoverCarsSearch(page, later);
      expect(await page.locator('[name=IsSameLocation]').isChecked()).toBe(false);
      expect(await page.locator('[name=DropoffLocationId]').inputValue()).toBe('1600');
      await fillDiscoverCarsSearch(page, search);
      expect(await page.locator('[name=IsSameLocation]').isChecked()).toBe(true);
      expect(await page.locator('#pickup-date').textContent()).toBe('2026-12-30');
      expect(await page.locator('#dropoff-date').textContent()).toBe('2027-01-03');
    } finally { await page.close(); }
  });

  it('rejects duplicate location labels instead of selecting an arbitrary office', async () => {
    const page = await browser.newPage();
    try {
      await page.setContent(form('GBP', true));
      await expect(fillDiscoverCarsSearch(page, search)).rejects.toThrow(/unambiguously/);
      expect(await page.locator('[name=PickupLocationId]').inputValue()).toBe('999');
    } finally { await page.close(); }
  });

  it('rejects a currency change that reloads into the wrong displayed currency', async () => {
    const page = await browser.newPage();
    try {
      await prepareCarPage(page, 'discovercars');
      page.setDefaultTimeout(1500);
      await page.route('https://www.discovercars.com/**', route => route.fulfill({ contentType: 'text/html', body: form('USD') }));
      await page.goto('https://www.discovercars.com/');
      await expect(fillDiscoverCarsSearch(page, search)).rejects.toThrow(/currency/);
      expect(await page.locator('[name=PickupLocationId]').inputValue()).toBe('999');
    } finally { await page.close(); }
  });

  it.each([
    ['changed submitted location', `https://www.discovercars.com/search/fresh?${query({ ...request, PickupLocationId: 999 })}`, offerUrl()],
    ['changed quote age', `https://www.discovercars.com/search/fresh?${query()}`, offerUrl({ ...request, DriverAge: 35 })],
    ['foreign quote', `https://www.discovercars.com/search/fresh?${query()}`, 'https://attacker.example/offer/quote'],
  ])('rejects %s before returning offers', async (_, url, link) => {
    const page = await browser.newPage();
    try {
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: `<button>GBP</button><a class="SearchCar-CtaBtn" href="${link}">Select</a>` }));
      await page.goto(url);
      await expect(collectDiscoverCarsOffers(page, search)).rejects.toThrow();
    } finally { await page.close(); }
  });
});

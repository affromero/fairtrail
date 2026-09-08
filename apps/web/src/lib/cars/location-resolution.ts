import type { Page } from 'playwright';
import { CarError, type CarLocation, type CarSearch, type CarSource } from './types';
import { getCarCatalogPlace, carCityNameIsUnambiguous } from './locations';
import { normalizeCarPlace, type CarLocationChoice } from './location-types';
import { carRecord, carText } from './validation';
import { discoverCarsCountryName } from './discovercars-navigation';
import { navigateCarPage } from './navigation';
import { openCarControl } from './controls';

interface Suggestion { id: string; name: string; city: string; country: string; kind: string; code: string | null }
const US_STATES = new Set([
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
  'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky',
  'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
  'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico',
  'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania',
  'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont',
  'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia',
].map(normalizeCarPlace));

function discoverCarsState(country: string): string | undefined {
  const state = /^USA - (.+)$/.exec(country)?.[1];
  return state && US_STATES.has(normalizeCarPlace(state)) ? state : undefined;
}

function countryMatches(place: CarLocationChoice, country: string, source: CarSource): boolean {
  const expected = source === 'autoeurope' ? place.country : discoverCarsCountryName(place.country);
  if (normalizeCarPlace(country) === normalizeCarPlace(expected)) return true;
  if (source !== 'discovercars' || place.country !== 'US') return false;
  const state = discoverCarsState(country);
  if (!state) return false;
  return place.kind === 'airport' || normalizeCarPlace(place.region) === normalizeCarPlace(state);
}
function providerId(raw: unknown): string {
  if (typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0) return String(raw);
  const id = carText(raw, 40, 'provider location identity');
  if (!/^\d+$/.test(id)) throw new CarError('Provider returned an invalid location identity');
  return id;
}

export function carLocationSuggestions(raw: unknown, source: CarSource): Suggestion[] {
  const body = carRecord(raw);
  if (source === 'discovercars') {
    if (body.success !== true || !Array.isArray(body.result) || body.result.length > 1000) throw new CarError('DiscoverCars location response is invalid');
    return body.result.map(raw => {
      const r = carRecord(raw), name = carText(r.place, 250, 'provider location');
      return { id: providerId(r.placeID), name, city: carText(r.city, 250, 'provider city'), country: carText(r.country, 100, 'provider country'), kind: carText(r.location, 40, 'provider location kind'), code: /\(([A-Z]{3})\)/.exec(name)?.[1] ?? null };
    });
  }
  if (!Array.isArray(body.data) || body.data.length > 10) throw new CarError('Auto Europe location response is invalid');
  const rows = body.data.flatMap(raw => {
    const group = carRecord(raw);
    if (!Array.isArray(group.locations) || group.locations.length > 1000) throw new CarError('Auto Europe location response is too large');
    return group.locations;
  });
  if (rows.length > 1000) throw new CarError('Auto Europe location response is too large');
  return rows.map(raw => {
    const r = carRecord(raw);
    return { id: providerId(r.location_id), name: carText(r.name, 250, 'provider location'), city: carText(r.city_name, 250, 'provider city'), country: carText(r.country_code, 2, 'provider country').toUpperCase(), kind: r.location_type_id === 1 ? 'airport' : r.location_type_id === 2 ? 'city' : 'other', code: typeof r.code === 'string' ? r.code : null };
  });
}

export async function matchCarProviderLocation(place: CarLocationChoice, suggestions: Suggestion[], source: CarSource): Promise<{ id: string; name: string }> {
  const downtown = (row: Suggestion) => normalizeCarPlace(row.name) === normalizeCarPlace(`${row.city} Downtown`);
  const candidates = suggestions.filter(row => countryMatches(place, row.country, source) && (row.kind === place.kind
    || source === 'discovercars' && place.kind === 'city' && row.kind === 'downtown' && downtown(row)));
  const matches: Suggestion[] = [];
  for (const row of candidates) {
    if (place.kind === 'airport' && row.code === place.iata) matches.push(row);
    const region = source === 'discovercars' ? discoverCarsState(row.country) : undefined;
    if (place.kind === 'city' && (normalizeCarPlace(row.name) === normalizeCarPlace(row.city) || downtown(row)) && await carCityNameIsUnambiguous(place, row.city, region)) matches.push(row);
  }
  const unique = [...new Map(matches.map(row => [row.id, row])).values()];
  if (unique.length !== 1) throw new CarError(`The provider could not uniquely match ${place.name}, ${place.country}; choose a specific airport or another location. No nearby station was substituted.`);
  return { id: unique[0]!.id, name: unique[0]!.name };
}

async function lookup(page: Page, place: CarLocationChoice, source: CarSource) {
  const query = place.iata ?? place.name;
  const input = page.locator(source === 'discovercars' ? 'input[name="PickupLocation"]' : '#pickup_location');
  await input.fill('');
  const responsePromise = page.waitForResponse(response => {
    const url = new URL(response.url());
    return source === 'discovercars' ? url.origin === 'https://www.discovercars.com' && url.pathname === '/api/v2/autocomplete' && url.searchParams.get('location') === query
      : url.origin === 'https://book.autoeurope.com' && url.pathname === '/en-us/locations/search' && url.searchParams.get('query_filter') === query;
  }, { timeout: 20_000 });
  // Attach both operations immediately so neither rejection becomes detached.
  const [response] = await Promise.all([responsePromise, input.fill(query)]);
  if (!response.ok() || Number(response.headers()['content-length']) > 2_000_000) throw new CarError('Provider location lookup failed or exceeded its response limit');
  const bytes = await response.body();
  if (bytes.length > 2_000_000) throw new CarError('Provider location response exceeded its limit');
  let raw: unknown;
  try { raw = JSON.parse(bytes.toString('utf8')); }
  catch { throw new CarError('Provider returned unreadable location data'); }
  return matchCarProviderLocation(place, carLocationSuggestions(raw, source), source);
}

/** Called only inside the provider's bounded, admitted browser execution. */
export async function resolveCarProviderLocations(page: Page, search: CarSearch, source: CarSource): Promise<CarSearch> {
  if (!search.pickup.catalog && !search.dropoff.catalog) return search;
  const places = await Promise.all([search.pickup, search.dropoff].map(async location => {
    if (!location.catalog) return null;
    const place = await getCarCatalogPlace(location.catalog.id, location.catalog.version);
    const canonicalZone = new Intl.DateTimeFormat('en', { timeZone: place.timeZone }).resolvedOptions().timeZone;
    if (place.name !== location.name || place.country !== location.country || canonicalZone !== location.timeZone) throw new CarError('Stored rental geography does not match its catalog identity');
    return place;
  }));
  await navigateCarPage(page, source === 'discovercars' ? 'https://www.discovercars.com/' : 'https://book.autoeurope.com/en-us/', source);
  if (source === 'discovercars') {
    const country = page.locator('#sb-country');
    await openCarControl(country.locator('.CustomSelect-SelectHandler'), country.locator('.CustomSelect-SelectOption:visible').first());
    await country.locator('.CustomSelect-SelectOption:visible').first().click();
  } else {
    const reject = page.getByRole('button', { name: 'Reject', exact: true });
    await reject.waitFor({ state: 'visible', timeout: 5000 }).catch(() => undefined);
    if (await reject.isVisible()) await reject.click();
    if (await page.locator('#drivers_age_checkbox').isChecked()) await page.locator('label[for="drivers_age_checkbox"]').click();
    await page.locator('#drivers_age').fill(String(search.driver.age));
  }
  const resolved = new Map<string, { id: string; name: string }>();
  for (const place of places) if (place && !resolved.has(place.id)) resolved.set(place.id, await lookup(page, place, source));
  const apply = (location: CarLocation): CarLocation => {
    const match = location.catalog ? resolved.get(location.catalog.id) : undefined;
    return match ? { ...location, providerIds: { ...location.providerIds, [source]: match.id }, providerNames: { ...location.providerNames, [source]: match.name } } : location;
  };
  return { ...search, pickup: apply(search.pickup), dropoff: apply(search.dropoff) };
}

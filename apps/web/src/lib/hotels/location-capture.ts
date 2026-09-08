import type { Page } from 'playwright';
import type { HotelLocation, HotelSource } from './types';
import { hotelLocation } from './location';

function agreedLocation(locations: HotelLocation[]): HotelLocation | null {
  const first = locations[0];
  if (!first || locations.some(point => point.latitude !== first.latitude || point.longitude !== first.longitude)) return null;
  return first;
}

export function googlePropertyLocation(url: string, name: string, scripts: string[]): HotelLocation | null {
  const parsed = new URL(url);
  const entity = parsed.pathname.match(/^\/travel\/hotels\/entity\/([^/]+)\/?$/)?.[1];
  if (parsed.hostname !== 'www.google.com' || !entity || !name.trim()) return null;
  const propertyId = `google_hotels:${parsed.pathname}`;
  const locations: HotelLocation[] = [];
  for (const script of scripts) {
    if (!script.startsWith('AF_initDataCallback(') || script.length > 4_000_000) continue;
    const start = script.indexOf('data:');
    const end = script.lastIndexOf(', sideChannel:');
    if (start < 0 || end <= start) continue;
    try {
      const data: unknown = JSON.parse(script.slice(start + 5, end));
      const record: unknown = Array.isArray(data) ? data[0] : null;
      if (!Array.isArray(record) || record[20] !== entity || record[1] !== name.trim()) continue;
      const pair: unknown = Array.isArray(record[2]) ? record[2][0] : null;
      if (!Array.isArray(pair) || pair.length !== 2) continue;
      const location = hotelLocation({ propertyId, latitude: pair[0], longitude: pair[1] }, propertyId);
      if (location) locations.push(location);
    } catch {
      // Provider scripts are data only; unsupported syntax is never executed.
      continue;
    }
  }
  return agreedLocation(locations);
}

export function bookingPropertyLocation(url: string, name: string, pins: { title: string; coordinates: string }[]): HotelLocation | null {
  const parsed = new URL(url);
  if (parsed.hostname !== 'www.booking.com' || !/^\/hotel\/[a-z]{2}\/[^/]+\.html$/.test(parsed.pathname) || !name.trim()) return null;
  const propertyId = `booking:${parsed.pathname.replace(/\.en-gb\.html$/, '.html')}`;
  const propertyName = name.replace(/\s+\(Hotel\)\s+\([A-Z]{2,3}\)\s+deals$/i, '').trim();
  const locations = pins.filter(pin => pin.title.startsWith(`${propertyName},`) && pin.title.endsWith(' - Check location')).flatMap(pin => {
    const parts = pin.coordinates.split(',');
    if (parts.length !== 2 || parts.some(part => !/^-?\d+(?:\.\d+)?$/.test(part.trim()))) return [];
    const location = hotelLocation({ propertyId, latitude: Number(parts[0]), longitude: Number(parts[1]) }, propertyId);
    return location ? [location] : [];
  });
  return agreedLocation(locations);
}

export async function captureHotelLocation(page: Page, source: HotelSource, name: string | undefined): Promise<HotelLocation | null> {
  if (!name) return null;
  if (source === 'booking') {
    const pins = await page.locator('#map_trigger_header_pin[data-atlas-latlng], #map_trigger_header[data-atlas-latlng]').evaluateAll(elements => elements.map(element => ({
      title: element.getAttribute('title') ?? '', coordinates: element.getAttribute('data-atlas-latlng') ?? '',
    })));
    return bookingPropertyLocation(page.url(), name, pins);
  }
  const scripts = await page.locator('script:not([src])').evaluateAll(elements => elements.map(element => element.textContent?.trim() ?? '').filter(text => text.startsWith('AF_initDataCallback(') && text.length <= 4_000_000));
  return googlePropertyLocation(page.url(), name, scripts);
}

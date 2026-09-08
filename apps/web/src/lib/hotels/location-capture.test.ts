import { describe, expect, it } from 'vitest';
import { bookingPropertyLocation, googlePropertyLocation } from './location-capture';

const googleUrl = 'https://www.google.com/travel/hotels/entity/hotel-entity';
function googleScript(entity = 'hotel-entity', name = "Mimi's Hotel Soho", pair: unknown = [51.5140711, -0.1319983]) {
  const record: unknown[] = Array.from({ length: 21 }, () => null);
  record[1] = name;
  record[2] = [pair, [['Nearby attraction', [1, 2]]]];
  record[20] = entity;
  return `AF_initDataCallback({key: 'ds:1', data:${JSON.stringify([record])}, sideChannel: {}});`;
}

describe('provider-owned hotel locations', () => {
  it('reads only the Google point bound to the current entity and hotel name', () => {
    expect(googlePropertyLocation(googleUrl, "Mimi's Hotel Soho", [googleScript()]))
      .toEqual({ propertyId: 'google_hotels:/travel/hotels/entity/hotel-entity', latitude: 51.5140711, longitude: -0.1319983 });
  });

  it('rejects unrelated entities, unrelated names and mixed search pages', () => {
    expect(googlePropertyLocation(googleUrl, "Mimi's Hotel Soho", [googleScript('other')])).toBeNull();
    expect(googlePropertyLocation(googleUrl, 'Another Hotel', [googleScript()])).toBeNull();
    expect(googlePropertyLocation('https://www.google.com/travel/hotels/London', "Mimi's Hotel Soho", [googleScript()])).toBeNull();
  });

  it('does not choose between conflicting Google property coordinates', () => {
    expect(googlePropertyLocation(googleUrl, "Mimi's Hotel Soho", [googleScript(), googleScript('hotel-entity', "Mimi's Hotel Soho", [51.5, -0.2])])).toBeNull();
  });

  it('does not execute callback expressions or search nearby points when the property point is malformed', () => {
    expect(googlePropertyLocation(googleUrl, "Mimi's Hotel Soho", [googleScript().replace('data:', 'data:globalThis.invalidExpression() || ')] )).toBeNull();
    expect(googlePropertyLocation(googleUrl, "Mimi's Hotel Soho", [googleScript('hotel-entity', "Mimi's Hotel Soho", [999, 999])])).toBeNull();
  });

  const bookingUrl = 'https://www.booking.com/hotel/gb/strandpalace.en-gb.html';
  const pin = { title: 'Strand Palace, London - Check location', coordinates: '51.51071897849308,-0.12107491493225098' };

  it('binds Booking header points to the named property and canonical property identity', () => {
    expect(bookingPropertyLocation(bookingUrl, 'Strand Palace (Hotel) (UK) deals', [pin, pin]))
      .toEqual({ propertyId: 'booking:/hotel/gb/strandpalace.html', latitude: 51.51071897849308, longitude: -0.12107491493225098 });
  });

  it('rejects Booking search pages and another hotel’s map link', () => {
    expect(bookingPropertyLocation('https://www.booking.com/searchresults.html', 'Strand Palace', [pin])).toBeNull();
    expect(bookingPropertyLocation(bookingUrl, 'Another Hotel', [pin])).toBeNull();
  });

  it('leaves conflicting or malformed Booking locations unknown', () => {
    expect(bookingPropertyLocation(bookingUrl, 'Strand Palace', [pin, { ...pin, coordinates: '52,1' }])).toBeNull();
    for (const coordinates of ['', ',', '51,', '51,0,4', 'NaN,0', '91,0']) {
      expect(bookingPropertyLocation(bookingUrl, 'Strand Palace', [{ ...pin, coordinates }])).toBeNull();
    }
  });
});

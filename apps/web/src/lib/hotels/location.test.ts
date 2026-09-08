import { describe, expect, it } from 'vitest';
import { hotelLocation } from './location';

describe('hotel map location evidence', () => {
  const propertyId = 'booking:/hotel/gb/strandpalace.html';

  it('accepts property-bound locations including the equator and prime meridian', () => {
    expect(hotelLocation({ propertyId, latitude: 0, longitude: 0 }, propertyId))
      .toEqual({ propertyId, latitude: 0, longitude: 0 });
  });

  it('does not place a hotel using another property’s coordinates', () => {
    expect(hotelLocation({ propertyId: 'booking:/hotel/gb/other.html', latitude: 51.51, longitude: -0.12 }, propertyId)).toBeNull();
  });

  it.each([undefined, null, {}, [], '51,-0.1'])('leaves absent or malformed historical locations unmapped: %j', value => {
    expect(hotelLocation(value, propertyId)).toBeNull();
  });

  it.each([[91, 0], [-91, 0], [0, 181], [0, -181], [NaN, 0], [0, Infinity], ['51', -0.1]])('rejects invalid coordinates %j', (latitude, longitude) => {
    expect(hotelLocation({ propertyId, latitude, longitude }, propertyId)).toBeNull();
  });

  it('returns only bounded location evidence, excluding provider payloads', () => {
    expect(hotelLocation({ propertyId, latitude: 51.51, longitude: -0.12, payload: 'private provider data' }, propertyId))
      .toEqual({ propertyId, latitude: 51.51, longitude: -0.12 });
  });
});

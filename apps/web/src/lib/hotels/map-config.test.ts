import { describe, expect, it } from 'vitest';
import { DEFAULT_HOTEL_MAP_CONFIG, hotelMapResourceUrl, validateHotelMapConfig, validateHotelMapPreferences } from './map-config';

const custom = { ...DEFAULT_HOTEL_MAP_CONFIG, provider: 'custom', styleUrl: 'https://maps.example.org/style.json', resourceOrigins: ['https://maps.example.org'], providerName: 'Example maps' };

describe('map settings boundaries', () => {
  it('keeps OpenFreeMap defaults independent of arbitrary submitted endpoints', () => {
    expect(validateHotelMapConfig({ ...DEFAULT_HOTEL_MAP_CONFIG, styleUrl: 'https://other.example/style', enabled: false }))
      .toEqual({ ...DEFAULT_HOTEL_MAP_CONFIG, enabled: false });
  });

  it('accepts explicit HTTPS providers and reverse-proxied same-origin maps', () => {
    expect(validateHotelMapConfig(custom).styleUrl).toBe(custom.styleUrl);
    expect(validateHotelMapConfig({ ...custom, styleUrl: '/maps/style.json', resourceOrigins: [] }).styleUrl).toBe('/maps/style.json');
  });

  it.each(['http://maps.example.org/style.json', 'https://user:secret@maps.example.org/style.json', 'https://maps.example.org/style.json?key=secret', '/api/account/settings', '//maps.example.org/style.json', '/maps/../api/hotels', 'javascript:alert(1)'])('rejects unsafe or secret-bearing configuration URL %s', styleUrl => {
    expect(() => validateHotelMapConfig({ ...custom, styleUrl })).toThrow();
  });

  it('requires explicit resource origins and plain-text attribution', () => {
    expect(() => validateHotelMapConfig({ ...custom, resourceOrigins: [] })).toThrow(/origin/i);
    expect(() => validateHotelMapConfig({ ...custom, attribution: '<img src=x>' })).toThrow(/attribution/i);
  });

  it('resolves relative resources against their provider without permitting other origins', () => {
    const config = validateHotelMapConfig(custom);
    expect(hotelMapResourceUrl('tiles/1.pbf', config, 'https://finder.example')).toBe('https://maps.example.org/tiles/1.pbf');
    expect(() => hotelMapResourceUrl('https://unlisted.example/tile', config, 'https://finder.example')).toThrow(/origin/i);
    expect(() => hotelMapResourceUrl('https://finder.example/api/account/settings', config, 'https://finder.example')).toThrow(/maps/i);
  });

  it('allows local reverse-proxied maps but never other local application paths', () => {
    const config = validateHotelMapConfig({ ...custom, styleUrl: '/maps/style.json', resourceOrigins: [] });
    expect(hotelMapResourceUrl('tile.pbf', config, 'http://localhost:3003')).toBe('http://localhost:3003/maps/tile.pbf');
    expect(() => hotelMapResourceUrl('../api/hotels', config, 'http://localhost:3003')).toThrow();
  });

  it('limits personal preferences to presentation and does not accept endpoint overrides', () => {
    expect(validateHotelMapPreferences({ version: 1, style: 'bright', enabled: false })).toEqual({ version: 1, style: 'bright', enabled: false });
    expect(() => validateHotelMapPreferences({ version: 1, style: 'bright', enabled: true, styleUrl: 'https://other.example' })).toThrow();
    expect(() => validateHotelMapPreferences({ version: 2, style: 'bright', enabled: true })).toThrow();
  });
});

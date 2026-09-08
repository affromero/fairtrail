export const HOTEL_MAP_STYLES = ['liberty', 'positron', 'bright'] as const;
export const HOTEL_MAP_BROWSER_PREFERENCES_KEY = 'flight-finder:hotel-map:solo:v1';
export type HotelMapStyle = typeof HOTEL_MAP_STYLES[number];
export interface HotelMapPreferences { version: 1; style: HotelMapStyle; enabled: boolean }
export interface HotelMapSettings { config: HotelMapConfig; preferences: HotelMapPreferences; preferencesRevision?: number; account: boolean; actorScope?: string; error?: string }
export function hotelMapActorScope(userId: string | null): string { return userId ? `user:${userId}` : 'solo'; }
export interface HotelMapConfig {
  enabled: boolean;
  provider: 'openfreemap' | 'custom';
  styleUrl: string;
  resourceOrigins: string[];
  providerName: string;
  privacyUrl: string;
  attribution: string;
  attributionUrl: string;
}
export const DEFAULT_HOTEL_MAP_CONFIG: HotelMapConfig = {
  enabled: true, provider: 'openfreemap', styleUrl: 'https://tiles.openfreemap.org/styles/liberty',
  resourceOrigins: ['https://tiles.openfreemap.org'], providerName: 'OpenFreeMap',
  privacyUrl: 'https://openfreemap.org/privacy/', attribution: 'OpenFreeMap · OpenMapTiles · OpenStreetMap contributors',
  attributionUrl: 'https://www.openstreetmap.org/copyright',
};
export const DEFAULT_HOTEL_MAP_PREFERENCES: HotelMapPreferences = { version: 1, style: 'liberty', enabled: true };

export function validateHotelMapPreferences(value: unknown): HotelMapPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid map preferences');
  const entry = value as Record<string, unknown>;
  if (entry.version !== 1 || typeof entry.enabled !== 'boolean' || !HOTEL_MAP_STYLES.includes(entry.style as HotelMapStyle)) throw new Error('Invalid map preferences');
  if (Object.keys(entry).some(key => !['version', 'enabled', 'style'].includes(key))) throw new Error('Unsupported map preference');
  return { version: 1, enabled: entry.enabled, style: entry.style as HotelMapStyle };
}

function publicUrl(value: unknown, relative = false): string {
  if (typeof value !== 'string' || value.length > 2048 || value !== value.trim() || /[\\\s]/.test(value)) throw new Error('Map URLs must be public HTTPS URLs without credentials');
  if (relative && value.startsWith('/') && !value.startsWith('//')) {
    const parsed = new URL(value, 'https://map.invalid');
    if (!parsed.pathname.startsWith('/maps/') || parsed.search || parsed.hash) throw new Error('Same-origin maps must use /maps/ paths without query strings');
    return parsed.pathname;
  }
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash || parsed.search) throw new Error('Map URLs must use HTTPS without credentials, query strings or fragments');
  return parsed.href;
}

function plainText(value: unknown, label: string, limit: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[<>]/.test(value) || [...value].some(character => character.charCodeAt(0) < 32)) throw new Error(`Invalid map ${label}`);
  return value.trim();
}

export function validateHotelMapConfig(value: unknown): HotelMapConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid map configuration');
  const entry = value as Record<string, unknown>;
  const keys = ['enabled', 'provider', 'styleUrl', 'resourceOrigins', 'providerName', 'privacyUrl', 'attribution', 'attributionUrl'];
  if (Object.keys(entry).some(key => !keys.includes(key))) throw new Error('Unsupported map configuration field');
  if (typeof entry.enabled !== 'boolean' || !['openfreemap', 'custom'].includes(String(entry.provider))) throw new Error('Invalid map provider');
  if (entry.provider === 'openfreemap') return { ...DEFAULT_HOTEL_MAP_CONFIG, resourceOrigins: [...DEFAULT_HOTEL_MAP_CONFIG.resourceOrigins], enabled: entry.enabled };
  if (!Array.isArray(entry.resourceOrigins) || entry.resourceOrigins.length > 8) throw new Error('Choose at most eight map resource origins');
  const resourceOrigins = entry.resourceOrigins.map(origin => {
    const parsed = new URL(publicUrl(origin));
    if (parsed.pathname !== '/') throw new Error('Map resource origins cannot contain paths');
    return parsed.origin;
  });
  if (new Set(resourceOrigins).size !== resourceOrigins.length) throw new Error('Map resource origins must be distinct');
  const styleUrl = publicUrl(entry.styleUrl, true);
  if (!styleUrl.startsWith('/') && !resourceOrigins.includes(new URL(styleUrl).origin)) throw new Error('Allow the style URL origin in map resource origins');
  return {
    enabled: entry.enabled, provider: 'custom', styleUrl, resourceOrigins,
    providerName: plainText(entry.providerName, 'provider name', 80), privacyUrl: publicUrl(entry.privacyUrl, true),
    attribution: plainText(entry.attribution, 'attribution', 300), attributionUrl: publicUrl(entry.attributionUrl),
  };
}

/** Applied in the browser to every nested style/tile resource, before fetching. */
export function hotelMapResourceUrl(value: string, config: HotelMapConfig, appOrigin: string, base = config.styleUrl): string {
  const style = new URL(base, appOrigin);
  const url = new URL(value, style);
  if (url.username || url.password || url.hash || !['https:', 'http:'].includes(url.protocol)) throw new Error('Blocked map resource URL');
  if (url.origin === appOrigin) {
    if (!url.pathname.startsWith('/maps/')) throw new Error('Same-origin map resources must use /maps/');
  } else if (url.protocol !== 'https:' || !config.resourceOrigins.includes(url.origin)) throw new Error('Map resource origin is not allowed');
  return url.href;
}

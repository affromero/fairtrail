export interface CountryProfile {
  code: string;
  name: string;
  locale: string;
  timezones: string[];
  acceptLanguage: string;
  geolocation: { latitude: number; longitude: number };
}

export const COUNTRY_PROFILES: Record<string, CountryProfile> = {
  US: {
    code: 'US',
    name: 'United States',
    locale: 'en-US',
    timezones: ['America/New_York', 'America/Chicago', 'America/Los_Angeles'],
    acceptLanguage: 'en-US,en;q=0.9',
    geolocation: { latitude: 38.9072, longitude: -77.0369 },
  },
  GB: {
    code: 'GB',
    name: 'United Kingdom',
    locale: 'en-GB',
    timezones: ['Europe/London'],
    acceptLanguage: 'en-GB,en;q=0.9',
    geolocation: { latitude: 51.5074, longitude: -0.1278 },
  },
  DE: {
    code: 'DE',
    name: 'Germany',
    locale: 'de-DE',
    timezones: ['Europe/Berlin'],
    acceptLanguage: 'de-DE,de;q=0.9,en;q=0.8',
    geolocation: { latitude: 52.52, longitude: 13.405 },
  },
  FR: {
    code: 'FR',
    name: 'France',
    locale: 'fr-FR',
    timezones: ['Europe/Paris'],
    acceptLanguage: 'fr-FR,fr;q=0.9,en;q=0.8',
    geolocation: { latitude: 48.8566, longitude: 2.3522 },
  },
  ES: {
    code: 'ES',
    name: 'Spain',
    locale: 'es-ES',
    timezones: ['Europe/Madrid'],
    acceptLanguage: 'es-ES,es;q=0.9,en;q=0.8',
    geolocation: { latitude: 40.4168, longitude: -3.7038 },
  },
  IT: {
    code: 'IT',
    name: 'Italy',
    locale: 'it-IT',
    timezones: ['Europe/Rome'],
    acceptLanguage: 'it-IT,it;q=0.9,en;q=0.8',
    geolocation: { latitude: 41.9028, longitude: 12.4964 },
  },
  NL: {
    code: 'NL',
    name: 'Netherlands',
    locale: 'nl-NL',
    timezones: ['Europe/Amsterdam'],
    acceptLanguage: 'nl-NL,nl;q=0.9,en;q=0.8',
    geolocation: { latitude: 52.3676, longitude: 4.9041 },
  },
  IE: {
    code: 'IE',
    name: 'Ireland',
    locale: 'en-IE',
    timezones: ['Europe/Dublin'],
    acceptLanguage: 'en-IE,en;q=0.9',
    geolocation: { latitude: 53.3498, longitude: -6.2603 },
  },
  JP: {
    code: 'JP',
    name: 'Japan',
    locale: 'ja-JP',
    timezones: ['Asia/Tokyo'],
    acceptLanguage: 'ja-JP,ja;q=0.9,en;q=0.8',
    geolocation: { latitude: 35.6762, longitude: 139.6503 },
  },
  KR: {
    code: 'KR',
    name: 'South Korea',
    locale: 'ko-KR',
    timezones: ['Asia/Seoul'],
    acceptLanguage: 'ko-KR,ko;q=0.9,en;q=0.8',
    geolocation: { latitude: 37.5665, longitude: 126.978 },
  },
  IN: {
    code: 'IN',
    name: 'India',
    locale: 'en-IN',
    timezones: ['Asia/Kolkata'],
    acceptLanguage: 'en-IN,en;q=0.9,hi;q=0.8',
    geolocation: { latitude: 28.6139, longitude: 77.209 },
  },
  AU: {
    code: 'AU',
    name: 'Australia',
    locale: 'en-AU',
    timezones: ['Australia/Sydney', 'Australia/Melbourne'],
    acceptLanguage: 'en-AU,en;q=0.9',
    geolocation: { latitude: -33.8688, longitude: 151.2093 },
  },
  CA: {
    code: 'CA',
    name: 'Canada',
    locale: 'en-CA',
    timezones: ['America/Toronto', 'America/Vancouver'],
    acceptLanguage: 'en-CA,en;q=0.9,fr;q=0.8',
    geolocation: { latitude: 43.6532, longitude: -79.3832 },
  },
  MX: {
    code: 'MX',
    name: 'Mexico',
    locale: 'es-MX',
    timezones: ['America/Mexico_City'],
    acceptLanguage: 'es-MX,es;q=0.9,en;q=0.8',
    geolocation: { latitude: 19.4326, longitude: -99.1332 },
  },
  BR: {
    code: 'BR',
    name: 'Brazil',
    locale: 'pt-BR',
    timezones: ['America/Sao_Paulo'],
    acceptLanguage: 'pt-BR,pt;q=0.9,en;q=0.8',
    geolocation: { latitude: -23.5505, longitude: -46.6333 },
  },
  AR: {
    code: 'AR',
    name: 'Argentina',
    locale: 'es-AR',
    timezones: ['America/Argentina/Buenos_Aires'],
    acceptLanguage: 'es-AR,es;q=0.9,en;q=0.8',
    geolocation: { latitude: -34.6037, longitude: -58.3816 },
  },
  CO: {
    code: 'CO',
    name: 'Colombia',
    locale: 'es-CO',
    timezones: ['America/Bogota'],
    acceptLanguage: 'es-CO,es;q=0.9,en;q=0.8',
    geolocation: { latitude: 4.711, longitude: -74.0721 },
  },
  TH: {
    code: 'TH',
    name: 'Thailand',
    locale: 'th-TH',
    timezones: ['Asia/Bangkok'],
    acceptLanguage: 'th-TH,th;q=0.9,en;q=0.8',
    geolocation: { latitude: 13.7563, longitude: 100.5018 },
  },
  SG: {
    code: 'SG',
    name: 'Singapore',
    locale: 'en-SG',
    timezones: ['Asia/Singapore'],
    acceptLanguage: 'en-SG,en;q=0.9',
    geolocation: { latitude: 1.3521, longitude: 103.8198 },
  },
  HK: {
    code: 'HK',
    name: 'Hong Kong',
    locale: 'zh-HK',
    timezones: ['Asia/Hong_Kong'],
    acceptLanguage: 'zh-HK,zh;q=0.9,en;q=0.8',
    geolocation: { latitude: 22.3193, longitude: 114.1694 },
  },
};

export function getCountryProfile(code: string): CountryProfile | undefined {
  return COUNTRY_PROFILES[code.toUpperCase()];
}

export function getAvailableCountries(): CountryProfile[] {
  return Object.values(COUNTRY_PROFILES);
}

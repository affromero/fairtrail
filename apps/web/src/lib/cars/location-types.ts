export interface CarCatalogPlace {
  id: string;
  kind: 'airport' | 'city';
  name: string;
  city: string;
  country: string;
  region: string;
  timeZone: string;
  latitude: number;
  longitude: number;
  iata: string | null;
}
export interface CarCatalogRecord extends CarCatalogPlace {
  aliases: string[];
  population: number;
}
export interface CarLocationChoice extends CarCatalogPlace { version: string }

export function normalizeCarPlace(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

export function validateCarLocationChoice(raw: unknown): CarLocationChoice {
  const r = carRecord(raw), id = carText(r.id, 80, 'location identity'), version = carText(r.version, 64, 'catalog version');
  if (!/^(?:geonames|ourairports):\d+$/.test(id) || !/^[a-f0-9]{64}$/.test(version) || !['airport', 'city'].includes(String(r.kind))) throw new CarError('Invalid location suggestion');
  if (typeof r.latitude !== 'number' || !Number.isFinite(r.latitude) || Math.abs(r.latitude) > 90 || typeof r.longitude !== 'number' || !Number.isFinite(r.longitude) || Math.abs(r.longitude) > 180) throw new CarError('Invalid location coordinates');
  const country = carText(r.country, 2, 'country'), timeZone = carText(r.timeZone, 100, 'timezone');
  if (!isCarCountry(country)) throw new CarError('Invalid location country');
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { throw new CarError('Invalid location timezone'); }
  const iata = r.iata === null ? null : carText(r.iata, 3, 'airport code');
  if ((r.kind === 'airport') !== (iata !== null) || (iata !== null && !/^[A-Z]{3}$/.test(iata))) throw new CarError('Invalid location airport code');
  const optionalText = (value: unknown) => value === '' ? '' : carText(value, 250, 'location description');
  return { id, version, kind: r.kind as CarLocationChoice['kind'], name: carText(r.name, 250, 'location name'), city: optionalText(r.city), region: optionalText(r.region), country, timeZone, iata, latitude: r.latitude, longitude: r.longitude };
}
import { CarError } from './types';
import { carRecord, carText } from './validation';
import { isCarCountry } from './countries';

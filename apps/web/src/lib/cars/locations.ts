import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { StringDecoder } from 'node:string_decoder';
import { join } from 'node:path';
import { createGunzip, gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import manifest from '../../../data/car-locations/manifest.json';
import { CarError } from './types';
import { normalizeCarPlace, type CarCatalogRecord, type CarLocationChoice } from './location-types';

interface IndexedPlace { place: CarLocationChoice; text: string; population: number }
interface Catalog { rows: IndexedPlace[]; byId: Map<string, CarLocationChoice>; cityNames: Map<string, string | null>; regionalCityNames: Map<string, string | null> }
let loading: Promise<Catalog> | undefined;
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

export async function carLocationDataPath(): Promise<string> {
  const directory = join(process.cwd(), 'data', 'car-locations');
  try { await stat(join(directory, 'manifest.json')); return directory; }
  catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    return join(process.cwd(), 'apps', 'web', 'data', 'car-locations');
  }
}

export async function readCarLocationArchive(): Promise<Buffer> {
  const path = join(await carLocationDataPath(), 'catalog.json.gz');
  if ((await stat(path)).size !== manifest.compressedBytes) throw new CarError('Rental location catalog failed its integrity check', 503);
  const bytes = await readFile(path);
  if (bytes.length !== manifest.compressedBytes || digest(bytes) !== manifest.sha256) throw new CarError('Rental location catalog failed its integrity check', 503);
  return bytes;
}

export function decodeCarCatalog(bytes: Buffer): CarCatalogRecord[] {
  if (bytes.length !== manifest.compressedBytes || digest(bytes) !== manifest.sha256) throw new CarError('Rental location catalog failed its integrity check', 503);
  const decoded = gunzipSync(bytes, { maxOutputLength: 150_000_000 });
  if (decoded.length !== manifest.uncompressedBytes || digest(decoded) !== manifest.version) throw new CarError('Rental location catalog failed its integrity check', 503);
  const records: unknown = decoded.toString('utf8').trimEnd().split('\n').map(line => JSON.parse(line) as unknown);
  if (!Array.isArray(records) || records.length !== manifest.count || records.length > 300_000) throw new CarError('Rental location catalog has an invalid size', 503);
  return records as CarCatalogRecord[];
}

/** Verify both representations while indexing incrementally, without a full JSON copy. */
async function readCatalog(visit: (record: CarCatalogRecord) => void): Promise<void> {
  const compressedHash = createHash('sha256'), contentHash = createHash('sha256'), decoder = new StringDecoder('utf8');
  let compressedBytes = 0, uncompressedBytes = 0, count = 0, pending = '';
  await pipeline(createReadStream(join(await carLocationDataPath(), 'catalog.json.gz')), new Transform({ transform(chunk: Buffer, encoding, callback) {
    compressedBytes += chunk.length;
    if (compressedBytes > manifest.compressedBytes) { callback(new CarError('Rental catalog exceeds its compressed size limit', 503)); return; }
    compressedHash.update(chunk); callback(null, chunk);
  } }), createGunzip(), new Writable({ write(chunk: Buffer, encoding, callback) {
    try {
      uncompressedBytes += chunk.length;
      if (uncompressedBytes > manifest.uncompressedBytes || uncompressedBytes > 150_000_000) throw new CarError('Rental catalog exceeds its decompression limit', 503);
      contentHash.update(chunk); pending += decoder.write(chunk);
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        if (newline > 16_000 || ++count > manifest.count || count > 300_000) throw new CarError('Rental catalog exceeds its record limit', 503);
        const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        visit(JSON.parse(line) as CarCatalogRecord);
      }
      if (pending.length > 16_000) throw new CarError('Rental catalog record is too large', 503);
      callback();
    } catch (error) { callback(error instanceof Error ? error : new Error('Invalid rental catalog')); }
  } }));
  pending += decoder.end();
  if (pending || count !== manifest.count || compressedBytes !== manifest.compressedBytes || uncompressedBytes !== manifest.uncompressedBytes || compressedHash.digest('hex') !== manifest.sha256 || contentHash.digest('hex') !== manifest.version) throw new CarError('Rental location catalog failed its integrity check', 503);
}

async function catalog(): Promise<Catalog> {
  if (!loading) loading = (async () => {
    const countries = new Intl.DisplayNames(['en'], { type: 'region' });
    const rows: IndexedPlace[] = [], byId = new Map<string, CarLocationChoice>(), cityNames = new Map<string, string | null>(), regionalCityNames = new Map<string, string | null>();
    await readCatalog(record => {
      const { aliases, population, ...location } = record;
      const place = { ...location, version: manifest.version };
      if (byId.has(place.id)) throw new CarError('Duplicate rental location identity', 503);
      byId.set(place.id, place);
      rows.push({ place, population, text: normalizeCarPlace([place.name, place.city, place.country, countries.of(place.country), place.region, place.iata, ...aliases].join(' ')) });
      if (place.kind !== 'city') return;
      for (const name of new Set([normalizeCarPlace(place.name), ...aliases])) {
        const key = `${place.country}:${name}`, previous = cityNames.get(key);
        cityNames.set(key, previous === undefined || previous === place.id ? place.id : null);
        const regionalKey = `${place.country}:${normalizeCarPlace(place.region)}:${name}`, regionalPrevious = regionalCityNames.get(regionalKey);
        regionalCityNames.set(regionalKey, regionalPrevious === undefined || regionalPrevious === place.id ? place.id : null);
      }
    });
    return { rows, byId, cityNames, regionalCityNames };
  })().catch(error => { loading = undefined; throw error; });
  return loading;
}

export async function searchCarLocations(query: string): Promise<CarLocationChoice[]> {
  if (query.length > 100 || /\p{Cc}/u.test(query)) throw new CarError('Location search must be at most 100 characters');
  const normalized = normalizeCarPlace(query);
  if (normalized.length < 2) return [];
  const terms = normalized.split(' '), matches: (IndexedPlace & { rank: number })[] = [];
  for (const row of (await catalog()).rows) {
    if (!terms.every(term => row.text.includes(term))) continue;
    const rank = row.place.iata?.toLowerCase() === normalized ? 3 : normalizeCarPlace(row.place.name) === normalized ? 2 : 1;
    matches.push({ ...row, rank });
  }
  matches.sort((a, b) => b.rank - a.rank || b.population - a.population || a.place.id.localeCompare(b.place.id));
  return matches.slice(0, 12).map(row => row.place);
}

export async function getCarCatalogPlace(id: string, version?: string): Promise<CarLocationChoice> {
  if (version !== undefined && version !== manifest.version) throw new CarError('Location data changed; select the location again', 409);
  const place = (await catalog()).byId.get(id);
  if (!place) throw new CarError('Choose a rental location from the search suggestions');
  return place;
}

export async function carCityNameIsUnambiguous(place: CarLocationChoice, name: string, region?: string): Promise<boolean> {
  if (region !== undefined) {
    if (!region || normalizeCarPlace(region) !== normalizeCarPlace(place.region)) return false;
    return (await catalog()).regionalCityNames.get(`${place.country}:${normalizeCarPlace(region)}:${normalizeCarPlace(name)}`) === place.id;
  }
  return (await catalog()).cityNames.get(`${place.country}:${normalizeCarPlace(name)}`) === place.id;
}

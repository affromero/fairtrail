import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { parse } from 'csv-parse/sync';
import { find } from 'geo-tz/all';
import { normalizeCarPlace as normalize, type CarCatalogRecord as Place } from '../apps/web/src/lib/cars/location-types';

const target = resolve('apps/web/data/car-locations');
const cache = resolve(process.env.CAR_CATALOG_SOURCE_DIR ?? '/tmp/flight-finder-car-catalog');
const refresh = process.argv.includes('--refresh-sources');
const sources = [
  { name: 'airports.csv', url: 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/4c7db4c0773966354c044d50f6c32c68f6387bd0/airports.csv' },
  { name: 'cities500.zip', url: 'https://download.geonames.org/export/dump/cities500.zip' },
  { name: 'admin1CodesASCII.txt', url: 'https://download.geonames.org/export/dump/admin1CodesASCII.txt' },
];
const hash = (value: Uint8Array | string) => createHash('sha256').update(value).digest('hex');
await mkdir(cache, { recursive: true });
await mkdir(target, { recursive: true });
const previous = refresh ? null : JSON.parse(await readFile(resolve(target, 'manifest.json'), 'utf8')) as { sources: { name: string; sha256: string }[] };
const inputs: { name: string; url: string; sha256: string }[] = [];
for (const source of sources) {
  let data: Buffer;
  try {
    if (refresh) throw Object.assign(new Error('Refreshing source'), { code: 'ENOENT' });
    if ((await stat(resolve(cache, source.name))).size > 80_000_000) throw new Error('Source archive exceeds its size budget');
    data = await readFile(resolve(cache, source.name));
  }
  catch (error) {
    if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')) throw error;
    const response = await fetch(source.url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Catalog download failed: ${source.name} HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > 80_000_000) throw new Error('Source archive exceeds its size budget');
    const chunks: Uint8Array[] = []; let bytes = 0;
    for await (const chunk of response.body!) {
      bytes += chunk.length;
      if (bytes > 80_000_000) throw new Error('Source archive exceeds its size budget');
      chunks.push(chunk);
    }
    data = Buffer.concat(chunks);
    await writeFile(resolve(cache, source.name), data);
  }
  const sha256 = hash(data);
  if (previous && previous.sources.find(item => item.name === source.name)?.sha256 !== sha256) throw new Error(`Source checksum changed: ${source.name}; review before refreshing`);
  inputs.push({ ...source, sha256 });
}

const regions = new Map((await readFile(resolve(cache, 'admin1CodesASCII.txt'), 'utf8')).trim().split('\n').map(line => { const row = line.split('\t'); return [row[0]!, row[1]!] as const; }));
const places: Place[] = [];
const cities = execFileSync('unzip', ['-p', resolve(cache, 'cities500.zip'), 'cities500.txt'], { maxBuffer: 180_000_000 }).toString('utf8');
for (const line of cities.trim().split('\n')) {
  const r = line.split('\t');
  if (r.length !== 19 || r[6] !== 'P' || !r[17] || !/^[A-Z]{2}$/.test(r[8]!)) continue;
  const timeZone = r[17];
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { continue; }
  const latitude = Number(r[4]), longitude = Number(r[5]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
  places.push({ id: `geonames:${r[0]}`, kind: 'city', name: r[1]!, city: r[1]!, country: r[8]!, region: regions.get(`${r[8]}.${r[10]}`) ?? '', timeZone, latitude, longitude, aliases: [...new Set([r[2]!, ...r[3]!.split(',')].filter(name => name.length <= 150).map(normalize))].slice(0, 32), population: Number(r[14]), iata: null });
}
const airports = parse(await readFile(resolve(cache, 'airports.csv')), { columns: true, skip_empty_lines: true }) as Record<string, string>[];
const codeCounts = new Map<string, number>();
for (const row of airports) if (row.iata_code) codeCounts.set(row.iata_code, (codeCounts.get(row.iata_code) ?? 0) + 1);
let rejectedAirports = 0;
for (const r of airports) {
  if (!['large_airport', 'medium_airport', 'small_airport'].includes(r.type!) || !/^[A-Z]{3}$/.test(r.iata_code!) || codeCounts.get(r.iata_code!) !== 1 || !/^[A-Z]{2}$/.test(r.iso_country!)) continue;
  const latitude = Number(r.latitude_deg), longitude = Number(r.longitude_deg);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) continue;
  const zones = find(latitude, longitude);
  if (zones.length !== 1 || zones[0]!.startsWith('Etc/')) { rejectedAirports++; continue; }
  const timeZone = zones[0]!;
  try { new Intl.DateTimeFormat('en', { timeZone }); } catch { rejectedAirports++; continue; }
  places.push({ id: `ourairports:${r.id}`, kind: 'airport', name: r.name!, city: r.municipality ?? '', country: r.iso_country!, region: r.iso_region ?? '', timeZone, latitude, longitude, aliases: [...new Set([r.name!, r.municipality ?? '', r.iata_code!, r.icao_code ?? ''].filter(Boolean).map(normalize))], population: r.type === 'large_airport' ? 10_000_000 : r.type === 'medium_airport' ? 1_000_000 : 0, iata: r.iata_code! });
}
places.sort((a, b) => a.id.localeCompare(b.id, 'en'));
if (places.length < 100_000 || places.length > 300_000 || new Set(places.map(place => place.id)).size !== places.length) throw new Error('Unexpected catalog count or duplicate identity');
const bytes = Buffer.from(places.map(place => JSON.stringify(place)).join('\n') + '\n');
if (bytes.length > 150_000_000) throw new Error('Catalog exceeds the runtime decompression budget');
const compressed = gzipSync(bytes, { level: 9 });
const timezoneData = await readFile(resolve('node_modules/geo-tz/data/timezones.geojson.geo.dat'));
const manifest = { version: hash(bytes), generatorVersion: 2, format: 'ndjson', sources: inputs, timezone: { package: 'geo-tz', version: '8.1.8', product: 'comprehensive', sha256: hash(timezoneData) }, count: places.length, airports: places.filter(p => p.kind === 'airport').length, rejectedAirports, uncompressedBytes: bytes.length, compressedBytes: compressed.length, sha256: hash(compressed) };
await writeFile(resolve(target, 'catalog.json.gz'), compressed);
await writeFile(resolve(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(JSON.stringify(manifest, null, 2));

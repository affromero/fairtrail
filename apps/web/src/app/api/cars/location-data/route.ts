import { readCarLocationArchive } from '@/lib/cars/locations';
import { apiError } from '@/lib/api-response';

export async function GET() {
  try {
    const bytes = await readCarLocationArchive();
    return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/gzip', 'Content-Disposition': 'attachment; filename="car-locations.jsonl.gz"', 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) { console.error('[cars] Location data download failed:', error); return apiError('Location data is temporarily unavailable', 503); }
}

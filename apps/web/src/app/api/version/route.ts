import { apiSuccess } from '@/lib/api-response';
import pkg from '../../../../package.json';

export const dynamic = 'force-dynamic';
export const revalidate = 3600; // check at most once per hour

export async function GET() {
  const current = pkg.version;
  let latest: string | null = null;

  try {
    const res = await fetch(
      'https://api.github.com/repos/afromero/fairtrail/releases/latest',
      {
        headers: { Accept: 'application/vnd.github.v3+json' },
        next: { revalidate: 3600 },
      }
    );
    if (res.ok) {
      const data = await res.json();
      latest = (data.tag_name as string)?.replace(/^v/, '') ?? null;
    }
  } catch {
    // GitHub unreachable — just return current
  }

  return apiSuccess({
    current,
    latest,
    updateAvailable: latest ? latest !== current : false,
  });
}

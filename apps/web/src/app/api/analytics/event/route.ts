import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { getRawDb } from '@/lib/analytics/db';
import { apiSuccess, apiError } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { path, duration, scrollDepth } = body;

    if (!path || typeof duration !== 'number') {
      return apiError('Invalid payload', 400);
    }

    const db = getRawDb();
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;

    const forwardedFor = request.headers.get('x-forwarded-for');
    const ip = forwardedFor?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || '127.0.0.1';
    const userAgent = request.headers.get('user-agent') || '';

    const dateStr = new Date().toISOString().slice(0, 10);
    const saltRow = db.prepare('SELECT salt FROM daily_salts WHERE date = ?').get(dateStr) as
      | { salt: string }
      | undefined;

    if (!saltRow) {
      return apiSuccess({ ok: true });
    }

    const visitorId = createHash('sha256')
      .update(`${ip}|${userAgent}|${saltRow.salt}`)
      .digest('hex')
      .slice(0, 16);

    db.prepare(
      `UPDATE page_events
       SET duration_ms = ?, scroll_depth = ?, bot_score = 0, is_bot = 0
       WHERE id = (
         SELECT id FROM page_events
         WHERE visitor_id = ? AND path = ? AND timestamp >= ?
         ORDER BY timestamp DESC
         LIMIT 1
       )`,
    ).run(Math.min(duration, 30 * 60 * 1000), scrollDepth, visitorId, path, fiveMinAgo);

    return apiSuccess({ ok: true });
  } catch {
    return apiError('Failed to process event', 500);
  }
}

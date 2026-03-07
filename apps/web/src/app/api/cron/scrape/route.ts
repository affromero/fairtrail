import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { runScrapeAll, cleanupUnvisitedQueries } from '@/lib/scraper/run-scrape';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (!authHeader || authHeader !== expected) {
    return apiError('Unauthorized', 401);
  }

  // Clean up queries never visited within 24h
  const deletedUnvisited = await cleanupUnvisitedQueries();

  const results = await runScrapeAll();

  const summary = {
    deletedUnvisited,
    queriesProcessed: results.length,
    successful: results.filter((r) => r.status === 'success').length,
    partial: results.filter((r) => r.status === 'partial').length,
    failed: results.filter((r) => r.status === 'failed').length,
    totalSnapshots: results.reduce((sum, r) => sum + r.snapshotsCount, 0),
    totalCost: results.reduce((sum, r) => sum + r.extractionCost, 0),
    results,
  };

  return apiSuccess(summary);
}

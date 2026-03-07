import { prisma } from '@/lib/prisma';
import { navigateGoogleFlights } from './navigate';
import { extractPrices } from './extract-prices';
import { getModelCosts } from './ai-registry';

interface ScrapeResult {
  queryId: string;
  status: 'success' | 'partial' | 'failed';
  snapshotsCount: number;
  extractionCost: number;
  error?: string;
}

export async function runScrapeForQuery(queryId: string): Promise<ScrapeResult> {
  const query = await prisma.query.findUnique({ where: { id: queryId } });
  if (!query || !query.active) {
    return { queryId, status: 'failed', snapshotsCount: 0, extractionCost: 0, error: 'Query not found or inactive' };
  }

  const fetchRun = await prisma.fetchRun.create({
    data: { queryId, status: 'in_progress' },
  });

  try {
    // Navigate to Google Flights
    const { html, url } = await navigateGoogleFlights(query);
    const travelDateFallback = query.dateFrom.toISOString().split('T')[0]!;

    // Extract prices via LLM with user's filters
    const filters = {
      maxPrice: query.maxPrice,
      maxStops: query.maxStops,
      preferredAirlines: query.preferredAirlines,
      timePreference: query.timePreference,
      cabinClass: query.cabinClass,
    };
    const { prices, usage } = await extractPrices(html, url, travelDateFallback, filters);

    // Calculate cost
    const config = await prisma.extractionConfig.findFirst({ where: { id: 'singleton' } });
    const provider = config?.provider ?? 'anthropic';
    const model = config?.model ?? 'claude-haiku-4-5-20251001';
    const costs = getModelCosts(provider, model);
    const extractionCost =
      (usage.inputTokens / 1000) * costs.costPer1kInput +
      (usage.outputTokens / 1000) * costs.costPer1kOutput;

    // Log API usage
    await prisma.apiUsageLog.create({
      data: {
        provider,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: extractionCost,
        operation: 'extract-prices',
        durationMs: 0,
      },
    });

    // Save price snapshots
    if (prices.length > 0) {
      await prisma.priceSnapshot.createMany({
        data: prices.map((p) => ({
          queryId,
          travelDate: new Date(p.travelDate),
          price: p.price,
          currency: p.currency,
          airline: p.airline,
          bookingUrl: p.bookingUrl,
          stops: p.stops,
          duration: p.duration,
          fetchRunId: fetchRun.id,
        })),
      });
    }

    // Update fetch run
    await prisma.fetchRun.update({
      where: { id: fetchRun.id },
      data: {
        status: prices.length > 0 ? 'success' : 'partial',
        snapshotsCount: prices.length,
        extractionCost,
        completedAt: new Date(),
      },
    });

    return {
      queryId,
      status: prices.length > 0 ? 'success' : 'partial',
      snapshotsCount: prices.length,
      extractionCost,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);

    await prisma.fetchRun.update({
      where: { id: fetchRun.id },
      data: {
        status: 'failed',
        error: errorMsg,
        completedAt: new Date(),
      },
    });

    return { queryId, status: 'failed', snapshotsCount: 0, extractionCost: 0, error: errorMsg };
  }
}

export async function cleanupUnvisitedQueries(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const result = await prisma.query.deleteMany({
    where: { firstViewedAt: null, createdAt: { lt: cutoff } },
  });
  return result.count;
}

export async function runScrapeAll(): Promise<ScrapeResult[]> {
  // Get global scrape interval default
  const config = await prisma.extractionConfig.findFirst({ where: { id: 'singleton' } });
  const globalInterval = config?.scrapeInterval ?? 6;

  const activeQueries = await prisma.query.findMany({
    where: {
      active: true,
      expiresAt: { gt: new Date() },
    },
    include: {
      fetchRuns: {
        orderBy: { startedAt: 'desc' },
        take: 1,
        select: { startedAt: true },
      },
    },
  });

  // Filter: only scrape if enough time has passed since last run
  const now = Date.now();
  const dueQueries = activeQueries.filter((q) => {
    const lastRun = q.fetchRuns[0];
    if (!lastRun) return true; // never scraped
    const hoursSince = (now - lastRun.startedAt.getTime()) / (1000 * 60 * 60);
    return hoursSince >= globalInterval;
  });

  const results: ScrapeResult[] = [];

  // Run sequentially to avoid overwhelming Google Flights
  for (const query of dueQueries) {
    const result = await runScrapeForQuery(query.id);
    results.push(result);

    // Delay between queries to reduce detection risk
    if (activeQueries.indexOf(query) < activeQueries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000 + Math.random() * 5000));
    }
  }

  return results;
}

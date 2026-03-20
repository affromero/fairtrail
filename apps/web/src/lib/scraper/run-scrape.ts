import { mkdir, writeFile } from 'fs/promises';
import { prisma } from '@/lib/prisma';
import { navigateGoogleFlights, navigateAirlineDirect, type NavigationResult } from './navigate';
import { extractPrices, type ExtractionFailureReason } from './extract-prices';
import { getModelCosts } from './ai-registry';
import { isKnownAirline } from './airline-urls';

const RETRYABLE_FAILURES: ExtractionFailureReason[] = ['empty_extraction', 'page_not_loaded', 'no_json_in_response'];
const MAX_EXTRACT_ATTEMPTS = 2;
const DEBUG_DIR = '/tmp/fairtrail-debug';

async function saveDebugHtml(queryId: string, html: string, attempt: number): Promise<void> {
  try {
    await mkdir(DEBUG_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const path = `${DEBUG_DIR}/${queryId}-attempt${attempt}-${ts}.html`;
    await writeFile(path, html, 'utf-8');
    console.log(`[scrape] saved debug HTML → ${path} (${html.length} chars)`);
  } catch (err) {
    console.log(`[scrape] failed to save debug HTML: ${err instanceof Error ? err.message : err}`);
  }
}

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
    // Fetch config early for currency/country resolution and model costs
    const config = await prisma.extractionConfig.findFirst({ where: { id: 'singleton' } });

    // 3-tier currency resolution: query-level > admin config default > null (auto-detect)
    const effectiveCurrency = query.currency ?? config?.defaultCurrency ?? null;
    const effectiveCountry = config?.defaultCountry ?? null;

    // For seed queries, compute rolling date window from today
    const searchParams = query.isSeed
      ? {
          origin: query.origin,
          destination: query.destination,
          dateFrom: new Date(),
          dateTo: new Date(Date.now() + query.lookAheadDays * 24 * 60 * 60 * 1000),
          cabinClass: query.cabinClass,
          tripType: query.tripType,
          currency: effectiveCurrency,
          country: effectiveCountry,
        }
      : { ...query, cabinClass: query.cabinClass, tripType: query.tripType, currency: effectiveCurrency, country: effectiveCountry };

    // Route: airline-direct for single known airline, Google Flights otherwise
    const directAirlines = query.preferredAirlines.filter(isKnownAirline);
    const useAirlineDirect = directAirlines.length > 0;

    const travelDateFallback = searchParams.dateFrom.toISOString().split('T')[0]!;
    const filters = {
      maxPrice: query.maxPrice,
      maxStops: query.maxStops,
      preferredAirlines: query.preferredAirlines,
      timePreference: query.timePreference,
      cabinClass: query.cabinClass,
    };
    const provider = config?.provider ?? 'anthropic';
    const model = config?.model ?? 'claude-haiku-4-5-20251001';
    const costs = getModelCosts(provider, model);

    let allPrices: import('./extract-prices').PriceData[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let lastFailureReason: string | undefined;
    const sources = new Set<string>();

    async function navigateAll(): Promise<NavigationResult[]> {
      if (useAirlineDirect) {
        return Promise.all(
          directAirlines.map(async (airline) => {
            try {
              return await navigateAirlineDirect(searchParams, airline);
            } catch {
              return navigateGoogleFlights(searchParams);
            }
          })
        );
      }
      return [await navigateGoogleFlights(searchParams)];
    }

    for (let attempt = 1; attempt <= MAX_EXTRACT_ATTEMPTS; attempt++) {
      console.log(`[scrape] query=${queryId} extract attempt ${attempt}/${MAX_EXTRACT_ATTEMPTS}`);

      const navResults = await navigateAll();

      for (const nav of navResults) {
        sources.add(nav.source);
        const { prices, usage, failureReason } = await extractPrices(
          nav.html, nav.url, travelDateFallback, filters, undefined, nav.resultsFound, nav.source, effectiveCurrency
        );
        allPrices = allPrices.concat(prices);
        totalInputTokens += usage.inputTokens;
        totalOutputTokens += usage.outputTokens;
        if (failureReason) {
          lastFailureReason = failureReason;
          await saveDebugHtml(queryId, nav.html, attempt);
        }
      }

      if (allPrices.length > 0) break;

      // Retry only for transient failures
      if (attempt < MAX_EXTRACT_ATTEMPTS && lastFailureReason && RETRYABLE_FAILURES.includes(lastFailureReason as ExtractionFailureReason)) {
        const delay = 5000 + Math.random() * 5000;
        console.log(`[scrape] query=${queryId} retrying after ${Math.round(delay)}ms (reason: ${lastFailureReason})`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    // Deduplicate by airline + price + date
    const seen = new Set<string>();
    allPrices = allPrices.filter((p) => {
      const key = `${p.airline}:${p.price}:${p.travelDate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Sort by price
    allPrices.sort((a, b) => a.price - b.price);

    const extractionCost =
      (totalInputTokens / 1000) * costs.costPer1kInput +
      (totalOutputTokens / 1000) * costs.costPer1kOutput;

    // Log API usage
    await prisma.apiUsageLog.create({
      data: {
        provider,
        model,
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        costUsd: extractionCost,
        operation: 'extract-prices',
        durationMs: 0,
      },
    });

    // Build stable flightId for each price
    const withFlightIds = allPrices.map((p) => {
      const timePart = (p.departureTime ?? '').replace(/[^0-9]/g, '') || '0000';
      const airlinePart = p.airline.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
      const flightId = `${airlinePart}-${timePart}-${query.origin}-${query.destination}-${p.travelDate}`;
      return { ...p, flightId };
    });

    // Sold-out detection: compare with previous scrape
    const previousSnapshots = await prisma.priceSnapshot.findMany({
      where: {
        queryId,
        flightId: { not: null },
      },
      orderBy: { scrapedAt: 'desc' },
      distinct: ['flightId'],
      select: { flightId: true, price: true, airline: true, travelDate: true, currency: true, bookingUrl: true, stops: true, duration: true, status: true },
    });

    const currentFlightIds = new Set(withFlightIds.map((p) => p.flightId));
    const soldOutSnapshots = previousSnapshots
      .filter((prev) => prev.flightId && !currentFlightIds.has(prev.flightId) && prev.status === 'available')
      .map((prev) => ({
        queryId,
        travelDate: prev.travelDate,
        price: prev.price,
        currency: prev.currency,
        airline: prev.airline,
        bookingUrl: prev.bookingUrl,
        stops: prev.stops,
        duration: prev.duration,
        flightId: prev.flightId,
        status: 'sold_out' as const,
        fetchRunId: fetchRun.id,
      }));

    // Save price snapshots
    if (withFlightIds.length > 0) {
      await prisma.priceSnapshot.createMany({
        data: withFlightIds.map((p) => ({
          queryId,
          travelDate: new Date(p.travelDate),
          price: p.price,
          currency: p.currency,
          airline: p.airline,
          bookingUrl: p.bookingUrl,
          stops: p.stops,
          duration: p.duration,
          flightId: p.flightId,
          seatsLeft: p.seatsLeft ?? null,
          fetchRunId: fetchRun.id,
        })),
      });
    }

    // Record sold-out flights
    if (soldOutSnapshots.length > 0) {
      await prisma.priceSnapshot.createMany({
        data: soldOutSnapshots,
      });
    }

    // Build error message for 0-result runs
    console.log(`[scrape] query=${queryId} finished — ${allPrices.length} prices, cost=$${extractionCost.toFixed(4)}`);
    const failureReason = allPrices.length === 0 ? lastFailureReason : undefined;
    const failureMessages: Record<string, string> = {
      page_not_loaded: 'Page did not load results — blocked, CAPTCHA, or timeout.',
      no_json_in_response: 'LLM response contained no parseable JSON array. Page HTML may be a consent wall, error page, or empty shell.',
      empty_extraction: 'LLM parsed the page but returned 0 flights. Page likely loaded without flight content (rate-limited or empty response).',
      all_filtered_out: 'Flights were extracted but all removed by query filters (price/stops/airline).',
    };
    const errorMsg = failureReason ? failureMessages[failureReason] : undefined;

    // Track which source(s) were used
    const sourceLabel = sources.size === 1 ? [...sources][0]! : [...sources].join('+');

    // Update fetch run
    await prisma.fetchRun.update({
      where: { id: fetchRun.id },
      data: {
        status: allPrices.length > 0 ? 'success' : 'failed',
        source: sourceLabel,
        snapshotsCount: allPrices.length,
        extractionCost,
        error: errorMsg,
        completedAt: new Date(),
      },
    });

    return {
      queryId,
      status: allPrices.length > 0 ? 'success' : 'failed',
      snapshotsCount: allPrices.length,
      extractionCost,
      error: errorMsg,
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
    where: { firstViewedAt: null, createdAt: { lt: cutoff }, isSeed: false },
  });
  return result.count;
}

async function trySyncToHub(): Promise<void> {
  try {
    const { syncToHub } = await import(/* webpackIgnore: true */ '../community-sync');
    await syncToHub();
  } catch (err) {
    console.error('[community] Sync error:', err instanceof Error ? err.message : err);
  }
}

let scrapeInProgress = false;

export async function runScrapeAll(): Promise<ScrapeResult[]> {
  if (scrapeInProgress) {
    throw new Error('Scrape already in progress');
  }
  scrapeInProgress = true;
  try {
    return await runScrapeAllInner();
  } finally {
    scrapeInProgress = false;
  }
}

async function runScrapeAllInner(): Promise<ScrapeResult[]> {
  // Get global scrape interval default
  const config = await prisma.extractionConfig.findFirst({ where: { id: 'singleton' } });
  const globalInterval = config?.scrapeInterval ?? 3;

  const activeQueries = await prisma.query.findMany({
    where: {
      active: true,
      OR: [
        { isSeed: true },
        { expiresAt: { gt: new Date() } },
      ],
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
  // Use per-query scrapeInterval, falling back to global default
  const now = Date.now();
  const dueQueries = activeQueries.filter((q) => {
    const lastRun = q.fetchRuns[0];
    if (!lastRun) return true; // never scraped
    const hoursSince = (now - lastRun.startedAt.getTime()) / (1000 * 60 * 60);
    return hoursSince >= (q.scrapeInterval ?? globalInterval);
  });

  const results: ScrapeResult[] = [];

  console.log(`[scrape-all] ${dueQueries.length}/${activeQueries.length} queries due for scraping`);

  // Run sequentially to avoid overwhelming Google Flights
  for (const query of dueQueries) {
    const result = await runScrapeForQuery(query.id);
    results.push(result);

    // Delay between queries to reduce detection risk
    if (activeQueries.indexOf(query) < activeQueries.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 5000 + Math.random() * 5000));
    }
  }

  // Sync to community hub if opted in
  await trySyncToHub();

  return results;
}

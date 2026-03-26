import { mkdir, writeFile } from 'fs/promises';
import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { cached } from '@/lib/redis';
import { prisma } from '@/lib/prisma';
import { navigateGoogleFlights, navigateAirlineDirect } from '@/lib/scraper/navigate';
import { extractPrices, type PriceData, type ExtractionFailureReason } from '@/lib/scraper/extract-prices';
import { getModelCosts } from '@/lib/scraper/ai-registry';
import { isKnownAirline } from '@/lib/scraper/airline-urls';
import { createHash } from 'crypto';
import { hasValidInvite } from '@/lib/invite-auth';
import type { Airport } from '@/lib/scraper/parse-query';

const RETRYABLE_FAILURES: ExtractionFailureReason[] = ['empty_extraction', 'page_not_loaded', 'no_json_in_response'];
const MAX_ATTEMPTS = 2;
const DEBUG_DIR = '/tmp/fairtrail-debug';

const PREVIEW_MAX_RESULTS = 20;

export interface RouteResult {
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
  flights: PriceData[];
  date?: string; // ISO date — outbound date when grouped by travel date
  returnDate?: string; // ISO date — return date for round trips
  error?: string;
}

function buildCacheKey(origin: string, destination: string, dateFrom: string, dateTo: string,
  cabinClass: string, tripType: string, currency: string | null): string {
  const hash = createHash('sha256')
    .update(`${origin}:${destination}:${dateFrom}:${dateTo}:${cabinClass}:${tripType}:${currency ?? 'auto'}`)
    .digest('hex')
    .slice(0, 16);
  return `preview:${hash}`;
}

interface ScrapeRouteParams {
  origin: string;
  destination: string;
  dateFrom: Date;
  dateTo: Date;
  dateFromStr: string;
  cabinClass: string;
  tripType: string;
  maxPrice: number | null;
  maxStops: number | null;
  preferredAirlines: string[];
  timePreference: string;
  currency: string | null;
}

async function scrapeRoute(params: ScrapeRouteParams): Promise<PriceData[]> {
  const { origin, destination, dateFrom, dateTo, dateFromStr, cabinClass, tripType } = params;

  const searchParams = { origin, destination, dateFrom, dateTo, cabinClass, tripType, currency: params.currency };
  const airlines: string[] = params.preferredAirlines;
  const directAirline = airlines.length === 1 && isKnownAirline(airlines[0]!) ? airlines[0]! : null;
  const filters = {
    maxPrice: params.maxPrice,
    maxStops: params.maxStops,
    preferredAirlines: airlines,
    timePreference: params.timePreference,
    cabinClass,
  };

  const config = await prisma.extractionConfig.findFirst({ where: { id: 'singleton' } });
  const provider = config?.provider ?? 'anthropic';
  const model = config?.model ?? 'claude-haiku-4-5-20251001';
  const costs = getModelCosts(provider, model);

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let lastFailureReason: ExtractionFailureReason | undefined;
  let lastSource: string = 'google_flights';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[preview] ${origin}→${destination} attempt ${attempt}/${MAX_ATTEMPTS}`);

    let nav;
    try {
      nav = directAirline
        ? await navigateAirlineDirect(searchParams, directAirline)
        : await navigateGoogleFlights(searchParams);
    } catch {
      nav = await navigateGoogleFlights(searchParams);
    }

    lastSource = nav.source;

    const { prices: extracted, usage, failureReason } = await extractPrices(
      nav.html,
      nav.url,
      dateFromStr,
      filters,
      PREVIEW_MAX_RESULTS,
      nav.resultsFound,
      nav.source,
      params.currency
    );

    totalInputTokens += usage.inputTokens;
    totalOutputTokens += usage.outputTokens;

    if (!failureReason) {
      const cost =
        (totalInputTokens / 1000) * costs.costPer1kInput +
        (totalOutputTokens / 1000) * costs.costPer1kOutput;

      await prisma.apiUsageLog.create({
        data: {
          provider,
          model,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          costUsd: cost,
          operation: 'preview-flights',
          durationMs: 0,
        },
      });

      console.log(`[preview] ${origin}→${destination} OK — ${extracted.length} flights (attempt ${attempt})`);
      return extracted;
    }

    lastFailureReason = failureReason;

    try {
      await mkdir(DEBUG_DIR, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const path = `${DEBUG_DIR}/preview-${origin}-${destination}-attempt${attempt}-${ts}.html`;
      await writeFile(path, nav.html, 'utf-8');
      console.log(`[preview] saved debug HTML → ${path} (${nav.html.length} chars)`);
    } catch {
      // ignore write errors
    }

    if (attempt < MAX_ATTEMPTS && RETRYABLE_FAILURES.includes(failureReason)) {
      const delay = 5000 + Math.random() * 5000;
      console.log(`[preview] ${origin}→${destination} retrying after ${Math.round(delay)}ms (reason: ${failureReason})`);
      await new Promise((r) => setTimeout(r, delay));
      continue;
    }
  }

  // All attempts failed — log and throw
  const totalCost =
    (totalInputTokens / 1000) * costs.costPer1kInput +
    (totalOutputTokens / 1000) * costs.costPer1kOutput;

  await prisma.apiUsageLog.create({
    data: {
      provider: (await prisma.extractionConfig.findFirst({ where: { id: 'singleton' } }))?.provider ?? 'anthropic',
      model: (await prisma.extractionConfig.findFirst({ where: { id: 'singleton' } }))?.model ?? 'claude-haiku-4-5-20251001',
      inputTokens: totalInputTokens,
      outputTokens: totalOutputTokens,
      costUsd: totalCost,
      operation: 'preview-flights',
      durationMs: 0,
      error: `[${lastFailureReason}] ${origin} → ${destination}`,
    },
  });

  const sourceName = lastSource === 'airline_direct' ? 'The airline website' : 'Google Flights';
  const messages: Record<string, string> = {
    page_not_loaded: `${sourceName} did not load results — blocked or CAPTCHA'd`,
    no_json_in_response: `Could not extract flight data from ${sourceName}`,
    empty_extraction: `No flights found — ${sourceName} may be rate-limiting`,
    all_filtered_out: `Flights exist but none matched your filters`,
  };
  throw new Error(messages[lastFailureReason!] ?? 'Flight extraction failed');
}

export async function POST(request: NextRequest) {
  if (!(await hasValidInvite())) {
    return apiError('Invite code required', 401);
  }

  const body = await request.json().catch(() => null);
  if (!body) return apiError('Invalid JSON body', 400);

  const { dateFrom, dateTo, maxPrice, maxStops, preferredAirlines, timePreference, cabinClass, tripType, currency: bodyCurrency } = body;
  const currency: string | null = typeof bodyCurrency === 'string' && bodyCurrency ? bodyCurrency : null;

  // Multi-date support: individual outbound/return dates
  const outboundDates: string[] | undefined = Array.isArray(body.outboundDates) ? body.outboundDates : undefined;
  const returnDates: string[] | undefined = Array.isArray(body.returnDates) ? body.returnDates : undefined;

  // Accept either arrays (new) or single values (legacy)
  const origins: Airport[] = Array.isArray(body.origins)
    ? body.origins
    : body.origin ? [{ code: body.origin, name: body.originName || body.origin }] : [];
  const destinations: Airport[] = Array.isArray(body.destinations)
    ? body.destinations
    : body.destination ? [{ code: body.destination, name: body.destinationName || body.destination }] : [];

  if (origins.length === 0 || destinations.length === 0 || !dateFrom || !dateTo) {
    return apiError('Missing required fields: origins, destinations, dateFrom, dateTo', 400);
  }

  // Validate all airport codes
  for (const a of [...origins, ...destinations]) {
    if (!/^[A-Z]{3}$/.test(a.code)) {
      return apiError(`Invalid airport code "${a.code}" — must be 3 uppercase letters`, 400);
    }
  }

  const from = new Date(dateFrom + 'T00:00:00Z');
  const to = new Date(dateTo + 'T00:00:00Z');

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return apiError('Invalid date format', 400);
  }

  const isOneWay = tripType === 'one_way';
  if (!isOneWay && from >= to) {
    return apiError('dateFrom must be before dateTo', 400);
  }

  const airlines: string[] = Array.isArray(preferredAirlines) ? preferredAirlines : [];

  // Generate all origin × destination combos
  const combos: Array<{ origin: Airport; destination: Airport }> = [];
  for (const o of origins) {
    for (const d of destinations) {
      combos.push({ origin: o, destination: d });
    }
  }

  // Build scrape tasks: each task is one Google Flights request
  // When outboundDates present: one scrape per date per combo
  // Otherwise: one scrape per combo with the full date range
  interface ScrapeTask {
    combo: { origin: Airport; destination: Airport };
    outboundDate: string;     // ISO date for departure
    returnDate: string;       // ISO date for return (same as outbound for one-way)
  }

  const tasks: ScrapeTask[] = [];
  const datesToScrape = outboundDates ?? [dateFrom];

  for (const combo of combos) {
    for (let i = 0; i < datesToScrape.length; i++) {
      const outDate = datesToScrape[i]!;
      const retDate = isOneWay ? outDate : (returnDates?.[i] ?? dateTo);
      tasks.push({
        combo,
        outboundDate: outDate,
        returnDate: retDate,
      });
    }
  }

  // Safety cap: max 24 scrape tasks (6 dates × 4 combos)
  if (tasks.length > 24) {
    return apiError(`Too many date/route combinations (${tasks.length}). Max 6 dates × 4 routes = 24.`, 400);
  }

  try {
    const routes: RouteResult[] = [];

    // Scrape each task sequentially (avoid rate limits)
    for (const task of tasks) {
      const { combo, outboundDate, returnDate } = task;
      const taskFrom = new Date(outboundDate + 'T00:00:00Z');
      const taskTo = new Date(returnDate + 'T00:00:00Z');
      const cacheKey = buildCacheKey(combo.origin.code, combo.destination.code, outboundDate, returnDate, cabinClass || 'economy', tripType || 'round_trip', currency);

      try {
        const flights = await cached<PriceData[]>(cacheKey, () =>
          scrapeRoute({
            origin: combo.origin.code,
            destination: combo.destination.code,
            dateFrom: taskFrom,
            dateTo: taskTo,
            dateFromStr: outboundDate,
            cabinClass: cabinClass || 'economy',
            tripType: tripType || 'round_trip',
            maxPrice: maxPrice ? Number(maxPrice) : null,
            maxStops: maxStops !== undefined && maxStops !== null ? Number(maxStops) : null,
            preferredAirlines: airlines,
            timePreference: timePreference || 'any',
            currency,
          })
        );

        routes.push({
          origin: combo.origin.code,
          originName: combo.origin.name,
          destination: combo.destination.code,
          destinationName: combo.destination.name,
          flights,
          date: outboundDate,
          returnDate,
        });
      } catch (err) {
        // Partial failure — include route with error, continue with others
        routes.push({
          origin: combo.origin.code,
          originName: combo.origin.name,
          destination: combo.destination.code,
          destinationName: combo.destination.name,
          flights: [],
          date: outboundDate,
          returnDate,
          error: err instanceof Error ? err.message : 'Failed to search this route',
        });
      }
    }

    // If ALL routes failed, return error
    const hasFlights = routes.some((r) => r.flights.length > 0);
    if (!hasFlights) {
      const firstError = routes.find((r) => r.error)?.error ?? 'No flights found for any route';
      return apiError(firstError, 500);
    }

    // Backward compat: if single route, also include flat `flights` array
    if (routes.length === 1) {
      return apiSuccess({ flights: routes[0]!.flights, routes });
    }

    return apiSuccess({ routes });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to preview flights';
    return apiError(msg, 500);
  }
}

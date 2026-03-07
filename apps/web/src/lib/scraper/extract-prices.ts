import { EXTRACTION_PROVIDERS, type ExtractionUsage } from './ai-registry';
import { prisma } from '@/lib/prisma';

export interface PriceData {
  travelDate: string; // ISO date
  price: number;
  currency: string;
  airline: string;
  bookingUrl: string;
  stops: number;
  duration: string | null;
}

export interface QueryFilters {
  maxPrice: number | null;
  maxStops: number | null;
  preferredAirlines: string[];
  timePreference: string;
  cabinClass: string;
}

const MAX_RESULTS = 10;

function buildSystemPrompt(filters: QueryFilters): string {
  const filterRules: string[] = [];

  if (filters.maxPrice) {
    filterRules.push(`- ONLY include flights priced at or below $${filters.maxPrice}`);
  }
  if (filters.maxStops !== null) {
    filterRules.push(
      filters.maxStops === 0
        ? '- ONLY include nonstop/direct flights'
        : `- ONLY include flights with ${filters.maxStops} stop(s) or fewer`
    );
  }
  if (filters.preferredAirlines.length > 0) {
    filterRules.push(`- ONLY include flights operated by: ${filters.preferredAirlines.join(', ')}`);
  }
  if (filters.timePreference !== 'any') {
    const timeMap: Record<string, string> = {
      morning: 'departing before 12:00 PM',
      afternoon: 'departing between 12:00 PM and 6:00 PM',
      evening: 'departing after 6:00 PM',
      redeye: 'departing after 10:00 PM (red-eye flights)',
    };
    filterRules.push(`- Prefer flights ${timeMap[filters.timePreference] ?? ''}`);
  }

  const filterSection = filterRules.length > 0
    ? `\nFiltering rules (STRICT — do not include flights that violate these):\n${filterRules.join('\n')}\n`
    : '';

  return `You are a flight price data extractor. Given HTML from a Google Flights search results page, extract the best matching flight options.

Return ONLY valid JSON — an array of UP TO ${MAX_RESULTS} objects with this exact shape:
[
  {
    "travelDate": "YYYY-MM-DD",
    "price": 623,
    "currency": "USD",
    "airline": "Delta",
    "bookingUrl": "https://www.google.com/travel/flights/booking?...",
    "stops": 1,
    "duration": "11h 20m"
  }
]
${filterSection}
General rules:
- Return at most ${MAX_RESULTS} results, sorted by price (cheapest first)
- Price must be a number (no $ sign, no commas)
- If you can't find a direct booking URL, construct one from the Google Flights URL
- stops: 0 for nonstop, 1 for 1 stop, etc.
- duration: human-readable format like "8h 30m"
- If the travel date is not clearly visible per result, use the search date provided
- Prefer variety: if multiple airlines are available, include at least one from each (up to the ${MAX_RESULTS} limit)
- Return ONLY the JSON array, no markdown, no explanation
- If you cannot extract any flights, return an empty array []`;
}

export async function extractPrices(
  html: string,
  searchUrl: string,
  travelDateFallback: string,
  filters: QueryFilters = { maxPrice: null, maxStops: null, preferredAirlines: [], timePreference: 'any', cabinClass: 'economy' }
): Promise<{ prices: PriceData[]; usage: ExtractionUsage }> {
  const config = await prisma.extractionConfig.findFirst({
    where: { id: 'singleton' },
  });

  const provider = config?.provider ?? 'anthropic';
  const model = config?.model ?? 'claude-haiku-4-5-20251001';
  const providerConfig = EXTRACTION_PROVIDERS[provider];

  if (!providerConfig) {
    throw new Error(`Unknown extraction provider: ${provider}`);
  }

  const apiKey = process.env[providerConfig.envKey];
  if (!apiKey) {
    throw new Error(`Missing API key: ${providerConfig.envKey}`);
  }

  // Trim HTML to reduce token usage — keep only the main content area
  const trimmedHtml = trimFlightHtml(html);

  const userPrompt = `Search URL: ${searchUrl}
Default travel date (if not visible per result): ${travelDateFallback}

HTML content:
${trimmedHtml}`;

  const systemPrompt = buildSystemPrompt(filters);
  const result = await providerConfig.extract(apiKey, model, systemPrompt, userPrompt);

  const jsonMatch = result.content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return { prices: [], usage: result.usage };
  }

  const raw = JSON.parse(jsonMatch[0]) as PriceData[];

  // Filter out obviously invalid entries
  const prices = raw.filter(
    (p) => p.price > 0 && p.airline && p.airline.length > 0
  );

  return { prices, usage: result.usage };
}

function trimFlightHtml(html: string): string {
  // Remove script tags, style tags, and excessive whitespace
  let trimmed = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/>\s+</g, '><');

  // Cap at ~50k chars to stay within token limits
  if (trimmed.length > 50_000) {
    trimmed = trimmed.slice(0, 50_000);
  }

  return trimmed;
}

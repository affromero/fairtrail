import { EXTRACTION_PROVIDERS, type ExtractionResult } from './ai-registry';
import { prisma } from '@/lib/prisma';

export interface ParsedFlightQuery {
  origin: string;
  originName: string;
  destination: string;
  destinationName: string;
  dateFrom: string; // ISO date
  dateTo: string; // ISO date
  flexibility: number; // days
  maxPrice: number | null;
  maxStops: number | null; // 0 = nonstop only, 1 = max 1 stop, null = any
  preferredAirlines: string[]; // empty = no preference
  timePreference: 'any' | 'morning' | 'afternoon' | 'evening' | 'redeye';
  cabinClass: 'economy' | 'premium_economy' | 'business' | 'first';
}

const SYSTEM_PROMPT = `You are a flight query parser. Extract structured flight search parameters from natural language input.

Return ONLY valid JSON with this exact shape:
{
  "origin": "IATA airport code (3 letters, e.g. JFK)",
  "originName": "City name (e.g. New York)",
  "destination": "IATA airport code (3 letters, e.g. CDG)",
  "destinationName": "City name (e.g. Paris)",
  "dateFrom": "YYYY-MM-DD start of travel window",
  "dateTo": "YYYY-MM-DD end of travel window",
  "flexibility": number of days of flexibility (0 if exact dates),
  "maxPrice": number or null (e.g. 800 if user says "under $800"),
  "maxStops": number or null (0 if "nonstop"/"direct", 1 if "max 1 stop", null if no preference),
  "preferredAirlines": ["Delta", "United"] or [] if no preference,
  "timePreference": "any" | "morning" | "afternoon" | "evening" | "redeye",
  "cabinClass": "economy" | "premium_economy" | "business" | "first"
}

Rules:
- Use the most common airport for a city (NYC→JFK, London→LHR, Paris→CDG, Tokyo→NRT)
- If the user says "around June 15 ± 3 days", set dateFrom to June 12, dateTo to June 18, flexibility to 3
- If the user says "June 15-20", set dateFrom to June 15, dateTo to June 20, flexibility to 0
- If the user says "next month" or "sometime in July", use the full month range
- If the user says "flexible" without specifying days, use flexibility of 3
- Default cabinClass to "economy" unless stated otherwise
- Default timePreference to "any" unless stated (e.g. "morning flight" → "morning", "red-eye" → "redeye")
- Extract airline preferences if mentioned (e.g. "on Delta" → ["Delta"])
- Extract price caps if mentioned (e.g. "under $800", "budget", "cheap" → maxPrice of 500)
- If no stop preference stated, maxStops is null
- Today's date is ${new Date().toISOString().split('T')[0]}
- Return ONLY the JSON object, no markdown, no explanation`;

export async function parseFlightQuery(
  rawInput: string
): Promise<{ parsed: ParsedFlightQuery; usage: ExtractionResult['usage'] }> {
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

  const result = await providerConfig.extract(
    apiKey,
    model,
    SYSTEM_PROMPT,
    rawInput
  );

  const jsonMatch = result.content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse LLM response as JSON');
  }

  const parsed = JSON.parse(jsonMatch[0]) as ParsedFlightQuery;

  // Validate required fields
  if (!parsed.origin || !parsed.destination || !parsed.dateFrom || !parsed.dateTo) {
    throw new Error('Incomplete parsed query — missing required fields');
  }

  return { parsed, usage: result.usage };
}

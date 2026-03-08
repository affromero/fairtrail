import { EXTRACTION_PROVIDERS, type ExtractionResult } from './ai-registry';
import { prisma } from '@/lib/prisma';

export interface Airport {
  code: string; // IATA 3-letter code
  name: string; // City/airport name
}

export interface ParsedFlightQuery {
  origin: string;      // primary origin IATA code (first in origins array)
  originName: string;  // primary origin city name
  destination: string; // primary destination IATA code (first in destinations array)
  destinationName: string;
  origins: Airport[];      // all origin airports (e.g., JFK + EWR for "New York")
  destinations: Airport[]; // all destination airports (e.g., ORD + MDW for "Chicago")
  dateFrom: string; // ISO date
  dateTo: string; // ISO date
  flexibility: number; // days
  maxPrice: number | null;
  maxStops: number | null; // 0 = nonstop only, 1 = max 1 stop, null = any
  preferredAirlines: string[]; // empty = no preference
  timePreference: 'any' | 'morning' | 'afternoon' | 'evening' | 'redeye';
  cabinClass: 'economy' | 'premium_economy' | 'business' | 'first';
  tripType: 'one_way' | 'round_trip';
  currency: string; // ISO 4217 currency code (e.g., USD, EUR, GBP)
}

export interface ParseAmbiguity {
  field: 'date' | 'origin' | 'destination' | 'general';
  question: string;
  options?: string[];
}

export interface ParseResponse {
  parsed: ParsedFlightQuery | null;
  confidence: 'high' | 'medium' | 'low';
  ambiguities: ParseAmbiguity[];
  dateSpanDays: number;
}

function buildSystemPrompt(): string {
  const today = new Date().toISOString().split('T')[0];
  return `You are a flight query parser. Extract structured flight search parameters from natural language input.

Return ONLY valid JSON with this exact shape:
{
  "confidence": "high" | "medium" | "low",
  "ambiguities": [
    { "field": "date" | "origin" | "destination" | "general", "question": "clarifying question", "options": ["option1", "option2"] }
  ],
  "parsed": {
    "origins": [{ "code": "JFK", "name": "New York JFK" }, { "code": "EWR", "name": "Newark" }],
    "destinations": [{ "code": "ORD", "name": "Chicago O'Hare" }, { "code": "MDW", "name": "Chicago Midway" }],
    "dateFrom": "YYYY-MM-DD start of travel window",
    "dateTo": "YYYY-MM-DD end of travel window",
    "flexibility": number of days of flexibility (0 if exact dates),
    "maxPrice": number or null,
    "maxStops": number or null (0 if "nonstop"/"direct", 1 if "max 1 stop", null if no preference),
    "preferredAirlines": ["Delta", "United"] or [] if no preference,
    "timePreference": "any" | "morning" | "afternoon" | "evening" | "redeye",
    "cabinClass": "economy" | "premium_economy" | "business" | "first",
    "tripType": "one_way" | "round_trip",
    "currency": "USD"
  }
}

CRITICAL — "parsed" must ALWAYS be filled:
- If origin and destination are clearly stated (e.g. "from Dusseldorf to Chicago"), ALWAYS fill origins and destinations arrays — even if dates are ambiguous or confidence is "low"
- Only set "parsed" to null if the input is truly unparseable (gibberish, no flight intent)
- Only ask about fields that are actually unclear. NEVER ask "Where are you flying from?" if the user already said it
- When multiple dates are mentioned (e.g. "Friday or Saturday"), use your best guess for dateFrom/dateTo and ask ONLY about the date — do not re-ask origin/destination

Multi-airport rules:
- "origins" and "destinations" are arrays of { "code": "IATA", "name": "City/Airport Name" }
- For cities with ONE major airport (e.g. Dusseldorf, Paris), return a single-element array: [{ "code": "DUS", "name": "Dusseldorf" }]
- For cities with MULTIPLE major airports, list ALL relevant airports:
  - "New York" → [{ "code": "JFK", "name": "New York JFK" }, { "code": "EWR", "name": "Newark" }, { "code": "LGA", "name": "LaGuardia" }]
  - "Chicago" → [{ "code": "ORD", "name": "Chicago O'Hare" }, { "code": "MDW", "name": "Chicago Midway" }]
  - "London" → [{ "code": "LHR", "name": "London Heathrow" }, { "code": "LGW", "name": "London Gatwick" }, { "code": "STN", "name": "London Stansted" }]
  - "Tokyo" → [{ "code": "NRT", "name": "Tokyo Narita" }, { "code": "HND", "name": "Tokyo Haneda" }]
  - "Washington DC" → [{ "code": "IAD", "name": "Washington Dulles" }, { "code": "DCA", "name": "Washington Reagan" }]
  - "San Francisco Bay Area" → [{ "code": "SFO", "name": "San Francisco" }, { "code": "OAK", "name": "Oakland" }, { "code": "SJC", "name": "San Jose" }]
- If the user specifies a SPECIFIC airport (e.g. "from JFK"), return only that one airport in the array
- Put the most common/major airport first in the array (it becomes the default)

Confidence rules:
- "high": clear origin, destination, and specific date(s) within 14 days span
- "medium": mostly clear but one ambiguity (e.g., city has multiple airports, or 2-3 possible dates mentioned)
- "low": too vague (no dates, unclear cities, date range > 14 days, or missing origin/destination)

When confidence is "medium" or "low":
- Still fill in "parsed" with your best guess for ALL fields you can determine
- Add clear, concise clarifying questions in "ambiguities" ONLY for the unclear fields
- Examples of good ambiguities:
  - { "field": "date", "question": "Did you mean Friday Mar 14 or Saturday Mar 15?", "options": ["Friday Mar 14", "Saturday Mar 15", "Both days"] }
  - { "field": "origin", "question": "Which New York airport?", "options": ["JFK", "EWR", "LGA"] }
  - { "field": "date", "question": "That's a 30-day window. Can you narrow it to specific dates?", "options": ["First week", "Second week", "Last week"] }

When confidence is "high":
- Set "ambiguities" to an empty array []

Parsing rules:
- List all major airports for multi-airport cities (see multi-airport rules above)
- If the user says "around June 15 ± 3 days", set dateFrom to June 12, dateTo to June 18, flexibility to 3
- If the user says "June 15-20", set dateFrom to June 15, dateTo to June 20, flexibility to 0
- If the user says "next Friday or next Saturday", set dateFrom to the earlier date, dateTo to the later date, flexibility to 0, and confidence to "high" (both dates are covered by the window)
- If the user says "next month" or "sometime in July", confidence is "low" — ask to narrow
- If the user says "flexible" without specifying days, use flexibility of 3
- Default cabinClass to "economy" unless stated otherwise
- Default timePreference to "any" unless stated
- tripType: "one_way" if no return date is mentioned or user says "one way"; "round_trip" if a return date is given or user says "round trip" or "return". Default to "one_way" when ambiguous (no return info)
- Extract airline preferences if mentioned
- Extract price caps if mentioned (e.g. "under $800")
- If no stop preference stated, maxStops is null
- Extract currency if mentioned (e.g. "in euros" → "EUR", "prices in pounds" → "GBP", "in CAD" → "CAD", "¥" → "JPY"). Default to "USD" if not specified. Use ISO 4217 codes.
- Ignore trailing fragments or incomplete words at the end of the input — parse what you can
- Today's date is ${today}
- If this is a follow-up response to a previous question, incorporate the user's answer to refine the query
- Return ONLY the JSON object, no markdown, no explanation`;
}

/** Normalize LLM response to always have origins/destinations arrays + derived single fields */
function normalizeAirports(parsed: Record<string, unknown>): ParsedFlightQuery {
  const p = parsed as Record<string, unknown>;

  // If LLM returned new format (origins/destinations arrays)
  let origins: Airport[] = Array.isArray(p.origins)
    ? (p.origins as Airport[]).filter((a) => a.code && a.name)
    : [];
  let destinations: Airport[] = Array.isArray(p.destinations)
    ? (p.destinations as Airport[]).filter((a) => a.code && a.name)
    : [];

  // Fall back to legacy single origin/destination fields
  if (origins.length === 0 && typeof p.origin === 'string' && p.origin) {
    origins = [{ code: p.origin as string, name: (p.originName as string) || p.origin as string }];
  }
  if (destinations.length === 0 && typeof p.destination === 'string' && p.destination) {
    destinations = [{ code: p.destination as string, name: (p.destinationName as string) || p.destination as string }];
  }

  return {
    ...(p as unknown as ParsedFlightQuery),
    origins,
    destinations,
    origin: origins[0]?.code ?? '',
    originName: origins[0]?.name ?? '',
    destination: destinations[0]?.code ?? '',
    destinationName: destinations[0]?.name ?? '',
    currency: typeof p.currency === 'string' && p.currency ? p.currency : 'USD',
  };
}

export async function parseFlightQuery(
  rawInput: string,
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
): Promise<{ response: ParseResponse; usage: ExtractionResult['usage'] }> {
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

  // Build prompt with conversation history
  let fullPrompt = rawInput;
  if (conversationHistory?.length) {
    fullPrompt = conversationHistory
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n') + '\nUser: ' + rawInput;
  }

  const result = await providerConfig.extract(
    apiKey,
    model,
    buildSystemPrompt(),
    fullPrompt
  );

  const jsonMatch = result.content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse LLM response as JSON');
  }

  const raw = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

  // Handle both old format (flat ParsedFlightQuery) and new format (with confidence envelope)
  let parsed: ParsedFlightQuery | null;
  let confidence: ParseResponse['confidence'];
  let ambiguities: ParseAmbiguity[];

  if ('confidence' in raw && 'parsed' in raw) {
    // New envelope format
    const rawParsed = raw.parsed as Record<string, unknown> | null;
    parsed = rawParsed ? normalizeAirports(rawParsed) : null;
    confidence = (raw.confidence as string) === 'high' ? 'high'
      : (raw.confidence as string) === 'medium' ? 'medium' : 'low';
    ambiguities = Array.isArray(raw.ambiguities) ? raw.ambiguities as ParseAmbiguity[] : [];
  } else {
    // Legacy flat format — treat as high confidence
    parsed = normalizeAirports(raw);
    confidence = 'high';
    ambiguities = [];
  }

  // Validate required fields on parsed
  if (parsed && (!parsed.origins.length || !parsed.destinations.length || !parsed.dateFrom || !parsed.dateTo)) {
    parsed = null;
    confidence = 'low';
    if (ambiguities.length === 0) {
      ambiguities.push({
        field: 'general',
        question: 'I need at least an origin, destination, and travel dates. Can you be more specific?',
      });
    }
  }

  // Compute date span and enforce server-side safety net
  let dateSpanDays = 0;
  if (parsed) {
    dateSpanDays = Math.ceil(
      (new Date(parsed.dateTo).getTime() - new Date(parsed.dateFrom).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (dateSpanDays > 14 && confidence === 'high') {
      confidence = 'medium';
      ambiguities.push({
        field: 'date',
        question: `That's a ${dateSpanDays}-day window. Can you narrow it to specific dates or a shorter range?`,
        options: ['First week', 'Second week', 'Last week', 'Specific dates'],
      });
    }
  }

  return {
    response: { parsed, confidence, ambiguities, dateSpanDays },
    usage: result.usage,
  };
}

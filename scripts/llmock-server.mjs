#!/usr/bin/env node
/**
 * Lightweight mock LLM server for Docker smoke tests.
 * Speaks the Anthropic Messages API format (/v1/messages).
 * Detects request type from the system prompt and returns appropriate canned responses:
 *   - "flight query parser" -> parse response
 *   - "flight price data extractor" -> extraction response
 */

import { createServer } from 'node:http';

const PORT = parseInt(process.env.LLMOCK_PORT || '19876', 10);

// Canned parse response — matches ParseResponse shape from parse-query.ts
const CANNED_PARSE = JSON.stringify({
  confidence: 'high',
  ambiguities: [],
  parsed: {
    origins: [{ code: 'JFK', name: 'New York JFK' }],
    destinations: [{ code: 'LAX', name: 'Los Angeles' }],
    dateFrom: '2026-06-15',
    dateTo: '2026-06-22',
    outboundDates: ['2026-06-15'],
    returnDates: ['2026-06-22'],
    flexibility: 0,
    maxPrice: null,
    maxStops: null,
    preferredAirlines: [],
    timePreference: 'any',
    cabinClass: 'economy',
    tripType: 'round_trip',
    currency: null,
  },
});

// Canned extraction response — matches PriceData[] shape from extract-prices.ts
const CANNED_PRICES = JSON.stringify([
  {
    travelDate: '2026-06-15',
    price: 98,
    currency: 'USD',
    airline: 'Spirit',
    bookingUrl: 'https://www.google.com/travel/flights?q=flights+from+JFK+to+LAX',
    stops: 1,
    duration: '9h 45m',
    departureTime: '7:00 PM',
    seatsLeft: 2,
  },
  {
    travelDate: '2026-06-15',
    price: 172,
    currency: 'USD',
    airline: 'United',
    bookingUrl: 'https://www.google.com/travel/flights?q=flights+from+JFK+to+LAX',
    stops: 1,
    duration: '8h 30m',
    departureTime: '10:00 AM',
    seatsLeft: 3,
  },
  {
    travelDate: '2026-06-15',
    price: 189,
    currency: 'USD',
    airline: 'Delta',
    bookingUrl: 'https://www.google.com/travel/flights?q=flights+from+JFK+to+LAX',
    stops: 0,
    duration: '6h 15m',
    departureTime: '6:00 AM',
    seatsLeft: null,
  },
]);

function detectRequestType(body) {
  try {
    const parsed = JSON.parse(body);
    const systemText = parsed.system || '';
    if (systemText.includes('flight query parser')) return 'parse';
    if (systemText.includes('flight price data extractor')) return 'extract';
    // Check messages for system role
    const messages = parsed.messages || [];
    for (const msg of messages) {
      if (msg.role === 'system') {
        if (msg.content.includes('flight query parser')) return 'parse';
        if (msg.content.includes('flight price data extractor')) return 'extract';
      }
    }
  } catch {
    // ignore parse errors
  }
  return 'extract'; // default
}

const server = createServer((req, res) => {
  // Health check
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  // Anthropic Messages API
  if (req.method === 'POST' && req.url === '/v1/messages') {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const type = detectRequestType(body);
      const responseText = type === 'parse' ? CANNED_PARSE : CANNED_PRICES;
      console.log(`[llmock] POST /v1/messages (${body.length} bytes) -> ${type}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: `msg_smoke_${type}`,
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: responseText }],
        model: 'mock-model',
        stop_reason: 'end_turn',
        usage: { input_tokens: 500, output_tokens: 200 },
      }));
    });
    return;
  }

  // Catch-all
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: '[]' } }], usage: { prompt_tokens: 0, completion_tokens: 0 } }));
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[llmock] Mock LLM server listening on port ${PORT}`);
});

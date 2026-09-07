# Flight Finder API Reference

> For agents, scripts, and CLI tools interacting with a local Flight Finder instance.

Base URL: `http://localhost:3003` (or the `HOST_PORT` in your deployment configuration).

Endpoints using the API response helpers return JSON: `{ "ok": true, "data": ... }`
on success and `{ "ok": false, "error": "message" }` on failure. Some older flight
examples below omit the `ok` field for brevity. Check both the HTTP status and the envelope.

Auth requirements depend on mode and endpoint family:

- `/api/cron/scrape` always requires `Authorization: Bearer <CRON_SECRET>`.
- `/api/admin/*` routes require an admin session cookie.
- `/api/analytics/track` is gated to internal callers via `ADMIN_SESSION_SECRET`.
- `/api/community/ingest` requires a registered community API key.
- `/api/community/register` requires `COMMUNITY_REGISTRATION_OPEN=true` and passes rate limiting.
- In multi user mode (`ExtractionConfig.multiUserMode = true`), `POST /api/queries`, `GET /api/alerts`, `GET /api/queries/active`, and `POST /api/queries/{id}/scrape` require a valid user session.
- `/api/hotels/*` and `/api/cars/*`, including their collection routes, are self-hosted only and require a user session when accounts are enabled. Their ownership rules apply to every request.
- All other endpoints listed below are public (no auth required).

---

## Endpoints

### Parse a flight query

Converts natural language into structured flight data using your configured LLM.

```
POST /api/parse
Content-Type: application/json

{
  "query": "NYC to Paris around June 15 ± 3 days"
}
```

**Response:**

```json
{
  "data": {
    "routes": [
      {
        "origin": "JFK",
        "originName": "New York JFK",
        "destination": "CDG",
        "destinationName": "Paris Charles de Gaulle"
      }
    ],
    "dateFrom": "2026-06-12",
    "dateTo": "2026-06-18",
    "flexibility": 3,
    "cabinClass": "economy",
    "tripType": "round_trip",
    "currency": "USD",
    "maxPrice": null,
    "maxStops": null,
    "preferredAirlines": [],
    "timePreference": "any",
    "message": "Searching JFK → CDG around June 15 ± 3 days",
    "needsClarification": false
  }
}
```

If `needsClarification` is `true`, the response includes a `message` asking the user to clarify. You can continue the conversation by passing `conversationHistory`:

```json
{
  "query": "the second one",
  "conversationHistory": [
    { "role": "user", "content": "NYC to somewhere warm" },
    { "role": "assistant", "content": "Did you mean Miami, Cancun, or San Juan?" }
  ]
}
```

---

### Create a tracked query

Creates a flight price tracker that will be scraped on each cron run.

```
POST /api/queries
Content-Type: application/json

{
  "rawInput": "NYC to Paris around June 15 ± 3 days",
  "dateFrom": "2026-06-12",
  "dateTo": "2026-06-18",
  "flexibility": 3,
  "cabinClass": "economy",
  "tripType": "round_trip",
  "currency": "USD",
  "routes": [
    {
      "origin": "JFK",
      "originName": "New York JFK",
      "destination": "CDG",
      "destinationName": "Paris Charles de Gaulle",
      "selectedFlights": []
    }
  ]
}
```

**Optional fields:** `maxPrice` (number), `maxStops` (number), `preferredAirlines` (string[]), `timePreference` (string).

**Response:**

```json
{
  "data": {
    "queries": [
      {
        "id": "clxyz...",
        "origin": "JFK",
        "originName": "New York JFK",
        "destination": "CDG",
        "destinationName": "Paris Charles de Gaulle",
        "deleteToken": "uuid-for-deletion"
      }
    ]
  }
}
```

Save the `id` to check prices later. Save the `deleteToken` if you want to delete the query.

**Multi user mode:** if a self hosted instance has multi user mode enabled
(`ExtractionConfig.multiUserMode = true`), unauthenticated POSTs return
`401 Sign in to create a tracker`. Authenticate first via
`POST /api/auth/login` and reuse the `ft-session` cookie. The bundled
headless CLI (`flight-finder --headless`) talks directly to Postgres and
auto-attaches new trackers to the first admin user in multi user mode,
so it keeps working without auth. Solo and hosted deployments are
unaffected.

---

### Get price data

Returns all price snapshots for a tracked query. This is the data that powers the chart.

```
GET /api/queries/{id}/prices
```

**Response:**

```json
{
  "data": {
    "query": {
      "id": "clxyz...",
      "origin": "JFK",
      "destination": "CDG",
      "dateFrom": "2026-06-12",
      "dateTo": "2026-06-18",
      "cabinClass": "economy",
      "active": true
    },
    "snapshots": [
      {
        "travelDate": "2026-06-14",
        "price": 487,
        "currency": "USD",
        "airline": "Delta",
        "stops": 1,
        "duration": "7h 30m",
        "layovers": [{ "duration": "1h 35m", "airport": "ORD" }],
        "bookingUrl": "https://...",
        "scrapedAt": "2026-03-08T12:00:00Z"
      }
    ],
    "snapshotCount": 42,
    "lastChecked": "2026-03-08T12:00:00Z",
    "lastStatus": "success"
  }
}
```

---

### Trigger a scrape

Runs the scraper across all active queries immediately. Requires `CRON_SECRET`.

```
GET /api/cron/scrape
Authorization: Bearer <CRON_SECRET>
```

**Response:**

```json
{
  "data": {
    "queriesProcessed": 5,
    "successful": 4,
    "partial": 1,
    "failed": 0,
    "totalSnapshots": 28,
    "totalCost": 0.003
  }
}
```

Configure `CRON_SECRET` through Doppler and pass it to the running instance.

---

### Health check

```
GET /api/health
```

**Response:**

```json
{
  "data": {
    "status": "ok",
    "database": "connected",
    "redis": "connected"
  }
}
```

`redis` may be `"disabled"` if Redis is not configured (app works fine without it).

---

### Delete a query

```
DELETE /api/queries/{id}
Content-Type: application/json

{
  "deleteToken": "uuid-from-creation"
}
```

---

### Admin endpoints

#### Shared travel recovery

`GET /api/admin/travel` returns the shared worker admission state: `quarantinedAt`,
`reason`, `recoveryGeneration`, `topologyVersion`, `systemWide`, `vpnEnabled`, and
lease resource/state/generation/expiry. It does not expose lease owner tokens or
VPN endpoint credentials. Both methods return `Cache-Control: private, no-store`.
Public deployments require a valid, non-revoked administrator session; multi-user
deployments require an administrator account. Solo self-hosted deployments follow
the existing administrator access model.

An expired lease or unverified cleanup keeps shared execution stopped. After
stopping old workers and independently verifying the network, an administrator
can submit the generation obtained from GET:

```http
POST /api/admin/travel
Content-Type: application/json

{"generation":1,"oldWorkersStopped":true,"networkVerified":true}
```

Recovery marks interrupted shared jobs and their runs failed, retains previous
observations, invalidates old worker generations, and returns the updated state.
A missing or stale incident returns 412; omitted confirmations return 400.
Never automatically submit these confirmations based on a VPN status response.
Scheduled and manual flight, hotel, and car checks use shared admission. Flight
country grouping, intervals, and configuration defaults remain unchanged.

These require an admin session cookie (set via `/admin` login). Useful for programmatic management but not typically needed by agents.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/admin/queries` | GET | List all tracked queries |
| `/api/admin/queries/{id}` | PATCH | Update query (pause/resume) |
| `/api/admin/queries/{id}` | DELETE | Delete query (admin auth) |
| `/api/admin/config` | GET | Get extraction config |
| `/api/admin/config` | PATCH | Update LLM provider/model |
| `/api/admin/providers` | GET | List available LLM providers |

---

## Typical agent workflow

```
1. POST /api/parse        → parse "NYC to Paris in June"
2. POST /api/queries       → create tracker from parsed result
3. GET  /api/cron/scrape   → trigger immediate scrape (optional)
4. GET  /api/queries/{id}/prices → read price data
5. (wait hours/days)
6. GET  /api/queries/{id}/prices → check for price changes
```

The built-in cron (default: every 3 hours) handles step 3 automatically. You only need to trigger a manual scrape if you want data immediately.

---

## Environment variables for agents

| Variable | Default | Purpose |
|----------|---------|---------|
| `FLIGHT_FINDER_URL` | `http://localhost:3003` | Base URL of the Flight Finder instance |
| `CRON_SECRET` | Auto-generated | Required for triggering scrapes |

---

## Rate limits

- Parse: No limit (bounded by LLM cost)
- Query creation: No limit
- Scrape trigger: One at a time (subsequent calls queue)
- Price reads: Cached for 2 minutes

---

## Data model

### Self-hosted hotel tracking

Hotel routes require a self-hosted instance. When accounts are enabled, include
the current account session (`Cookie: ft-session=<value>`). Ownership is enforced by the server.
The public Flight Finder website does not expose these routes.

Structured searches read Google Hotels and Booking.com in a headless browser;
they do not call an AI backend. Natural-language parsing uses the existing
configured provider and model without changing flight settings. Packages and
hotel bookings are not supported; offers link to the seller to complete a booking.

| Method and path | Purpose |
|---|---|
| `POST /api/hotels/parse` | Parse `{ "text": "hotel request" }` into `{ search }` |
| `POST /api/hotels/search` | Start a structured search; returns HTTP 202 with `{ id, status }` |
| `GET /api/hotels/search/:id` | Read status, offers, provider errors, and progress |
| `DELETE /api/hotels/search/:id` | Cancel a search |
| `POST /api/hotels` | Track `{ searchId, offerId, mode, targetPrice, notifyLows, allowApproximateAlerts, scrapeInterval }` |
| `GET /api/hotels` | List the current user's trackers |
| `GET /api/hotels/:id` | Read tracker, snapshots, check runs, and notification readiness |
| `PATCH /api/hotels/:id` | Update `active`, `targetPrice`, `notifyLows`, `allowApproximateAlerts`, or `scrapeInterval` |
| `DELETE /api/hotels/:id` | Delete a tracker and its history |
| `POST /api/hotels/:id/scrape` | Queue a fresh check |

All responses use `{ "ok": true, "data": ... }` or
`{ "ok": false, "error": "..." }`. Search states are `queued`, `running`,
`success`, `partial`, `unavailable`, `failed`, and `cancelled`. A partial result
includes usable offers alongside explicit provider errors; unavailable inventory
is separate from an extraction failure. A result contains `offers`, `errors`,
`completed`, and `total`.

Example structured hotel search (also accepted by the CLI's `--file` option):

```json
{
  "destination": "London",
  "dateMode": "fixed",
  "checkIn": "2027-10-15",
  "checkOut": "2027-10-18",
  "flexibility": 0,
  "minNights": 3,
  "maxNights": 3,
  "rooms": [{ "adults": 2, "children": [8] }, { "adults": 1, "children": [] }],
  "currency": "GBP",
  "sources": ["google_hotels", "booking"],
  "filters": {
    "maxTotal": null,
    "refundable": true,
    "breakfast": false,
    "minStars": 4,
    "minRating": 8,
    "excludedSellers": [],
    "amenities": ["parking"]
  }
}
```

Children are represented by ages within their room. `dateMode` can also be
`nearby` (shift dates by `flexibility` days) or `window` (stays between
`minNights` and `maxNights` within the date window). The server bounds the number
of date/source combinations to 24 and checks up to eight discovered properties
per source and stay. This is bounded discovery, not a complete inventory scan.
Saved trackers revisit their selected property. Google Hotels supports one room;
Booking.com supports up to four, with child ages assigned to each room. A source
that cannot verify the requested allocation reports an error. Amenities are
`parking`, `pool`, `pets`, and `accessible`.
Unknown offer details do not satisfy an active filter. Prices and targets refer
to the total stay for the requested room allocation, including mandatory taxes.

Tracking mode `best` follows the cheapest qualifying offer for a hotel; `room`
follows the selected room/rate. `scrapeInterval` is in hours. Set `targetPrice`
to `null` to remove a target. Target alerts fire on the first valid observation
at or below target and rearm after a complete, valid above-target observation. Approximate
matches require explicit `allowApproximateAlerts: true` to trigger alerts.
Failed channel deliveries retry after five minutes; successful channels are
remembered so a retry does not resend to them. An instance crash between sending
and saving the delivery acknowledgement can still produce a duplicate.

### Self-hosted car tracking

Car routes require `SELF_HOSTED=true`; public instances return HTTP 404. When
accounts are enabled, authenticate with `POST /api/auth/login` and include the
`ft-session` cookie. Missing or revoked sessions return 401. Ordinary accounts
can read and manage their own trackers and searches. A foreign or missing record
returns 404. Administrators can manage other accounts' records, but their normal
collection list remains personal. In single-user mode, the collection includes
the instance's car trackers.

Every private car response sets `Cache-Control: private, no-store` and uses the `ok`/`data`
or `ok`/`error` envelope described above. JSON writes require
`Content-Type: application/json`; request bodies are limited to 64 KiB and a
five-second read deadline. The browser pages `/cars`, `/cars/:id`, and
`/cars/search/:id` require the same private access and are marked `noindex`.

| Method and path | Successful response data |
|---|---|
| `GET /api/cars?limit=25&cursor=...` | `{ trackers, nextCursor }`; omit `cursor` for the first page |
| `POST /api/cars` | HTTP 201 with `{ tracker, creationKey }` from a selected completed-search quote |
| `GET /api/cars/:id` | `{ tracker, snapshots, runs, latestObservation, notificationsConfigured, canReassign }` |
| `PATCH /api/cars/:id` | `{ tracker }` after saving supported settings |
| `DELETE /api/cars/:id` | `{ id, deleted: true }` after deleting the tracker and its history |
| `POST /api/cars/:id/scrape` | HTTP 202 with `{ id, trackerId, status, refreshKey }`; requires `Idempotency-Key` and `X-Car-Revision` |
| `GET /api/cars/locations?q=LHR` | Up to 12 catalog suggestions with `id`, `version`, country, region and timezone; no provider requests |
| `POST /api/cars/parse` | `{ draft }` from `{ text, locale? }`; editable suggestions only, no provider search or tracker creation |
| `POST /api/cars/search` | HTTP 202 with `{ id, status, creationKey }`; requires a UUID v4 `Idempotency-Key` |
| `GET /api/cars/search?cursor=...` | `{ searches, nextCursor }`; 25 caller-scoped standalone search summaries per page |
| `GET /api/cars/search/:id` | `{ id, trackerId, status, createdAt, completedAt, error, search, result }` |
| `DELETE /api/cars/search/:id` | `{ id, status }`; completed searches retain their terminal status |

Collection pages default to 25 trackers and accept `limit` from 1 to 100. They
sort by creation time, then ID, both descending. Pass `nextCursor` unchanged to
continue; `null` means there is no next page. A cursor remains usable if its last
row is deleted. Newer insertions appear after restarting from the first page.
Do not reuse a cursor for a different account or listing mode. Administrators
request all accounts with `admin=true` on every page; other accounts receive 403.
Malformed cursors and page sizes return 400. Ownership is checked independently
of the cursor.

#### Manually refresh a saved rental

Send a bodyless `POST /api/cars/:id/scrape` with a UUID v4 `Idempotency-Key`
and the current `X-Car-Revision` from the tracker response. Missing revision
returns 428; a fresh request for an older revision returns 412. Reusing a key
for different settings or another tracker returns 409.

Persist the key and revision before sending. On a lost response, reuse both.
The receipt returns the original run even after completion, cancellation, or
a later settings change. An already-active check is reused and recorded in
the receipt. Deleted checks retain a receipt and return 410 rather than being
recreated. Current tracker ownership is checked on every replay.

The browser labels this action “Check saved rental prices.” “Refresh status”
only reloads stored history. An uncertain refresh does not prevent pausing or
deleting the tracker. Recovery after a pause reports the original cancelled
run without starting another check.

#### Start an independent rental search

Natural-language input is optional. `POST /api/cars/parse` accepts a rental
description of up to 4,000 characters and an optional `en`, `es`, `fr`, `de`, or
`pt` locale. It uses the configured AI provider without changing its settings.
Missing driver facts remain `null`, including entries for additional drivers.
Location suggestions are text, never trusted catalog or provider identifiers.
Unsupported requests and ambiguities appear in `warnings`.

Only one draft can run per account, with a ten-second request cooldown (HTTP
429 on overlap or rapid retry). Cancellation and timeouts reach the underlying
SDK or CLI process. Draft preparation does not queue a rental search, create a
tracker, change alerts, or book a car. The browser requires users to apply and
review the draft, complete missing details, select changed catalog locations,
and acknowledge its limitations before submitting a search. Manual entries
remain available after a failed or cancelled draft.

Select pickup and return from `/api/cars/locations`. Send only their `id` and
`version`, and local `date`/`time` pairs. Country, timezone, UTC instants and
provider location identifiers are server-managed. A search needs no flight or
hotel tracker. Example body, replacing the catalog version and future dates:

```json
{
  "pickup": { "id": "ourairports:2434", "version": "<version from suggestions>" },
  "dropoff": { "id": "ourairports:2434", "version": "<version from suggestions>" },
  "pickupAt": { "date": "2027-01-15", "time": "11:00" },
  "dropoffAt": { "date": "2027-01-18", "time": "11:00" },
  "driver": { "age": 35, "licenceYears": 5, "residenceCountry": "GB" },
  "currency": "GBP",
  "sources": ["discovercars", "autoeurope"]
}
```

Optional `extras` contain categorized `childSeats` and complete
`additionalDrivers`. Arbitrary protection product identifiers are rejected.
Optional `filters` contain `transmission`, `minSeats`, `unlimitedMileage`,
`freeCancellation`, and a currency-specific `maxTotal` in integer minor units.
Driver age, licence tenure and residence must be explicit. Ambiguous or missing
local times are rejected; different pickup and return timezones are supported.

Creation commits the search and shared travel job atomically, before contacting
providers. Resolution and price checks share the same admission, cancellation,
deadline and browser cleanup. Airports require an exact code, country and type;
ambiguous city matches fail visibly without choosing a nearby station. One
provider's failure does not discard a verified sibling result. Provider IDs may
appear in status responses as resolution progresses; the catalog intent stays
fixed. Catalog version changes require reselection, never silent timezone changes.

Persist the request body and UUID before sending. Retry the same body and key
after a lost acknowledgement, including after cancellation or completion. Keys
are scoped to the caller; different criteria with the same key return 409.
Receipts survive search deletion and return 410 without creating another job.
They are retained for the account lifetime, or indefinitely in single-user mode.
The browser preserves pending requests in session storage and locks new searches
until the original result is recovered.

The recent-search list provides read-only recovery links and pagination. An
unreadable browser record is never silently replaced. If retrying storage does
not recover it, the user can explicitly confirm discarding that local record.
This does not cancel an earlier in-flight search; starting another may duplicate
provider checks, but cannot create trackers, change alerts or book a rental.

Location searches accept at most 100 characters and perform no live autocomplete
requests. `/cars/location-data` publishes attribution and the public
`/api/cars/location-data` download supplies the licensed, gzip-compressed NDJSON
catalog. Neither endpoint exposes private searches or provider sessions.

#### Create a rental tracker safely

Select an offer returned by a completed search owned by the caller, or accessible
to an administrator. The server reads the stored quote, verifies its eligibility,
and derives its contract identity. Client-supplied prices and contract hashes
cannot establish eligibility. Quotes expire after 15 minutes. A failed,
unfinished, expired, or unverifiable result cannot create a tracker.

Generate a UUID v4 `Idempotency-Key` once and persist it with the exact request
before sending:

```http
POST /api/cars
Content-Type: application/json
Idempotency-Key: 7d8ff006-24e2-4dfe-9965-cb635443239e
Cookie: ft-session=<session>

{
  "searchId": "returned-search-id",
  "offerId": "returned-offer-id",
  "label": "London weekend",
  "mode": "best",
  "target": { "currency": "GBP", "minor": 9000 },
  "notifyLows": true,
  "scrapeInterval": 3
}
```

`mode` is `best` or `contract`. Best-price tracking compares eligible offers from
the saved provider selection while keeping the rental requirements fixed.
Contract tracking follows the selected provider and contract terms. A tracker
does not retain the initial search's budget ceiling; `target` controls its price
alert. Defaults are `best`, no target, low-price notifications enabled, and a
three-hour interval. Set `target` to `null` to remove it. Custom labels are nonempty and
limited to 250 characters; `scrapeInterval` is an integer from 1 to 24 hours.

If the response is lost, retry the same body with the same key. A replay returns
the existing tracker, including any subsequently changed settings. Reusing a key
for different creation inputs returns 409. Replaying a deleted tracker's key
returns 410 and does not recreate it. Ownership still applies to a replay, so
reassignment can make it inaccessible. Do not generate another key to work
around an uncertain result. Creation and its first queued check commit together;
the API permits at most three queued or running searches per owner and returns
429 when this quota prevents a new check.

#### Edit, delete and recover

`PATCH` accepts only `active`, `label`, `target`, `notifyLows`, `scrapeInterval`,
and administrator-only `userId`. Reassignment requires an existing account.
Create a separate tracker to change its rental criteria or matching mode.
Saving settings cancels active checks and pending alerts for the previous
revision. Reassignment also transfers tracker access; existing search runs keep
their original owners. Deleting a tracker removes its stored history and pending
work. Neither operation cancels a rental booking with a provider.

`GET /api/cars/:id` and successful `PATCH` responses include `X-Car-Revision` and
the same numeric value in `tracker.revision`. Send the displayed revision on
every edit or deletion:

```http
PATCH /api/cars/returned-tracker-id
Content-Type: application/json
X-Car-Revision: 4

{ "active": false }
```

The header is optional for API compatibility, but omitting it allows an update
without a revision check. A stale revision returns 412 before changing settings,
cancelling work, or touching alerts. The revision protects settings; it is not
an HTTP ETag for the price history, which can change independently.

After an uncertain edit, read the tracker and compare its revision and requested
settings. If retrying, reuse the original revision. Never apply that retry to a
newer revision automatically. A 404 after an uncertain deletion means the record
is inaccessible; it does not prove that this client deleted it. Only the matching
successful deletion response acknowledges that operation.

Manual refresh returns 202 when work is queued or already active. It does not
mean the provider search has completed. Repeated calls reuse an active check;
this is not durable deduplication after that check finishes. Poll the returned
run ID and do not blindly repeat a lost refresh request. A paused tracker returns
409 until resumed. Cancelling an already-finished run preserves its final status.

#### Prices, evidence and history

Providers are `discovercars` and `autoeurope`. Account settings expose an ordered
`preferredCarProviders` list. An empty saved list selects the default pair;
duplicate or unsupported values are rejected. Existing flight and hotel provider
preferences are separate.

Amounts use `{ currency, minor }`, with a safe integer number of the currency's
minor units: `{ "currency": "GBP", "minor": 9000 }` means £90.00. Do not assume
every currency has two decimal places. Missing retained prices are `null`, not
zero. Eligible totals include verified mandatory charges, taxes and selected
extras, with pay-now and pickup charges reconciled to the total. Deposits and
excess are disclosed separately. Mixed-currency charges, unknown required fees,
unconfirmed extras, or mismatched driver details cannot qualify for alerts.

Search states are `queued`, `running`, `success`, `partial`, `unavailable`,
`failed`, and `cancelled`. Waiting work is queued, not yet checking a provider.
A result contains `offers`, `candidates`, `errors`, `providers`, `completed`,
`total`, `successfulProviders`, and `scope: "checked_provider_offers"`. Each
provider reports its status and bounded discovery counts. At most eight offers
per selected provider are inspected. Candidates remain visibly unverified;
successful discovery alone does not make a candidate an eligible quote. An
offer's evidence includes its source URL and observation time, with a status of
`confirmed`, `estimated`, or `unknown`.

Tracker detail includes the latest 100 stored observations and 20 check runs.
`latestObservation` independently identifies eligible evidence for the retained
price and can come from outside that window. `observedAt` is the evidence time.
Validation uses the check's completion time as `evaluatedAt`, or the observation
time if no completion was recorded. `lastCheckedAt`
records an attempt and must not be displayed as fresh price evidence. Failed
checks retain earlier verified prices. Historical observations do not establish
current availability or guarantee a booking price.

The first eligible price establishes the low-price baseline. A lower later price
can trigger a new-low alert. A target alert fires at or below an armed target and
rearms only after a complete qualifying check above it. Partial checks can retain
eligible prices without rearming an above-target alert. `notificationsConfigured`
reports channel readiness; saved alert preferences alone do not establish that
a notification was delivered.

Car target and new-low events are delivered through the existing enabled owner
and global channels. Delivery runs independently of provider searches and hotel
notifications. Pausing, editing, reassigning or deleting a tracker cancels its
pending events; a request already submitted to a channel cannot be recalled.
Each acknowledged channel is saved before another is attempted. Failed channels
and events with no enabled channels retry after five minutes. Deleted or
disabled channels are checked again before sending.

Delivery claims expire after two minutes; each dispatch is limited to one minute
and each channel transport to 15 seconds, including DNS and response bodies.
Database reads and writes also have bounded lock and statement waits. A stale
worker cannot acknowledge or overwrite a replacement claim. Delivery is
**at least once**, not exactly once: a channel may accept a message immediately
before its acknowledgement is lost. The stable `data.eventId` in webhook payloads
lets receivers deduplicate that case. Flight query settings and scrape intervals
are unaffected.

For a read-only live provider check, run this from the repository root:

```bash
node --import tsx scripts/car-search-smoke.mts
```

It uses the production search code, requires an eligible quote from each
provider, and writes private
diagnostic files to a unique temporary directory. It does not create a tracker,
use the application database, or submit a booking. `CAR_SEARCH_SMOKE_CURRENCY`
overrides its GBP test currency; this does not change application defaults.

### Flight records

- **Query**: A tracked flight route with date range, cabin class, and preferences
- **PriceSnapshot**: A single price observation (airline, price, date, stops, booking URL)
- **FetchRun**: Metadata for each scrape run (status, timing, cost)

Each scrape run captures current prices for all active queries. Over time, this builds a price evolution timeline visible at `/q/{id}`.

# CLAUDE.md — Fairtrail

> **Fairtrail** — The price trail airlines don't show you. Flight price evolution tracker with natural language search and shareable charts.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15+ (App Router), TypeScript, CSS Modules |
| Database | PostgreSQL 16 + Prisma ORM |
| Cache | Redis 7 (rate limiting + response caching) |
| AI | Anthropic Claude, OpenAI GPT, Google Gemini, Claude Code CLI, Ollama, llama.cpp, vLLM |
| Browser | Playwright (headless Chromium for Google Flights scraping) |
| Charts | Plotly.js (interactive price evolution) |
| Hosting | Hetzner VPS (Docker Compose + Caddy) — fairtrail.org |
| CI/CD | GitHub Actions (CI + Deploy on push to main) |

## Monorepo

npm workspaces: `@fairtrail/web` (`apps/web/`).
Root `package.json` proxies to `@fairtrail/web`.

## Environment Variables

All secrets via **Doppler** — NEVER use `.env` files. Project: `fairtrail`, config: `dev`.
Scripts wrap with `doppler run --`. Shared LLM keys from `pricetoken` Doppler project.

Critical: `DATABASE_URL`, `REDIS_URL`, `ANTHROPIC_API_KEY`, `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `CRON_SECRET`.

## Build Commands

```bash
npm install                    # All workspaces
docker compose -f docker-compose.prod.yml up -d db redis
npx prisma db push --schema=apps/web/prisma/schema.prisma
npx prisma generate --schema=apps/web/prisma/schema.prisma
npm run dev                    # Web app on :3003 (wraps with doppler run)
npm run ci                     # lint + typecheck + build
```

## File Index

### `apps/web/src/app/` — Pages & API routes

| Path | Purpose |
|------|---------|
| `page.tsx` | Landing page — natural language search bar |
| `layout.tsx` | Root layout — fonts, metadata |
| `q/[id]/page.tsx` | Public shareable chart page (no auth) |
| `admin/(auth)/login/page.tsx` | Admin login |
| `admin/(dashboard)/page.tsx` | Admin dashboard — active queries, costs |
| `admin/(dashboard)/queries/page.tsx` | Query management — pause/resume/delete |
| `admin/(dashboard)/config/page.tsx` | LLM agent config — provider/model selection |
| `api/parse/route.ts` | POST — LLM parses natural language flight query |
| `api/queries/route.ts` | POST — create new tracked query |
| `api/queries/[id]/prices/route.ts` | GET — public price data for chart |
| `api/cron/scrape/route.ts` | GET — trigger scrape run (CRON_SECRET auth) |
| `api/admin/auth/route.ts` | POST — admin login |
| `api/admin/auth/logout/route.ts` | POST — admin logout |
| `api/admin/queries/route.ts` | GET — list all queries |
| `api/admin/queries/[id]/route.ts` | PATCH/DELETE — manage query |
| `api/admin/config/route.ts` | GET/PATCH — extraction config |
| `api/health/route.ts` | GET — health check (DB + Redis) |

### `apps/web/src/components/` — UI components

| Component | Purpose |
|-----------|---------|
| `SearchBar` | Natural language flight query input with syntax highlighting |
| `ConfirmationCard` | Parsed query display with "Track this flight" button |
| `PriceChart` | Plotly.js wrapper — price evolution, airline colors, click→book |
| `BestPrice` | Highlight card for cheapest price found |
| `PriceHistory` | Table with trend arrows and booking links |

### `apps/web/src/lib/` — Core logic

| File | Purpose |
|------|---------|
| `prisma.ts` | Prisma client singleton |
| `redis.ts` | Redis client + cache helpers |
| `api-response.ts` | `apiSuccess()`/`apiError()` response helpers |
| `admin-auth.ts` | HMAC session tokens, password verification |

### `apps/web/src/lib/scraper/` — Extraction pipeline

| File | Purpose |
|------|---------|
| `ai-registry.ts` | Provider registry (Anthropic, OpenAI, Google, Claude Code) |
| `parse-query.ts` | LLM parses natural language into structured flight query |
| `navigate.ts` | Playwright navigates Google Flights, captures HTML |
| `extract-prices.ts` | LLM extracts structured price data from page |
| `run-scrape.ts` | Orchestrates full scrape run across active queries |

## Prisma Schema

Models: `Query` (tracked flights), `PriceSnapshot` (price data points), `FetchRun` (scrape run logs), `ExtractionConfig` (LLM settings singleton), `ApiUsageLog` (cost tracking).

## Design System: "Altitude"

Supports light/dark themes via `data-theme` attribute on `<html>`.

**Dark (default):** bg `#080f1a`, surface `#0f1729`, elevated `#182036`, accent `#06b6d4` (aviation cyan).
**Light:** bg `#f5f2ec`, surface `#ffffff`, elevated `#ede9e1`, accent `#0891b2` (deep cyan).

Fonts: Bricolage Grotesque (display), Outfit (body), IBM Plex Mono (data).

Departure board / atmospheric aviation aesthetic — deep navy, amber glow, precise typography.

## Engineering Patterns

- **Component**: `Name.tsx` + `Name.module.css`. Named export, `styles.root`.
- **API Route**: Validate → query → `NextResponse.json()` with `apiSuccess()`/`apiError()`.
- **Scraper**: Playwright navigate → capture HTML → LLM extract → store snapshots.
- **Admin auth**: HMAC session cookie, verified in `middleware.ts` for pages, in handler for cron.

## DO

- Use CSS Modules for all styling
- Use TypeScript strict mode
- Use Server Components by default
- Return proper HTTP status codes
- Cache API responses in Redis (5min TTL)
- Use `doppler run --` for all scripts that need secrets

## Pre-Release Gate (MANDATORY before `/create-release`)

Both tests must pass before tagging a release:

```bash
./scripts/docker-smoke-test.sh    # Docker infra: build, health, chromium, extraction, DB
./scripts/install-flow-test.sh    # User flow: install.sh, CLI commands, search
```

If either fails, fix the issue and re-run. Do NOT tag without both passing.

## DON'T

- Use Tailwind, inline styles, or styled-components
- Use `any` type
- Use `.env` files — always Doppler
- Commit API keys or secrets

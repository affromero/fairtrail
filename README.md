<div align="center">

# Fairtrail

**The price trail airlines don't show you.**

Track flight prices over time. Self-hosted. Open source. Bring your own LLM.

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/affromero/fairtrail/pulls)

</div>

---

## Quick Start

```bash
git clone git@github.com:affromero/fairtrail.git
cd fairtrail
cp .env.example .env
# Add at least one LLM API key to .env (Anthropic, OpenAI, or Google)
docker compose up -d
```

Open [localhost:3003](http://localhost:3003) — the setup wizard will guide you through first-run configuration.

## Why Fairtrail?

Every flight price tracker gives you "alert me when it's cheap." None of them let you *see* how prices evolve — and none give you a shareable link with that data.

**This isn't an accident:**

1. **Aggregators want you inside their app.** Google Flights and Hopper track history internally but lock charts behind your account.
2. **"Buy or Wait" is more profitable than transparency.** A black-box prediction keeps you dependent on their platform.
3. **Airlines don't want price transparency.** If you can see that a route dips 3 weeks before departure, that undermines dynamic pricing.

**Fairtrail exists because the data is useful to *you* — just not to the companies that have it.**

### What you get

- **Natural language search** — `"NYC to Paris around June 15 ± 3 days"`
- **Price evolution charts** — see how fares move over days and weeks
- **Shareable links** — send `/q/abc123` to anyone, no login required
- **Direct booking links** — click any data point to go straight to the airline
- **Airline comparison** — see which carriers are cheapening vs. getting expensive
- **Self-hosted** — your data stays on your machine

## LLM Providers

Fairtrail needs an LLM for two things: parsing natural language queries and extracting price data from Google Flights pages. Pick **any one** of these:

| Provider | Env Var | Cost | Notes |
|----------|---------|------|-------|
| **Anthropic** | `ANTHROPIC_API_KEY` | ~$0.001/query | Claude Haiku 4.5 (default) |
| **OpenAI** | `OPENAI_API_KEY` | ~$0.0004/query | GPT-4.1 Mini |
| **Google** | `GOOGLE_AI_API_KEY` | ~$0.00015/query | Gemini 2.5 Flash (cheapest) |
| **Claude Code** | `CLAUDE_CODE_ENABLED=true` | Free (Max plan) | Mount `~/.claude` from host |
| **Codex CLI** | `CODEX_ENABLED=true` | Free | Mount `~/.codex` from host |

To use CLI providers (Claude Code, Codex), uncomment the volume mounts in `docker-compose.yml`.

## Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | One LLM key required | — | Anthropic API key |
| `OPENAI_API_KEY` | | — | OpenAI API key |
| `GOOGLE_AI_API_KEY` | | — | Google AI API key |
| `POSTGRES_PASSWORD` | | `postgres` | Database password |
| `ADMIN_PASSWORD` | | Auto-generated | Admin panel password |
| `ADMIN_SESSION_SECRET` | | Auto-generated | Session signing key |
| `CRON_SECRET` | | Auto-generated | Cron auth token |
| `CRON_ENABLED` | | `true` | Enable built-in scrape scheduler |
| `CRON_INTERVAL_HOURS` | | `6` | Hours between scrape runs |
| `REDIS_URL` | | Set by compose | Optional — app works without Redis |
| `PORT` | | `3003` | Web server port |

Secrets left empty are auto-generated on first run and printed in Docker logs.

## How It Works

```
You type: "SFO to Tokyo sometime in July ± 5 days"
                        │
                        ▼
              ┌─────────────────┐
              │   LLM Parser    │  Extracts origin, destination,
              │  (Claude/GPT)   │  date range, flexibility
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   Playwright    │  Navigates Google Flights
              │   (headless)    │  with your exact query
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  LLM Extractor  │  Reads the page, extracts
              │  (configurable) │  structured price data
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │   PostgreSQL    │  Stores price snapshots
              │   + Prisma     │  with timestamps
              └────────┬────────┘
                       │
                       ▼
              ┌─────────────────┐
              │  Plotly.js      │  Interactive chart at
              │  /q/[id]       │  a shareable public URL
              └─────────────────┘
```

The built-in cron runs on a configurable interval (default: every 6h). Each run captures prices across all active queries and the chart pages update automatically.

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 (App Router), TypeScript, CSS Modules |
| Database | PostgreSQL 16 + Prisma ORM |
| Cache | Redis 7 (optional) |
| Browser | Playwright (headless Chromium) |
| LLM | Anthropic, OpenAI, Google, Claude Code, or Codex |
| Charts | Plotly.js (interactive) |
| Cron | Built-in (node-cron) or external trigger |

## Architecture

```
fairtrail/
├── apps/web/                 # Next.js 15 app (@fairtrail/web)
│   ├── src/app/              # Pages + API routes
│   │   ├── page.tsx          # Landing — natural language search bar
│   │   ├── q/[id]/           # Public shareable chart page
│   │   ├── setup/            # First-run setup wizard
│   │   ├── admin/            # Admin panel (LLM config, queries, costs)
│   │   └── api/              # REST endpoints
│   ├── src/components/       # UI components (SearchBar, PriceChart, etc.)
│   ├── src/lib/              # Core logic
│   │   ├── scraper/          # Playwright + LLM extraction pipeline
│   │   ├── cron.ts           # Built-in scrape scheduler
│   │   ├── prisma.ts         # Database client
│   │   ├── redis.ts          # Cache client (optional)
│   │   └── admin-auth.ts     # Session management
│   └── prisma/schema.prisma  # Database models
├── docker-compose.yml        # Self-hosted: PostgreSQL, Redis, web
├── docker-compose.prod.yml   # Production deployment
├── Dockerfile                # Multi-stage build with Chromium
└── .env.example              # Configuration template
```

## Development

```bash
# Install dependencies
npm install

# Start database + cache
docker compose up -d db redis

# Apply schema
npm run db:push

# Generate Prisma client
npm run db:generate

# Start dev server (set env vars or use `doppler run --`)
npm run dev
```

## Admin Panel

Access at `/admin` to:

- **Manage queries** — pause, resume, delete, adjust scrape frequency
- **Configure LLM** — choose extraction provider and model
- **Monitor costs** — see LLM API usage per scrape run
- **View fetch history** — success/failure status, errors, snapshot counts

## Contributing

Pull requests welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT

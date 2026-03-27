<div align="center">

# Fairtrail

**The price trail airlines don't show you.**

Track flight prices over time. Self-hosted. Open source. Bring your own LLM.

[![GitHub Release](https://img.shields.io/github/v/release/affromero/fairtrail)](https://github.com/affromero/fairtrail/releases/latest)
[![CI](https://img.shields.io/github/actions/workflow/status/affromero/fairtrail/ci.yml?label=CI)](https://github.com/affromero/fairtrail/actions/workflows/ci.yml)
[![Docker Image Size](https://ghcr-badge.egpl.dev/affromero/fairtrail/size)](https://github.com/affromero/fairtrail/pkgs/container/fairtrail)
[![License: MIT](https://img.shields.io/github/license/affromero/fairtrail)](https://github.com/affromero/fairtrail/blob/main/LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/affromero/fairtrail/pulls)

<br>

<img src="assets/demo.gif" alt="Fairtrail — price evolution charts cycling through JFK→CDG, LAX→NRT, ORD→FCO" width="100%">

<details>
<summary>CLI Demo — headless mode with Claude Code & Codex</summary>
<br>
<img src="packages/cli/demo/fairtrail-demo.gif" alt="Fairtrail CLI — search with Claude Code and Codex side by side, then live price charts" width="100%">
</details>

<details>
<summary>Screenshots</summary>
<br>
<img src="assets/home.png" alt="Landing page (dark)" width="100%">
<br><br>
<img src="assets/chart-jfk-cdg.png" alt="JFK → CDG price chart" width="100%">
</details>

</div>

---

## Quick Start

```bash
curl -fsSL https://fairtrail.org/install.sh | bash
```

If you have [Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Codex](https://github.com/openai/codex) installed, the setup script detects it automatically — **no API key needed**. Otherwise, it asks you to paste one.

Once it finishes:

1. Open [localhost:3003](http://localhost:3003) — or run `fairtrail search "NYC to Tokyo in July under $800"`
2. Fairtrail starts tracking prices immediately — come back anytime to see the trend

## Why Fairtrail?

Airlines change flight prices hundreds of times a day. They know exactly when you searched, how many times you came back, and how desperate you are. They use this to maximize what you pay — not minimize it.

**No one shows you the price trend because the companies with the data profit from hiding it:**

1. **Aggregators want you inside their app.** Google Flights and Hopper track price history internally but lock it behind your account — or don't show it at all.
2. **"Buy or Wait" is more profitable than transparency.** A black-box prediction keeps you dependent on their platform.
3. **Airlines don't want price transparency.** If you can see that a route dips 3 weeks before departure, that undermines dynamic pricing.

Fairtrail exists because the data is useful to *you* — just not to the companies that have it.

### What you get

- **Natural language search** — `"NYC to Paris around June 15 ± 3 days"`
- **Price evolution charts** — see how fares move over days and weeks
- **Shareable links** — send `/q/abc123` to anyone, no login required
- **Direct booking links** — click any data point to go straight to the airline
- **Airline comparison** — see which carriers are cheapening vs. getting expensive
- **Self-hosted** — your searches stay private, your data stays on your machine
- **Agent-friendly API** — hook Claude Code, Codex, or any agent into your instance

### Why self-host instead of using fairtrail.org?

- **It can't work any other way.** A centralized service scraping Google Flights gets IP-banned within days. Thousands of self-hosted instances, each making a few quiet requests from different IPs, is the only architecture that survives. Decentralization isn't a philosophy — it's the only design that works.
- **Your searches stay private.** No one sees what routes you're watching or when you're planning to travel. Airlines can't use your search history against you.
- **You control the scrape frequency.** Default is every 3 hours. Want every hour? Change one setting.
- **Free with Claude Code, Codex, or a local model.** Use your existing CLI subscription, or run Ollama / llama.cpp / vLLM locally - zero API cost.
- **Your data, your database.** Price history lives in your own Postgres. Export it, analyze it, keep it forever.

## Requirements

- [Docker Desktop](https://docs.docker.com/get-docker/) (runs everything behind the scenes — you won't interact with it directly)
- One of:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code) (free with Claude Pro/Max) — auto-detected
  - [Codex](https://github.com/openai/codex) (free with ChatGPT Pro) — auto-detected
  - An API key from Anthropic, OpenAI, or Google
  - [Ollama](https://ollama.com), [llama.cpp](https://github.com/ggml-org/llama.cpp), or [vLLM](https://docs.vllm.ai) - first-class local model support, configurable from the admin UI

## LLM Providers

Fairtrail needs an LLM for two things: parsing natural language queries and extracting price data from Google Flights pages. Pick **any one** of these:

| Provider | Auth | Cost | Notes |
|----------|------|------|-------|
| **Claude Code** | Auto-detected (host `~/.claude`) | Free (Pro/Max plan) | Subscription CLI — mounts auth read-only |
| **Codex CLI** | Auto-detected (host `~/.codex`) | Free (ChatGPT Pro) | Subscription CLI — mounts auth read-only |
| **Anthropic** | `ANTHROPIC_API_KEY` | Pay-per-token | Claude Haiku 4.5 (default) |
| **OpenAI** | `OPENAI_API_KEY` | Pay-per-token | GPT-4.1 Mini |
| **Google** | `GOOGLE_AI_API_KEY` | Pay-per-token | Gemini 2.5 Flash |
| **Ollama** | None (local) | Free | First-class provider - select in admin UI, type your model ID |
| **llama.cpp** | None (local) | Free | First-class provider - select in admin UI, type your model ID |
| **vLLM** | None (local) | Free | First-class provider - GPU-accelerated inference server (port 8000) |
| **OpenAI + custom URL** | `OPENAI_BASE_URL` | Varies | OpenRouter or any OpenAI-compatible endpoint |

**Three ways to use Fairtrail:**

- **Subscription users** (Claude Pro/Max, ChatGPT Pro) — the installer detects `claude` or `codex` on your machine and mounts their config dirs read-only into the container. Your auth tokens are never copied; the container cannot modify them.
- **API key users** — paste an Anthropic, OpenAI, or Google key. Passed via env var, never written to disk.
- **Local model users** — select Ollama, llama.cpp, or vLLM in the admin UI, type your model ID, and optionally set a custom base URL. No API key needed.

## Configuration

All settings are in `~/.fairtrail/.env` (generated by the installer). Key options:

| Variable | Default | Description |
|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | — | Anthropic API key (one LLM provider required) |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `OPENAI_BASE_URL` | — | Custom endpoint for OpenAI provider (vLLM, OpenRouter) |
| `GOOGLE_AI_API_KEY` | — | Google AI API key |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server address (base URL derived as `$OLLAMA_HOST/v1`) |
| `POSTGRES_PASSWORD` | `postgres` | Database password |
| `ADMIN_PASSWORD` | Auto-generated | Admin panel password |
| `CRON_ENABLED` | `true` | Enable built-in scrape scheduler |
| `CRON_INTERVAL_HOURS` | `3` | Hours between scrape runs |
| `HOST_PORT` | `3003` | Host port to access Fairtrail (container always listens on 3003 internally) |

Secrets left empty are auto-generated on first run and printed in Docker logs.

## Community Data

Fairtrail is **fully decentralized**. You run everything — scraping, LLM calls, storage — on your own machine. There is no central server doing work for you.

**What fairtrail.org does:** aggregates anonymized price data that self-hosted instances **opt in** to share. Think of it as a community price database that grows as more people run Fairtrail.

**What gets shared (opt-in only):**
- Route (origin/destination airports)
- Travel date, price, currency, airline, stops, cabin class
- When the data was scraped

**What is never shared:**
- Your queries, search history, or preferences
- Your LLM API keys
- Your IP address or identity

Enable community sharing during the setup wizard or later in `/admin → Config`. Explore community data at [fairtrail.org/explore](https://fairtrail.org/explore).

## Agent & CLI Integration

Your local Fairtrail instance exposes a REST API that any agent, script, or CLI tool can use. No SDK needed — just HTTP calls to `localhost:3003`.

See [`AGENTS.md`](AGENTS.md) for the full API reference.

### Quick example

```bash
# 1. Parse a natural language query
curl -s -X POST http://localhost:3003/api/parse \
  -H "Content-Type: application/json" \
  -d '{"query": "NYC to Paris around June 15 ± 3 days"}' | jq .

# 2. Create a tracked query (use the parsed response)
curl -s -X POST http://localhost:3003/api/queries \
  -H "Content-Type: application/json" \
  -d '{
    "rawInput": "NYC to Paris around June 15 ± 3 days",
    "origin": "JFK", "originName": "New York JFK",
    "destination": "CDG", "destinationName": "Paris CDG",
    "dateFrom": "2026-06-12", "dateTo": "2026-06-18",
    "flexibility": 3, "cabinClass": "economy",
    "tripType": "round_trip", "routes": [...]
  }' | jq .

# 3. Trigger an immediate scrape (CRON_SECRET is auto-generated at startup, check docker logs)
curl -s http://localhost:3003/api/cron/scrape \
  -H "Authorization: Bearer $(docker compose -f docker-compose.prod.yml logs web 2>&1 | grep -oP 'CRON_SECRET=\K\S+')" | jq .

# 4. Get price data for a query
curl -s http://localhost:3003/api/queries/{id}/prices | jq .
```

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

The built-in cron runs on a configurable interval (default: every 3h). Each run captures prices across all active queries and the chart pages update automatically.

## Headless CLI

Run Fairtrail entirely in the terminal — no browser needed.

```bash
fairtrail --headless                              # Interactive search wizard
fairtrail --headless --backend claude-code        # Use Claude Code as AI backend
fairtrail --headless --backend codex              # Use Codex as AI backend
fairtrail --headless --list                       # Show all tracked queries
fairtrail --headless --view <id>                  # Live price chart (auto-refreshes every 30s)
fairtrail --headless --view <id> --tmux           # Split grouped routes into tmux panes
```

Without `--headless`, `--view` opens the chart in your browser and `--list` opens the admin dashboard.

<img src="packages/cli/demo/fairtrail-demo.gif" alt="Fairtrail CLI — Claude Code vs Codex side by side, search and live price charts" width="100%">

### Features

- **Natural language search** — same as the web, powered by your chosen AI backend
- **Braille chart** — Unicode price evolution chart with per-airline colored trend lines
- **Live refresh** — countdown bar, auto-refreshes from DB, flashes when new data arrives
- **Multi-destination** — "Frankfurt to Bogota or Medellin" searches both routes
- **tmux integration** — `--tmux` splits each grouped route into its own pane
- **Backend selection** — `--backend claude-code|codex|anthropic|openai|google|ollama|llamacpp|vllm`

## Managing Fairtrail

```
Usage: fairtrail [command]

Commands:
  (none)       Start Fairtrail (Ctrl+C to stop)
  search ".."  Search and track a flight from the terminal
  start        Start in background
  stop         Stop — pauses all price tracking until you start again
  logs         View live logs
  status       Check if running
  update       Pull latest version and restart
  version      Show version and commit
  uninstall    Remove Fairtrail and all data
  help         Show this help
```

Stopping Fairtrail pauses all scraping — no queries run while it's off. Your data and queries are saved. Just run `fairtrail` again to resume tracking.

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

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15 (App Router), TypeScript, CSS Modules |
| Database | PostgreSQL 16 + Prisma ORM |
| Cache | Redis 7 (optional) |
| Browser | Playwright (headless Chromium) |
| LLM | Anthropic, OpenAI, Google, Claude Code, Codex, Ollama, llama.cpp, or vLLM |
| Charts | Plotly.js (interactive) |
| Cron | Built-in (node-cron) or external trigger |

## Settings

Access at `/admin` (no login required on self-hosted instances):

- **Manage queries** — pause, resume, delete, adjust scrape frequency
- **Configure LLM** — choose extraction provider and model
- **Monitor costs** — see LLM API usage per scrape run
- **View fetch history** — success/failure status, errors, snapshot counts

## Contributing

Pull requests welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Disclaimer

**Fairtrail is an informational tool only.** Flight prices shown are scraped from third-party sources and may be inaccurate, outdated, or incomplete. Airlines change prices based on demand, search history, seat availability, and other factors — the price you see in Fairtrail may differ from the price you're offered at checkout. **Do not make purchasing decisions based solely on Fairtrail data.** Always verify prices directly with the airline or booking platform before buying. The authors are not responsible for any financial loss, missed deals, or incorrect pricing information.

## Legal

Fairtrail is a personal tool that scrapes publicly available flight pricing data. In the US, scraping publicly accessible websites does not violate the [Computer Fraud and Abuse Act](https://en.wikipedia.org/wiki/Computer_Fraud_and_Abuse_Act) ([*hiQ Labs v. LinkedIn*, 9th Cir. 2022](https://en.wikipedia.org/wiki/HiQ_Labs_v._LinkedIn)). Fairtrail does not circumvent any login, paywall, or technical access control.

That said, automated access to third-party websites may conflict with their terms of service. **Users are solely responsible for complying with the terms of service of any website they interact with through Fairtrail.** This project is not affiliated with, endorsed by, or associated with Google, any airline, or any travel booking platform.

This software is provided as-is for personal and educational use.

## Related Projects

| Project | Description |
|---------|-------------|
| [**PriceToken**](https://github.com/affromero/pricetoken) | Real-time LLM pricing API, npm/PyPI packages, and live dashboard |
| [**gitpane**](https://github.com/affromero/gitpane) | Multi-repo Git workspace dashboard for the terminal |
| [**kin3o**](https://github.com/affromero/kin3o) | AI-powered Lottie animation generator CLI |

## License

MIT

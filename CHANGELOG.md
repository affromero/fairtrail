# Changelog

## [0.3.9] - 2026-03-20

### Added
- Podman support: installer and CLI detect Podman as a fallback when Docker is absent ([#13](https://github.com/affromero/fairtrail/issues/13))
- Podman networking: `host.containers.internal` for Ollama, conditional `extra_hosts` in generated compose
- Schema assertion test to prevent `bookingUrl` regression
- DELETE and PATCH endpoint tests covering hosted/self-hosted auth paths
- `run-scrape.ts` unit tests (previously untested)

### Fixed
- Flight tracking crash when LLM returns null `bookingUrl` ([#14](https://github.com/affromero/fairtrail/issues/14))
- Delete button invisible on touch devices and after browser/server reinstall ([#8](https://github.com/affromero/fairtrail/issues/8))
- Self-hosted users unable to delete or update trackers without original session token
- Null booking URLs causing crashes in BestPrice, PriceCalendar, PriceHistory components

## [0.3.8] - 2026-03-18

### Added
- Currency and country fields on the self-hosted settings page (matching admin config)
- Health check for local providers (Ollama, llama.cpp, vLLM) before marking as "ready"
- `'unreachable'` status in providers API for local providers that don't respond
- Docker Compose integration test suite (17 checks against live app + DB + Redis)
- Playwright browser smoke tests (10 checks: pages, inputs, navigation, static assets)
- Debian Docker end-to-end installer test (17 checks in real Debian container)
- Staging test that runs on the production server (22 checks via SSH)
- Vitest and shell tests now run in CI on every PR
- Volume migration safety tests (project name match, no `down -v`)
- `FAIRTRAIL_SKIP_START` and `FAIRTRAIL_SKIP_PULL` install.sh overrides for test automation
- Non-interactive mode (`FAIRTRAIL_YES=1`) skips API key prompt

### Fixed
- `fairtrail update` hardcoded `~/.local/bin/fairtrail` instead of detecting the actual binary path ([#8](https://github.com/affromero/fairtrail/issues/8))
- `fairtrail update` swallowed curl errors with `2>/dev/null`
- CLI not in PATH on Debian SSH sessions (installer patched `.bashrc` but not `.profile`)
- Old `~/fairtrail` directories left behind after migration to `~/.fairtrail`
- Ollama, llama.cpp, and vLLM shown as "ready" even when unreachable
- `HOST_PORT` vs `PORT` confusion in generated `.env` (now documented with warning in entrypoint)

## [0.3.7] - 2026-03-17

### Added
- vLLM as first-class local provider (GPU-accelerated inference, default port 8000)
- Dynamic model discovery for vLLM via `/v1/models` endpoint
- vLLM listed in README, landing page, and CLAUDE.md

### Changed
- Refactored `fetchLlamacppModels` into shared `fetchOpenAICompatModels` (reused by llamacpp and vLLM)

## [0.3.6] - 2026-03-17

### Added
- Dynamic model discovery for Ollama and llama.cpp. Config pages now fetch installed models from the local instance and show them in a dropdown instead of an empty select ([#9](https://github.com/affromero/fairtrail/issues/9))
- New `/api/admin/local-models` endpoint with Redis caching (5min TTL) for querying Ollama `/api/tags` and llama.cpp `/v1/models`
- Installer now detects Ollama running locally, lists available models, and writes Docker-compatible `OLLAMA_HOST` (`host.docker.internal`)
- `extra_hosts` for `host.docker.internal` in Docker Compose so containers can reach host-local services on Linux

### Fixed
- Empty model dropdown when selecting Ollama or llama.cpp in admin config, settings, and setup pages
- Installer no longer requires a paid API key when Ollama is available
- Ollama API `parameter_size` read from `details.parameter_size` (not top-level), fixing incorrect model size display
- Race condition in setup wizard where async model fetch could overwrite user-typed model ID
- Client-side validation prevents saving with an empty model ID
- Stale model list no longer shown alongside "Fetching models..." during provider switch

## [0.3.5] - 2026-03-17

### Added
- First-class Ollama and llama.cpp providers — select from the admin UI dropdown, type your model ID, and optionally set a custom base URL. No env vars needed ([#8](https://github.com/affromero/fairtrail/issues/8), thanks [@johenkel](https://github.com/johenkel))
- DB-persisted `customBaseUrl` field on ExtractionConfig — configure LLM endpoints from the admin UI instead of requiring server-side env vars
- Base URL input in admin config, settings, and setup pages with auto-populated defaults per provider

### Fixed
- Installer and CLI now support both `docker compose` (v2 plugin) and `docker-compose` (v1 standalone) — fixes install failure on Docker 20.x systems ([#8](https://github.com/affromero/fairtrail/issues/8), thanks [@johenkel](https://github.com/johenkel))

## [0.3.4] - 2026-03-16

### Fixed
- Complete `HOST_PORT` migration — CLI wrapper and Node CLI now respect `HOST_PORT`/`FAIRTRAIL_URL` env vars instead of hardcoded `localhost:3003`
- Setup route password hash mismatch — was storing SHA-256 but login expects scrypt; setup passwords now hash correctly
- API-created query trackers no longer garbage-collected by stale cleanup — `firstViewedAt` is set on creation
- Preview cache key now includes cabin class, trip type, and currency — prevents stale cached results across different search parameters
- Multi-date round-trip preview pairs outbound/return dates by index instead of using only the first return date
- Concurrent scrape runs blocked by process-level mutex — duplicate cron + manual triggers return 409 instead of duplicating snapshots
- Removed `--accept-data-loss` from `prisma db push` in entrypoint and deploy workflow — destructive schema changes now require manual intervention

## [0.3.3] - 2026-03-15

### Fixed
- `PORT` env var leaking into Docker container is now fully resolved — entrypoint hardcodes internal port to 3003 regardless of env_file contents, so custom compose files no longer need a `PORT: "3003"` override ([#4](https://github.com/affromero/fairtrail/issues/4))
- Renamed user-facing `PORT` env var to `HOST_PORT` to eliminate ambiguity between host mapping and container bind port

### Documentation
- Added local model provider (Ollama, llama.cpp, vLLM) to README LLM table and quick start
- Consolidated README configuration tables

## [0.3.2] - 2026-03-14

### Added
- Custom OpenAI-compatible endpoints via `OPENAI_BASE_URL` — run local models (Ollama, llama.cpp, vLLM) or alternative providers (OpenRouter) with any model ID ([#7](https://github.com/affromero/fairtrail/issues/7))
- Local endpoints work without an API key — no `OPENAI_API_KEY` needed when `OPENAI_BASE_URL` is set

### Fixed
- Codex CLI auth failure in Docker containers — permission-denied errors on host `~/.codex` mount are now reported clearly instead of failing silently with 401 ([#1](https://github.com/affromero/fairtrail/issues/1))
- CLI providers (codex, claude-code) are only shown as available when auth is actually configured, preventing users from selecting an unauthenticated provider
- Claude Code entrypoint copy now uses permission-aware logic with actionable error messages (same fix as codex)
- Benign "could not update PATH" warnings stripped from CLI error output; 401 errors include an auth hint
- Container PORT env var no longer leaks into the app ([#4](https://github.com/affromero/fairtrail/issues/4))

### Changed
- Removed `CODEX_ENABLED` / `CLAUDE_CODE_ENABLED` env vars — CLI providers are auto-detected by binary presence + auth file checks
- Removed auth.json generation from entrypoint — API key users use SDK providers directly; CLI providers are for subscription users who mount host auth dirs
- CLI auth copy and install wrapped in `SELF_HOSTED` guard to skip on production server (~15s startup savings)

## [0.3.1] - 2026-03-14

### Added
- `--backend` and `--model` CLI flags to select AI provider per session
- Multi-destination parsing: "Bogota or Medellin" creates separate route searches
- CLI demo GIF and Headless CLI section in README

### Fixed
- Multi-route flight selection now tracks all routes (via `_routeIdx` tagging)
- `--tmux` inside tmux splits into new panes instead of sending to own running pane
- `--tmux` works with single-route queries (no split, just view)
- Chart flicker eliminated by memoizing expensive renders (countdown ticks don't redraw chart)
- CLI providers (claude-code, codex) no longer require API key env vars
- Commander import fixed for Linux CI typecheck
- Docker PORT env var no longer leaks into container

## [0.3.0] - 2026-03-13

### Added
- **Headless CLI TUI** (`--headless`) — full terminal interface for flight price tracking using Ink 6 (React for terminals)
  - Interactive search wizard: natural language query, LLM parse, Playwright scrape, flight selection, DB tracking
  - `--headless --list` — navigable table of all tracked queries with status, prices, last scraped time
  - `--headless --view <id>` — live price chart with Unicode braille rendering, auto-refresh every 30s with countdown bar, per-airline colored trend lines
  - `--headless --view <id> --tmux` — opens isolated tmux session in new Ghostty window with one pane per grouped route
- **`packages/cli/` workspace** — new monorepo package sharing scraper libs from `apps/web/` via custom Node.js ESM alias loader
- **Braille chart renderer** — Unicode braille characters (2x4 dot grid) with Bresenham line drawing, dynamic Y-axis scaling, rolling time window
- Without `--headless`, `--view` opens the web browser and `--list` opens the admin dashboard
- 28 unit tests for chart renderer and formatters, plus E2E test script

### Fixed
- Chart dynamically adapts to tmux pane dimensions on resize

### Changed
- Root `npm run cli` now implies `--headless` for terminal usage
- CI lint and typecheck now include the CLI workspace

## [0.2.3] - 2026-03-13

### Fixed
- Codex CLI `--print` error — codex does not support `--print` (Claude Code flag); now uses `codex exec` for non-interactive extraction ([#1](https://github.com/affromero/fairtrail/issues/1) — thanks @bobvmierlo)
- CLI checksum verification removed — was blocking installs when the CLI script changed between releases
- Both Claude Code and Codex CLIs now install unconditionally in the container (no env var gating needed)
- Telegram deploy notifications no longer fire on cancelled CI runs

### Changed
- README updated: full CLI help output, explains why `~/.claude` and `~/.codex` are mounted read-only, CLI providers show as auto-detected

## [0.2.2] - 2026-03-13

### Fixed
- `fairtrail: command not found` on Ubuntu — installer now auto-patches shell profile to add `~/.local/bin` to PATH ([#1](https://github.com/affromero/fairtrail/issues/1) — thanks @bobvmierlo)
- `spawn codex ENOENT` in Docker — entrypoint installs CLI providers (codex, claude) inside the container when enabled, persisted via `cli-cache` volume ([#1](https://github.com/affromero/fairtrail/issues/1))
- `xdg-open` error spam on headless Linux — guarded behind `DISPLAY`/`WAYLAND_DISPLAY` check ([#1](https://github.com/affromero/fairtrail/issues/1))
- Install one-liner changed from `| sh` to `| bash` — the script uses bash-specific syntax that breaks under dash (Ubuntu default `sh`)
- Codex CLI spawn now passes `env` to child process (was missing, unlike claude-code)
- Actionable ENOENT error messages for CLI providers instead of raw stack traces

### Added
- Tests for CLI provider detection, ENOENT handling, and installer shell script correctness (18 new tests)

## [0.2.1] - 2026-03-09

### Added
- "What Fairtrail is not" section on landing page
- System theme detection with demo GIF swap for light/dark modes
- Behavioral test suite (110 tests across 14 files)
- Cron scheduling jitter (±2.5min) to avoid bot detection

### Fixed
- Docker multi-arch manifest so `fairtrail update` works on Apple Silicon (arm64)
- Docker image slimmed from 1GB to 475MB
- Pin Prisma@6 in entrypoint and deploy to avoid v7 breaking changes
- POSIX shell compatibility for installer (replace `echo -e` with `printf`)
- Mount `~/.claude.json` config in installer for Claude Code CLI users

### Changed
- CI cancels in-progress deploys when a new push arrives

## [0.2.0] - 2026-03-08

### Added
- OS detection in installer with Docker install guidance for Linux and WSL
- Port conflict check during install with interactive port selection
- Browser auto-open when starting Fairtrail via CLI
- `fairtrail version` command showing version and git commit SHA
- Commit SHA exposed in `/api/version` endpoint for build traceability
- "Why self-hosted?" section on landing page
- PNG favicon and Apple touch icon for cross-browser support

### Changed
- Self-hosted instances skip admin password setup — go straight to provider selection
- Install script shows security-relevant commands before executing

## [0.1.0] - 2026-03-08

### Added
- Natural language flight search powered by LLM (Anthropic, OpenAI, Google AI)
- Automated price tracking via Google Flights scraping (Playwright + headless Chromium)
- Interactive Plotly.js price evolution charts with airline colors and click-to-book
- Self-hosted Docker installer (`curl -fsSL https://fairtrail.org/install.sh | sh`)
- `fairtrail` CLI for managing self-hosted instances (start, stop, logs, search)
- Multi-currency support with locale auto-detection
- Multiple travel date support with date grouping in charts
- Price drop alerts on home page
- Share links, CSV export, and price calendar on chart pages
- Community route sharing between self-hosted instances
- Explore page with seed routes and popular destinations
- Admin dashboard with query management, LLM config, and cost tracking
- PWA support with auto-update banner
- Configurable scrape interval (default 3h)
- GitHub Actions CI/CD with Docker image publishing to GHCR

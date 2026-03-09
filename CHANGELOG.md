# Changelog

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

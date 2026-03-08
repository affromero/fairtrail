#!/usr/bin/env bash
set -euo pipefail

# Fairtrail — One-command installer
# Usage: curl -fsSL https://fairtrail.org/install.sh | sh
#
# Installs the fairtrail CLI and Docker services to ~/.fairtrail
# No git clone, no build — pulls a pre-built image from GHCR.

BOLD='\033[1m'
DIM='\033[2m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

info()  { echo -e "${CYAN}${BOLD}▸${RESET} $1"; }
ok()    { echo -e "${GREEN}${BOLD}✓${RESET} $1"; }
warn()  { echo -e "${YELLOW}${BOLD}!${RESET} $1"; }
fail()  { echo -e "${RED}${BOLD}✗${RESET} $1"; exit 1; }

FAIRTRAIL_DIR="$HOME/.fairtrail"
INSTALL_BIN="$HOME/.local/bin"
PORT="${PORT:-3003}"
BASE_URL="${FAIRTRAIL_URL:-https://fairtrail.org}"

echo ""
echo -e "${BOLD}  Fairtrail — Flight Price Tracker${RESET}"
echo -e "  ${DIM}The price trail airlines don't show you${RESET}"
echo ""

# ---------------------------------------------------------------------------
# 1. Check prerequisites
# ---------------------------------------------------------------------------
command -v docker &>/dev/null || fail "Docker is required. Install from https://docs.docker.com/get-docker/"
docker info &>/dev/null 2>&1  || fail "Docker is not running. Start Docker Desktop and try again."

ok "Docker is running"

# ---------------------------------------------------------------------------
# 2. Migrate from old install location
# ---------------------------------------------------------------------------
if [ -d "$HOME/fairtrail" ] && [ ! -d "$FAIRTRAIL_DIR" ]; then
  warn "Found old install at ~/fairtrail"
  echo -e "  ${DIM}The new install location is ~/.fairtrail${RESET}"
  echo -e "  ${DIM}Your Docker volumes (tracked queries, price data) are preserved.${RESET}"
  echo ""
fi

# ---------------------------------------------------------------------------
# 3. Create install directory + write docker-compose.yml
# ---------------------------------------------------------------------------
mkdir -p "$FAIRTRAIL_DIR"

cat > "$FAIRTRAIL_DIR/docker-compose.yml" << 'COMPOSE'
services:
  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: fairtrail
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-postgres}
    volumes:
      - pgdata:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redisdata:/data
    ports:
      - "127.0.0.1:6380:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5

  web:
    image: ghcr.io/affromero/fairtrail:latest
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "${PORT:-3003}:3003"
    env_file: .env
    environment:
      DATABASE_URL: postgresql://postgres:${POSTGRES_PASSWORD:-postgres}@db:5432/fairtrail
      REDIS_URL: ${REDIS_URL:-redis://redis:6379}
      CHROME_PATH: /usr/bin/chromium-browser
      NODE_ENV: production
      SELF_HOSTED: "true"
    volumes:
      - app-data:/app/data

volumes:
  pgdata:
  redisdata:
  app-data:
COMPOSE

ok "Created ~/.fairtrail"

# ---------------------------------------------------------------------------
# 4. Install the fairtrail CLI
# ---------------------------------------------------------------------------
mkdir -p "$INSTALL_BIN"

info "Downloading CLI..."
if curl -fsSL "$BASE_URL/fairtrail-cli" -o "$INSTALL_BIN/fairtrail.tmp" 2>/dev/null; then
  mv -f "$INSTALL_BIN/fairtrail.tmp" "$INSTALL_BIN/fairtrail"
  chmod +x "$INSTALL_BIN/fairtrail"
  ok "Installed fairtrail to $INSTALL_BIN/fairtrail"
else
  rm -f "$INSTALL_BIN/fairtrail.tmp"
  fail "Failed to download CLI from $BASE_URL/fairtrail-cli"
fi

# Check if ~/.local/bin is in PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_BIN"; then
  warn "$INSTALL_BIN is not in your PATH"
  echo ""
  echo -e "  Add this to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
  echo -e "  ${BOLD}export PATH=\"\$HOME/.local/bin:\$PATH\"${RESET}"
  echo ""
fi

# ---------------------------------------------------------------------------
# 5. Detect LLM providers (Claude Code CLI / Codex CLI / API key prompt)
# ---------------------------------------------------------------------------
CLAUDE_CODE_DETECTED=false
CODEX_DETECTED=false
API_KEY_VAR=""
API_KEY_VAL=""

if command -v claude &>/dev/null && [ -d "$HOME/.claude" ]; then
  CLAUDE_CODE_DETECTED=true
  ok "Claude Code CLI detected — no API key needed"
fi

if command -v codex &>/dev/null && [ -d "$HOME/.codex" ]; then
  CODEX_DETECTED=true
  ok "Codex CLI detected — no API key needed"
fi

if [ "$CLAUDE_CODE_DETECTED" = false ] && [ "$CODEX_DETECTED" = false ]; then
  warn "No Claude Code or Codex CLI found"
  echo ""
  echo -e "  Paste an API key from any provider:"
  echo -e "  ${DIM}1. Anthropic  — https://console.anthropic.com/${RESET}"
  echo -e "  ${DIM}2. OpenAI     — https://platform.openai.com/api-keys${RESET}"
  echo -e "  ${DIM}3. Google AI  — https://aistudio.google.com/apikey${RESET}"
  echo ""
  read -rsp "  API key: " API_KEY_VAL
  echo ""

  if [ -z "$API_KEY_VAL" ]; then
    fail "No API key provided. Install Claude Code (https://docs.anthropic.com/en/docs/claude-code) or provide an API key."
  fi

  if [[ "$API_KEY_VAL" == sk-ant-* ]]; then
    API_KEY_VAR="ANTHROPIC_API_KEY"
    ok "Detected Anthropic key"
  elif [[ "$API_KEY_VAL" == sk-* ]]; then
    API_KEY_VAR="OPENAI_API_KEY"
    ok "Detected OpenAI key"
  elif [[ "$API_KEY_VAL" == AI* ]]; then
    API_KEY_VAR="GOOGLE_AI_API_KEY"
    ok "Detected Google AI key"
  else
    echo ""
    echo "  Which provider is this key for?"
    echo "  1) Anthropic"
    echo "  2) OpenAI"
    echo "  3) Google AI"
    read -rp "  Choice [1-3]: " PROVIDER_CHOICE
    case "$PROVIDER_CHOICE" in
      1) API_KEY_VAR="ANTHROPIC_API_KEY" ;;
      2) API_KEY_VAR="OPENAI_API_KEY" ;;
      3) API_KEY_VAR="GOOGLE_AI_API_KEY" ;;
      *) fail "Invalid choice" ;;
    esac
    ok "Using ${API_KEY_VAR}"
  fi
fi

# ---------------------------------------------------------------------------
# 6. Generate .env
# ---------------------------------------------------------------------------
generate_secret() {
  head -c 32 /dev/urandom | xxd -p | tr -d '\n' | head -c 32
}

if [ -f "$FAIRTRAIL_DIR/.env" ]; then
  warn "Existing .env found — keeping it"
else
  CRON_SECRET=$(generate_secret)

  {
    echo "# Generated by Fairtrail installer — $(date -u '+%Y-%m-%d %H:%M UTC')"
    echo "POSTGRES_PASSWORD=postgres"
    echo ""
    echo "# Cron auth"
    echo "CRON_SECRET=${CRON_SECRET}"
    echo ""
    if [ "$CLAUDE_CODE_DETECTED" = true ]; then
      echo "# Using Claude Code CLI (your existing subscription)"
      echo "CLAUDE_CODE_ENABLED=true"
    fi
    if [ "$CODEX_DETECTED" = true ]; then
      echo "# Using Codex CLI (your existing subscription)"
      echo "CODEX_ENABLED=true"
    fi
    if [ -n "$API_KEY_VAR" ]; then
      echo "${API_KEY_VAR}=${API_KEY_VAL}"
    fi
  } > "$FAIRTRAIL_DIR/.env"
  ok "Generated .env"
fi

# ---------------------------------------------------------------------------
# 7. Generate docker-compose.override.yml for CLI volume mounts
# ---------------------------------------------------------------------------
NEED_OVERRIDE=false
OVERRIDE_VOLUMES=""

if [ "$CLAUDE_CODE_DETECTED" = true ]; then
  NEED_OVERRIDE=true
  OVERRIDE_VOLUMES="${OVERRIDE_VOLUMES}
      - ${HOME}/.claude:/home/node/.claude:ro"
fi

if [ "$CODEX_DETECTED" = true ]; then
  NEED_OVERRIDE=true
  OVERRIDE_VOLUMES="${OVERRIDE_VOLUMES}
      - ${HOME}/.codex:/home/node/.codex:ro"
fi

if [ "$NEED_OVERRIDE" = true ]; then
  cat > "$FAIRTRAIL_DIR/docker-compose.override.yml" << YAML
# Auto-generated — mounts CLI auth into the container
services:
  web:
    volumes:${OVERRIDE_VOLUMES}
YAML
  ok "Mounted CLI credentials"
else
  rm -f "$FAIRTRAIL_DIR/docker-compose.override.yml"
fi

# ---------------------------------------------------------------------------
# 8. Pull image and start
# ---------------------------------------------------------------------------
info "Pulling Fairtrail (this takes a minute on first run)..."
echo ""

cd "$FAIRTRAIL_DIR"

docker compose pull 2>&1 | while IFS= read -r line; do
  echo -e "  ${DIM}${line}${RESET}"
done

docker compose up -d 2>&1 | while IFS= read -r line; do
  echo -e "  ${DIM}${line}${RESET}"
done

echo ""

# ---------------------------------------------------------------------------
# 9. Wait for the app to be ready
# ---------------------------------------------------------------------------
info "Waiting for the app to start..."

RETRIES=60
until curl -sf "http://localhost:${PORT}/api/health" >/dev/null 2>&1; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    warn "App didn't respond in 60s — run 'fairtrail logs' to debug"
    break
  fi
  sleep 1
done

if [ "$RETRIES" -gt 0 ]; then
  ok "Fairtrail is running"
fi

# ---------------------------------------------------------------------------
# 10. Print summary
# ---------------------------------------------------------------------------
echo ""
echo -e "${BOLD}  ┌──────────────────────────────────────────────────┐${RESET}"
echo -e "${BOLD}  │                                                  │${RESET}"
echo -e "${BOLD}  │${RESET}   ${CYAN}Fairtrail is ready${RESET}                            ${BOLD}│${RESET}"
echo -e "${BOLD}  │${RESET}                                                  ${BOLD}│${RESET}"
echo -e "${BOLD}  │${RESET}   Open:  ${BOLD}http://localhost:${PORT}${RESET}                  ${BOLD}│${RESET}"
echo -e "${BOLD}  │${RESET}                                                  ${BOLD}│${RESET}"

if [ "$CLAUDE_CODE_DETECTED" = true ] || [ "$CODEX_DETECTED" = true ]; then
  echo -e "${BOLD}  │${RESET}   LLM:   ${GREEN}Using your existing CLI subscription${RESET}  ${BOLD}│${RESET}"
else
  echo -e "${BOLD}  │${RESET}   LLM:   API key configured                     ${BOLD}│${RESET}"
fi

echo -e "${BOLD}  │${RESET}                                                  ${BOLD}│${RESET}"
echo -e "${BOLD}  └──────────────────────────────────────────────────┘${RESET}"
echo ""
echo -e "  Next time, just run: ${BOLD}fairtrail${RESET}"
echo -e "  ${DIM}Ctrl+C to stop  |  fairtrail stop  |  fairtrail help${RESET}"
echo ""

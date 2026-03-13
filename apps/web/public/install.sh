#!/usr/bin/env bash
set -euo pipefail

# Fairtrail — One-command installer
# Usage: curl -fsSL https://fairtrail.org/install.sh | bash
#
# Installs the fairtrail CLI and Docker services to ~/.fairtrail
# No git clone, no build — pulls a pre-built image from GHCR.
#
# Want to inspect this script before running it?
#   curl -fsSL https://fairtrail.org/install.sh | less

BOLD='\033[1m'
DIM='\033[2m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

info()  { printf "${CYAN}${BOLD}▸${RESET} %b\n" "$1"; }
ok()    { printf "${GREEN}${BOLD}✓${RESET} %b\n" "$1"; }
warn()  { printf "${YELLOW}${BOLD}!${RESET} %b\n" "$1"; }
fail()  { printf "${RED}${BOLD}✗${RESET} %b\n" "$1"; exit 1; }

FAIRTRAIL_DIR="$HOME/.fairtrail"
INSTALL_BIN="$HOME/.local/bin"
PORT="${PORT:-3003}"
BASE_URL="${FAIRTRAIL_URL:-https://fairtrail.org}"

echo ""
printf "${BOLD}  Fairtrail — Flight Price Tracker${RESET}\n"
printf "  ${DIM}The price trail airlines don't show you${RESET}\n"
echo ""

# ---------------------------------------------------------------------------
# 0. Transparency summary — show what this installer does before proceeding
# ---------------------------------------------------------------------------
printf "  ${BOLD}This installer will:${RESET}\n"
echo ""
printf "  ${DIM}1.${RESET} Install 3 Docker containers to ${BOLD}~/.fairtrail/${RESET}\n"
printf "     ${DIM}• PostgreSQL 16 (your local database — nothing leaves your machine)${RESET}\n"
printf "     ${DIM}• Redis 7 (local cache)${RESET}\n"
printf "     ${DIM}• Fairtrail web app (from ghcr.io/affromero/fairtrail)${RESET}\n"
echo ""
printf "  ${DIM}2.${RESET} Download the ${BOLD}fairtrail${RESET} CLI to ${BOLD}~/.local/bin/${RESET}\n"
echo ""
printf "  ${DIM}3.${RESET} Generate a local ${BOLD}.env${RESET} config file in ~/.fairtrail/\n"
echo ""
printf "  ${DIM}No data leaves your machine. No account required.${RESET}\n"
printf "  ${DIM}Open source (MIT) — ${BOLD}https://github.com/AFFRomero/fairtrail${RESET}\n"
echo ""

# Allow non-interactive mode (e.g., CI) by setting FAIRTRAIL_YES=1
if [ "${FAIRTRAIL_YES:-}" != "1" ]; then
  read -rp "  Continue? [Y/n] " CONSENT < /dev/tty
  if [[ "$CONSENT" =~ ^[Nn]$ ]]; then
    echo ""
    printf "  ${DIM}No changes were made. Inspect the script:${RESET}\n"
    printf "  ${BOLD}curl -fsSL https://fairtrail.org/install.sh | less${RESET}\n"
    echo ""
    exit 0
  fi
  echo ""
fi

# ---------------------------------------------------------------------------
# 1. Detect OS and check prerequisites
# ---------------------------------------------------------------------------
OS="unknown"
case "$(uname -s)" in
  Darwin*)  OS="macos" ;;
  Linux*)
    if grep -qi microsoft /proc/version 2>/dev/null; then
      OS="wsl"
    else
      OS="linux"
    fi
    ;;
esac

install_docker_linux() {
  info "Installing Docker Engine..."
  if ! command -v sudo &>/dev/null; then
    fail "sudo is required to install Docker. Install sudo first, then re-run."
  fi
  printf "  ${DIM}This requires sudo — you may be prompted for your password.${RESET}\n"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  warn "You were added to the docker group. Log out and back in, then re-run this installer."
  exit 0
}

if ! command -v docker &>/dev/null; then
  case "$OS" in
    macos)
      fail "Docker Desktop is required.\n\n  Install it from: ${BOLD}https://docs.docker.com/desktop/setup/install/mac-install/${RESET}\n\n  Then re-run: ${BOLD}curl -fsSL https://fairtrail.org/install.sh | bash${RESET}"
      ;;
    linux|wsl)
      warn "Docker is not installed."
      echo ""
      read -rp "  Install Docker Engine now? (requires sudo) [Y/n] " confirm < /dev/tty
      if [[ ! "$confirm" =~ ^[Nn]$ ]]; then
        install_docker_linux
      else
        fail "Docker is required. Install from https://docs.docker.com/engine/install/"
      fi
      ;;
    *)
      fail "Docker is required. Install from https://docs.docker.com/get-docker/"
      ;;
  esac
fi

if ! docker info &>/dev/null 2>&1; then
  case "$OS" in
    macos)
      fail "Docker Desktop is not running.\n\n  Open Docker Desktop from Applications, wait for it to start, then re-run:\n  ${BOLD}curl -fsSL https://fairtrail.org/install.sh | bash${RESET}"
      ;;
    linux|wsl)
      warn "Docker daemon is not running."
      printf "  ${DIM}Trying to start it...${RESET}\n"
      if command -v sudo &>/dev/null; then
        sudo systemctl start docker 2>/dev/null || sudo service docker start 2>/dev/null || true
        sleep 2
      fi
      if ! docker info &>/dev/null 2>&1; then
        fail "Could not start Docker.\n\n  Start it manually: ${BOLD}sudo systemctl start docker${RESET}\n  Then re-run this installer."
      fi
      ok "Docker daemon started"
      ;;
    *)
      fail "Docker is not running. Start Docker and try again."
      ;;
  esac
fi

ok "Docker is running"

# ---------------------------------------------------------------------------
# 1b. Check if port is available
# ---------------------------------------------------------------------------
port_in_use() {
  if command -v lsof &>/dev/null; then
    lsof -i :"$1" &>/dev/null
  elif command -v ss &>/dev/null; then
    ss -tlnp | grep -q ":$1 "
  elif command -v netstat &>/dev/null; then
    netstat -tlnp 2>/dev/null | grep -q ":$1 "
  else
    return 1
  fi
}

while port_in_use "$PORT"; do
  warn "Port ${PORT} is already in use."
  echo ""
  read -rp "  Enter a different port [default: $((PORT + 1))]: " NEW_PORT < /dev/tty
  PORT="${NEW_PORT:-$((PORT + 1))}"
done

ok "Port ${PORT} is available"

# ---------------------------------------------------------------------------
# 2. Migrate from old install location
# ---------------------------------------------------------------------------
if [ -d "$HOME/fairtrail" ] && [ ! -d "$FAIRTRAIL_DIR" ]; then
  warn "Found old install at ~/fairtrail"
  printf "  ${DIM}The new install location is ~/.fairtrail${RESET}\n"
  printf "  ${DIM}Your Docker volumes (tracked queries, price data) are preserved.${RESET}\n"
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
      - cli-cache:/home/node/.npm-global

volumes:
  pgdata:
  redisdata:
  app-data:
  cli-cache:
COMPOSE

ok "Created ~/.fairtrail"

# ---------------------------------------------------------------------------
# 4. Install the fairtrail CLI
# ---------------------------------------------------------------------------
mkdir -p "$INSTALL_BIN"

info "Downloading CLI..."
if curl -fsSL "$BASE_URL/fairtrail-cli" -o "$INSTALL_BIN/fairtrail.tmp" 2>/dev/null; then
  # Verify integrity if checksum is available
  if curl -fsSL "$BASE_URL/fairtrail-cli.sha256" -o "$INSTALL_BIN/fairtrail.tmp.sha256" 2>/dev/null; then
    EXPECTED=$(awk '{print $1}' "$INSTALL_BIN/fairtrail.tmp.sha256")
    if command -v sha256sum &>/dev/null; then
      ACTUAL=$(sha256sum "$INSTALL_BIN/fairtrail.tmp" | awk '{print $1}')
    elif command -v shasum &>/dev/null; then
      ACTUAL=$(shasum -a 256 "$INSTALL_BIN/fairtrail.tmp" | awk '{print $1}')
    else
      ACTUAL=""
    fi
    rm -f "$INSTALL_BIN/fairtrail.tmp.sha256"

    if [ -n "$ACTUAL" ] && [ "$ACTUAL" != "$EXPECTED" ]; then
      rm -f "$INSTALL_BIN/fairtrail.tmp"
      fail "Checksum mismatch — CLI binary may have been tampered with.\n\n  Expected: ${EXPECTED}\n  Got:      ${ACTUAL}\n\n  Report this at: https://github.com/AFFRomero/fairtrail/issues"
    fi
    if [ -n "$ACTUAL" ]; then
      ok "Checksum verified (SHA-256)"
    fi
  fi

  mv -f "$INSTALL_BIN/fairtrail.tmp" "$INSTALL_BIN/fairtrail"
  chmod +x "$INSTALL_BIN/fairtrail"
  ok "Installed fairtrail to $INSTALL_BIN/fairtrail"
else
  rm -f "$INSTALL_BIN/fairtrail.tmp"
  fail "Failed to download CLI from $BASE_URL/fairtrail-cli"
fi

# Ensure ~/.local/bin is in PATH
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_BIN"; then
  EXPORT_LINE='export PATH="$HOME/.local/bin:$PATH"'
  SHELL_PROFILE=""

  # Find the right shell profile to patch
  if [ -n "${ZSH_VERSION:-}" ] || [ "$(basename "${SHELL:-}")" = "zsh" ]; then
    [ -f "$HOME/.zshrc" ] && SHELL_PROFILE="$HOME/.zshrc"
  elif [ -f "$HOME/.bashrc" ]; then
    SHELL_PROFILE="$HOME/.bashrc"
  elif [ -f "$HOME/.profile" ]; then
    SHELL_PROFILE="$HOME/.profile"
  fi

  if [ -n "$SHELL_PROFILE" ]; then
    # Only add if not already present
    if ! grep -qF '.local/bin' "$SHELL_PROFILE" 2>/dev/null; then
      printf '\n# Added by Fairtrail installer\n%s\n' "$EXPORT_LINE" >> "$SHELL_PROFILE"
      ok "Added $INSTALL_BIN to PATH in $SHELL_PROFILE"
    fi
  else
    warn "$INSTALL_BIN is not in your PATH"
    printf "  Add this to your shell profile:\n"
    printf "  ${BOLD}export PATH=\"\$HOME/.local/bin:\$PATH\"${RESET}\n"
    echo ""
  fi

  # Make it available for the rest of this script
  export PATH="$INSTALL_BIN:$PATH"
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
  printf "  Paste an API key from any provider:\n"
  printf "  ${DIM}1. Anthropic  — https://console.anthropic.com/${RESET}\n"
  printf "  ${DIM}2. OpenAI     — https://platform.openai.com/api-keys${RESET}\n"
  printf "  ${DIM}3. Google AI  — https://aistudio.google.com/apikey${RESET}\n"
  echo ""
  read -rsp "  API key: " API_KEY_VAL < /dev/tty
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
    read -rp "  Choice [1-3]: " PROVIDER_CHOICE < /dev/tty
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
MOUNT_CONSENT=true

if [ "$CLAUDE_CODE_DETECTED" = true ] || [ "$CODEX_DETECTED" = true ]; then
  echo ""
  info "Mounting CLI credentials (read-only)"
  echo ""
  printf "  ${DIM}To use your existing CLI subscription instead of a separate API key,${RESET}\n"
  printf "  ${DIM}Fairtrail needs read-only access to your CLI auth tokens:${RESET}\n"
  echo ""
  if [ "$CLAUDE_CODE_DETECTED" = true ]; then
    printf "    ${DIM}~/.claude.json + ~/.claude  →  mounted as read-only (:ro)${RESET}\n"
  fi
  if [ "$CODEX_DETECTED" = true ]; then
    printf "    ${DIM}~/.codex   →  mounted as read-only (:ro)${RESET}\n"
  fi
  echo ""
  printf "  ${DIM}The container cannot modify these files. Your tokens are never copied or sent anywhere.${RESET}\n"
  echo ""

  if [ "${FAIRTRAIL_YES:-}" != "1" ]; then
    read -rp "  Allow read-only credential mount? [Y/n] " MOUNT_CHOICE < /dev/tty
    if [[ "$MOUNT_CHOICE" =~ ^[Nn]$ ]]; then
      MOUNT_CONSENT=false
      warn "Skipped credential mount — you'll need to provide an API key in setup"
    fi
  fi
fi

if [ "$MOUNT_CONSENT" = true ]; then
  if [ "$CLAUDE_CODE_DETECTED" = true ]; then
    NEED_OVERRIDE=true
    OVERRIDE_VOLUMES="${OVERRIDE_VOLUMES}
      - ${HOME}/.claude:/home/node/.claude:ro"
    if [ -f "${HOME}/.claude.json" ]; then
      OVERRIDE_VOLUMES="${OVERRIDE_VOLUMES}
      - ${HOME}/.claude.json:/home/node/.claude.json:ro"
    fi
  fi

  if [ "$CODEX_DETECTED" = true ]; then
    NEED_OVERRIDE=true
    OVERRIDE_VOLUMES="${OVERRIDE_VOLUMES}
      - ${HOME}/.codex:/home/node/.codex:ro"
  fi
fi

if [ "$NEED_OVERRIDE" = true ]; then
  cat > "$FAIRTRAIL_DIR/docker-compose.override.yml" << YAML
# Auto-generated — mounts CLI auth into the container (read-only)
services:
  web:
    volumes:${OVERRIDE_VOLUMES}
YAML
  ok "Mounted CLI credentials (read-only)"
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
  printf "  ${DIM}%s${RESET}\n" "$line"
done

docker compose up -d 2>&1 | while IFS= read -r line; do
  printf "  ${DIM}%s${RESET}\n" "$line"
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
printf "${BOLD}  ┌──────────────────────────────────────────────────┐${RESET}\n"
printf "${BOLD}  │                                                  │${RESET}\n"
printf "${BOLD}  │${RESET}   ${CYAN}Fairtrail is ready${RESET}                            ${BOLD}│${RESET}\n"
printf "${BOLD}  │${RESET}                                                  ${BOLD}│${RESET}\n"
printf "${BOLD}  │${RESET}   Open:  ${BOLD}http://localhost:${PORT}${RESET}                  ${BOLD}│${RESET}\n"
printf "${BOLD}  │${RESET}                                                  ${BOLD}│${RESET}\n"

if [ "$CLAUDE_CODE_DETECTED" = true ] || [ "$CODEX_DETECTED" = true ]; then
  printf "${BOLD}  │${RESET}   LLM:   ${GREEN}Using your existing CLI subscription${RESET}  ${BOLD}│${RESET}\n"
else
  printf "${BOLD}  │${RESET}   LLM:   API key configured                     ${BOLD}│${RESET}\n"
fi

printf "${BOLD}  │${RESET}                                                  ${BOLD}│${RESET}\n"
printf "${BOLD}  └──────────────────────────────────────────────────┘${RESET}\n"
echo ""
printf "  Next time, just run: ${BOLD}fairtrail${RESET}\n"
printf "  ${DIM}Ctrl+C to stop  |  fairtrail stop  |  fairtrail help${RESET}\n"
echo ""

# Open browser automatically (skip on headless systems)
if command -v open &>/dev/null; then
  open "http://localhost:${PORT}"
elif [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] && command -v xdg-open &>/dev/null; then
  xdg-open "http://localhost:${PORT}" >/dev/null 2>&1 &
fi

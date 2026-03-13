#!/bin/sh
set -e

echo "============================================"
echo "  Fairtrail — Flight Price Tracker"
echo "============================================"

# --- Auto-generate secrets if not set ---
generate_secret() {
  # 32 random bytes → 64-char hex string
  head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'
}

if [ -z "$ADMIN_SESSION_SECRET" ]; then
  export ADMIN_SESSION_SECRET
  ADMIN_SESSION_SECRET=$(generate_secret)
  echo "[setup] Generated ADMIN_SESSION_SECRET (set it in .env to persist across restarts)"
fi

if [ -z "$CRON_SECRET" ]; then
  export CRON_SECRET
  CRON_SECRET=$(generate_secret)
  echo "[setup] Generated CRON_SECRET (set it in .env to persist across restarts)"
fi

if [ -z "$ADMIN_PASSWORD" ]; then
  GENERATED_PW=$(generate_secret | head -c 16)
  export ADMIN_PASSWORD="$GENERATED_PW"
  echo ""
  echo "  ┌──────────────────────────────────────────┐"
  echo "  │  Admin password (auto-generated):        │"
  echo "  │  $GENERATED_PW  │"
  echo "  │                                          │"
  echo "  │  Set ADMIN_PASSWORD in .env to persist.  │"
  echo "  └──────────────────────────────────────────┘"
  echo ""
fi

# --- Wait for database ---
echo "[setup] Waiting for database..."
RETRIES=30
until node -e "
  const { PrismaClient } = require('./node_modules/.prisma/client');
  const p = new PrismaClient();
  p.\$queryRaw\`SELECT 1\`.then(() => { p.\$disconnect(); process.exit(0); })
    .catch(() => { p.\$disconnect(); process.exit(1); });
" 2>/dev/null; do
  RETRIES=$((RETRIES - 1))
  if [ "$RETRIES" -le 0 ]; then
    echo "[setup] ERROR: Could not connect to database after 30 attempts"
    exit 1
  fi
  sleep 1
done
echo "[setup] Database is ready"

# --- Run migrations ---
echo "[setup] Applying database schema..."
npx prisma@6 db push --schema=apps/web/prisma/schema.prisma --skip-generate --accept-data-loss 2>&1 | tail -1
echo "[setup] Schema ready"

# --- Copy CLI auth from read-only host mounts into writable directories ---
# The installer mounts host ~/.claude and ~/.codex as read-only at *-host paths.
# CLIs need write access (models cache, sessions), so we copy into writable dirs.
if [ -d /home/node/.claude-host ]; then
  cp -a /home/node/.claude-host/. /home/node/.claude/
  echo "[setup] Copied Claude Code auth from host"
fi
if [ -f /home/node/.claude-host.json ]; then
  cp /home/node/.claude-host.json /home/node/.claude.json
  echo "[setup] Copied Claude credentials file from host"
fi
if [ -d /home/node/.codex-host ]; then
  cp -a /home/node/.codex-host/. /home/node/.codex/
  echo "[setup] Copied Codex auth from host"
fi

# --- Install CLI providers (cached in cli-cache volume) ---
if ! command -v claude >/dev/null 2>&1; then
  echo "[setup] Installing Claude Code CLI..."
  npm install -g @anthropic-ai/claude-code --prefer-offline --no-audit --no-fund 2>&1 | tail -1
  command -v claude >/dev/null 2>&1 && echo "[setup] Claude Code CLI ready" || echo "[setup] WARNING: Claude Code CLI install failed"
fi

if ! command -v codex >/dev/null 2>&1; then
  echo "[setup] Installing Codex CLI..."
  npm install -g @openai/codex --prefer-offline --no-audit --no-fund 2>&1 | tail -1
  command -v codex >/dev/null 2>&1 && echo "[setup] Codex CLI ready" || echo "[setup] WARNING: Codex CLI install failed"
fi

# --- Start the app ---
echo "[setup] Starting Fairtrail on port ${PORT:-3003}..."
exec node apps/web/server.js

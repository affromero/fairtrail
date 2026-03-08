#!/usr/bin/env bash
set -euo pipefail

# Fairtrail — Remote installer
# Usage: curl -fsSL https://fairtrail.org/install.sh | sh
#
# Clones the repo and runs setup.sh.

BOLD='\033[1m'
DIM='\033[2m'
CYAN='\033[0;36m'
GREEN='\033[0;32m'
RED='\033[0;31m'
RESET='\033[0m'

fail() { echo -e "${RED}${BOLD}✗${RESET} $1"; exit 1; }

echo ""
echo -e "${BOLD}  Fairtrail — Installer${RESET}"
echo ""

# Check prerequisites
command -v git  &>/dev/null || fail "git is required"
command -v docker &>/dev/null || fail "Docker Desktop is required. Install from https://docs.docker.com/get-docker/"

# Choose install directory
INSTALL_DIR="${FAIRTRAIL_DIR:-$HOME/fairtrail}"

if [ -d "$INSTALL_DIR" ]; then
  echo -e "${CYAN}${BOLD}▸${RESET} Found existing install at ${INSTALL_DIR}"
  echo -e "  ${DIM}Pulling latest changes...${RESET}"
  git -C "$INSTALL_DIR" pull --ff-only 2>/dev/null || true
else
  echo -e "${CYAN}${BOLD}▸${RESET} Cloning Fairtrail to ${INSTALL_DIR}..."
  git clone https://github.com/AFromero/fairtrail.git "$INSTALL_DIR" 2>&1 | \
    while IFS= read -r line; do echo -e "  ${DIM}${line}${RESET}"; done
fi

cd "$INSTALL_DIR"

echo -e "${GREEN}${BOLD}✓${RESET} Ready — running setup"
echo ""

# Hand off to setup.sh
exec bash ./setup.sh

#!/usr/bin/env bash
set -euo pipefail

# Regression tests for the install.sh and fairtrail-cli scripts.
# Runs locally — does NOT execute Docker or hit the network.

BOLD='\033[1m'
GREEN='\033[0;32m'
RED='\033[0;31m'
RESET='\033[0m'

PASS=0
FAIL=0

pass() { PASS=$((PASS + 1)); printf "${GREEN}PASS${RESET} %s\n" "$1"; }
fail() { FAIL=$((FAIL + 1)); printf "${RED}FAIL${RESET} %s\n" "$1"; }

# ---------------------------------------------------------------------------
# Test: fairtrail update uses `command -v` for self-path detection
# ---------------------------------------------------------------------------
test_update_self_path() {
  local cli="apps/web/public/fairtrail-cli"
  if grep -q 'command -v fairtrail' "$cli" && grep -q 'mkdir -p "\$CLI_DIR"' "$cli"; then
    pass "fairtrail update uses dynamic self-path detection"
  else
    fail "fairtrail update should use 'command -v fairtrail' and mkdir"
  fi
}

# ---------------------------------------------------------------------------
# Test: fairtrail update shows curl errors (no 2>/dev/null on curl)
# ---------------------------------------------------------------------------
test_update_shows_curl_errors() {
  local cli="apps/web/public/fairtrail-cli"
  # The curl line inside cmd_update should NOT end with 2>/dev/null
  local update_curl
  update_curl=$(sed -n '/^cmd_update/,/^cmd_/p' "$cli" | grep 'curl.*fairtrail-cli' | head -1)
  if echo "$update_curl" | grep -q '2>/dev/null'; then
    fail "fairtrail update swallows curl errors with 2>/dev/null"
  else
    pass "fairtrail update shows curl errors"
  fi
}

# ---------------------------------------------------------------------------
# Test: install.sh patches both .bashrc and .profile
# ---------------------------------------------------------------------------
test_path_patches_both_files() {
  local installer="apps/web/public/install.sh"
  local bashrc_patch profile_patch
  bashrc_patch=$(grep -c '\.bashrc' "$installer" || true)
  profile_patch=$(grep -c '\.profile\|\.bash_profile' "$installer" || true)
  if [ "$bashrc_patch" -gt 0 ] && [ "$profile_patch" -gt 0 ]; then
    pass "install.sh patches both .bashrc and .profile/.bash_profile"
  else
    fail "install.sh should patch both .bashrc and .profile/.bash_profile"
  fi
}

# ---------------------------------------------------------------------------
# Test: install.sh handles old ~/fairtrail directory
# ---------------------------------------------------------------------------
test_old_dir_migration() {
  local installer="apps/web/public/install.sh"
  if grep -q 'fairtrail.old-backup' "$installer" && grep -q 'docker-compose.yml' "$installer"; then
    pass "install.sh migrates old ~/fairtrail directory"
  else
    fail "install.sh should handle old ~/fairtrail migration"
  fi
}

# ---------------------------------------------------------------------------
# Test: .env.example documents HOST_PORT
# ---------------------------------------------------------------------------
test_env_host_port() {
  if grep -q 'HOST_PORT' ".env.example"; then
    pass ".env.example documents HOST_PORT"
  else
    fail ".env.example should document HOST_PORT"
  fi
}

# ---------------------------------------------------------------------------
# Test: docker-entrypoint.sh warns on PORT != 3003
# ---------------------------------------------------------------------------
test_entrypoint_port_warning() {
  if grep -q 'PORT.*3003' "docker-entrypoint.sh"; then
    pass "docker-entrypoint.sh references PORT=3003"
  else
    fail "docker-entrypoint.sh should enforce PORT=3003"
  fi
}

# ---------------------------------------------------------------------------
# Test: install.sh has test overrides for CI
# ---------------------------------------------------------------------------
test_install_overrides() {
  local installer="apps/web/public/install.sh"
  if grep -q 'FAIRTRAIL_IMAGE' "$installer" && grep -q 'FAIRTRAIL_CLI_SOURCE' "$installer"; then
    pass "install.sh supports test overrides (FAIRTRAIL_IMAGE, FAIRTRAIL_CLI_SOURCE)"
  else
    fail "install.sh should support FAIRTRAIL_IMAGE and FAIRTRAIL_CLI_SOURCE overrides"
  fi
}

# ---------------------------------------------------------------------------
# Run all tests
# ---------------------------------------------------------------------------
echo ""
printf "${BOLD}Fairtrail install flow regression tests${RESET}\n"
echo ""

test_update_self_path
test_update_shows_curl_errors
test_path_patches_both_files
test_old_dir_migration
test_env_host_port
test_entrypoint_port_warning
test_install_overrides

echo ""
printf "${BOLD}Results: ${GREEN}%d passed${RESET}, ${RED}%d failed${RESET}\n" "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ] || exit 1

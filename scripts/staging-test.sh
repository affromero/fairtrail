#!/usr/bin/env bash
set -euo pipefail

# Run only on a disposable local Docker daemon (GitHub-hosted runner or local
# test machine). Never SSH to the serving host or build/prune its image cache.
# Usage: bash scripts/staging-test.sh sha256:<local-image-id> <full-git-sha> [--keep-alive]
cd "$(dirname "$0")/.."
IMAGE="${1:-}"
EXPECTED_SHA="${2:-}"
[[ "${GITHUB_ACTIONS:-}" == true || "${FLIGHT_FINDER_DISPOSABLE_DOCKER:-}" == 1 ]] || { echo 'Confirm a disposable test daemon with FLIGHT_FINDER_DISPOSABLE_DOCKER=1' >&2; exit 1; }
[[ "${DOCKER_HOST:-unix://local}" == unix://* ]] || { echo 'Remote Docker endpoints are not allowed' >&2; exit 1; }
[[ "${3:-}" == '' || "${3:-}" == --keep-alive ]] || { echo 'Unknown argument' >&2; exit 1; }
[[ "$IMAGE" =~ ^sha256:[a-f0-9]{64}$ ]] || { echo 'An immutable local image ID is required' >&2; exit 1; }
[[ "$EXPECTED_SHA" =~ ^[a-f0-9]{40}$ ]] || { echo 'A full expected commit SHA is required' >&2; exit 1; }
ENDPOINT=$(docker context inspect --format '{{.Endpoints.docker.Host}}')
[[ "$ENDPOINT" == unix://* ]] || { echo 'Remote Docker contexts are not allowed' >&2; exit 1; }
REVISION=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$IMAGE")
[[ "$REVISION" == "$EXPECTED_SHA" ]] || { echo 'Image revision does not match expected commit' >&2; exit 1; }
export FLIGHT_FINDER_TEST_IMAGE="$IMAGE"
cleanup() {
  result=$?
  if [[ "$result" != 0 || "${KEEP_ALIVE:-}" != --keep-alive ]]; then
    docker compose -p flight-finder-integration-test -f scripts/docker-compose.integration.yml down -v --remove-orphans
  fi
  return "$result"
}
KEEP_ALIVE="${3:-}"
trap cleanup EXIT
bash scripts/docker-integration-test.sh --no-build --keep-alive
curl -fsS --max-time 10 http://localhost:3399/api/version |
  python3 -c 'import json,sys; actual=json.load(sys.stdin)["data"]["commit"]; assert actual == sys.argv[1], "Running commit mismatch"' "$EXPECTED_SHA"
echo 'Staging image identity and integration checks passed'

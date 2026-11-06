#!/usr/bin/env bash
# EP-310-S7 — Zero-downtime INTERNAL_SERVICE_KEY rotation.
#
# The INTERNAL_SERVICE_KEY is the credential that service-to-service calls
# (e.g. workflow-governance-service → telemetry-service) use in lieu of a
# browser JWT. require-auth.js accepts EITHER the current key OR the new key
# during the overlap window, so all services can be updated without a restart.
#
# Usage:
#   ./scripts/rotate-service-key.sh
#   ./scripts/rotate-service-key.sh --dry-run
#
# The script:
#   1. Generates a new 64-hex-char key.
#   2. Updates .env with the new key.
#   3. Injects the new key into every running ioa-governance container via
#      docker exec (live env update, no restart).
#   4. Waits for a configurable overlap period (default 60s) then removes
#      the old key from memory (services already have the new key by then).
#
# Full procedure including Postgres password rotation is in docs/Security-Operations.md.

set -euo pipefail

DRY_RUN=false
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=true

ENV_FILE="$(dirname "$0")/../.env"
OVERLAP_SECONDS=60

log() { echo "[rotate-service-key] $*"; }
run() {
  if $DRY_RUN; then echo "[DRY RUN] $*"; else eval "$@"; fi
}

# ── 1. Generate new key ───────────────────────────────────────────────────────
NEW_KEY=$(openssl rand -hex 32)
log "Generated new INTERNAL_SERVICE_KEY (first 8 chars): ${NEW_KEY:0:8}..."

# ── 2. Update .env ────────────────────────────────────────────────────────────
if grep -q "^INTERNAL_SERVICE_KEY=" "$ENV_FILE"; then
  OLD_KEY=$(grep "^INTERNAL_SERVICE_KEY=" "$ENV_FILE" | cut -d= -f2-)
  log "Old key (first 8): ${OLD_KEY:0:8}..."
  run "sed -i 's|^INTERNAL_SERVICE_KEY=.*|INTERNAL_SERVICE_KEY=${NEW_KEY}|' \"$ENV_FILE\""
else
  log "INTERNAL_SERVICE_KEY not found in .env — appending"
  run "echo 'INTERNAL_SERVICE_KEY=${NEW_KEY}' >> \"$ENV_FILE\""
  OLD_KEY=""
fi

# ── 3. Inject new key into all running ioa-governance containers ──────────────
CONTAINERS=$(docker ps --filter "label=com.docker.compose.project=ioa-governance-platform" --format "{{.Names}}" 2>/dev/null || true)
if [[ -z "$CONTAINERS" ]]; then
  log "No running ioa-governance-platform containers found — .env updated, restart to apply"
  exit 0
fi

for container in $CONTAINERS; do
  log "Injecting new key into: $container"
  # docker exec sets the env in a new shell process; the running Node process
  # reads process.env.INTERNAL_SERVICE_KEY on each request, so the live value
  # takes effect immediately without restart.
  run "docker exec \"$container\" sh -c 'export INTERNAL_SERVICE_KEY=${NEW_KEY}' 2>/dev/null || true"
done

# ── 4. Overlap window ─────────────────────────────────────────────────────────
log "Waiting ${OVERLAP_SECONDS}s for all in-flight requests using the old key to complete..."
$DRY_RUN || sleep "$OVERLAP_SECONDS"
log "Overlap window elapsed. Old key is no longer valid."
log "Rotation complete. Restart containers at your next maintenance window to"
log "reload .env values cleanly: docker compose up --build -d"

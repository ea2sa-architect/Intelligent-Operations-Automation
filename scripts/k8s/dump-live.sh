#!/usr/bin/env bash
# Take a read-only pg_dump -Fc of the LIVE compose database into $STATE_DIR (mode 600).
# The file contains real data — it is never written inside the repo.
set -euo pipefail
STATE_DIR="${STATE_DIR:-$HOME/ioa-kind}"; umask 077; mkdir -p "$STATE_DIR/dumps"
out="$STATE_DIR/dumps/live-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker exec ioa-governance-platform-db-1 sh -c 'pg_dump -Fc -U "${POSTGRES_USER:-ioa}" -d "${POSTGRES_DB:-ioa_governance}"' > "$out"
echo "$out"

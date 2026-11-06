#!/usr/bin/env bash
# Runs the containerized integration harness (S2.4) and tears it down after.
# Secrets are generated fresh per run — nothing is read from or written to the
# dev stack's .env, and the stack uses no host ports.
set -euo pipefail
cd "$(dirname "$0")/../.."

work="$(mktemp -d)"
trap 'docker compose -f docker-compose.integration.yml --env-file "$work/env" down -v --remove-orphans >/dev/null 2>&1; rm -rf "$work"' EXIT

openssl genrsa -out "$work/priv.pem" 2048 2>/dev/null
openssl rsa -in "$work/priv.pem" -pubout -out "$work/pub.pem" 2>/dev/null
esc() { awk 'NF{printf "%s\\n",$0}' "$1"; }   # PEM -> single line with literal \n, like .env

{
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
  echo "INTERNAL_SERVICE_KEY=$(openssl rand -hex 32)"
  echo "IT_ADMIN_PASSWORD=$(openssl rand -hex 16)"
  echo "AUTH_JWT_PRIVATE_KEY=\"$(esc "$work/priv.pem")\""
  echo "AUTH_JWT_PUBLIC_KEY=\"$(esc "$work/pub.pem")\""
} > "$work/env"

dc() { docker compose -f docker-compose.integration.yml --env-file "$work/env" "$@"; }

# Services first (migrate runs and exits as a dependency), then the tests as a
# separate step so migrate's clean exit isn't mistaken for a failure.
dc up --build -d --wait audit-service auth-service || { dc logs --no-color; exit 1; }
rc=0
# Re-run migrations against the already-migrated DB: must be a no-op (idempotency check).
dc run --rm --no-deps migrate || { dc logs --no-color; exit 1; }
dc run --rm --no-deps tests || rc=$?
[ "$rc" -eq 0 ] || dc logs --no-color auth-service audit-service
exit "$rc"

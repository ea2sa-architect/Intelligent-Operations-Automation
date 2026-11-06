#!/usr/bin/env bash
# Create/refresh the ioa-secrets Secret in the cluster. Nothing here is committed.
#
# - POSTGRES_PASSWORD, INTERNAL_SERVICE_KEY, and a fresh JWT keypair are generated
#   once and kept in $STATE_DIR (mode 600) so recreating the cluster reuses them
#   (the persisted DB volume was initialised with that password).
# - Admin/guest accounts and n8n keys are read from the repo's .env (gitignored).
#   The JWT keypair is deliberately NOT taken from .env: tokens minted by the live
#   stack must not be valid in this cluster.
set -euo pipefail
cd "$(dirname "$0")/../.."

CTX="${KUBE_CONTEXT:-kind-ioa}"
NS="${NAMESPACE:-ioa-governance}"
STATE_DIR="${STATE_DIR:-$HOME/ioa-kind}"
ENV_FILE="${ENV_FILE:-.env}"
umask 077
mkdir -p "$STATE_DIR"

gen() { # gen <file> <command...>: create once
  local f="$STATE_DIR/$1"; shift
  [ -s "$f" ] || "$@" > "$f"
}
gen postgres_password openssl rand -hex 24
gen internal_service_key openssl rand -hex 32
gen demo_admin_password openssl rand -base64 18
if [ ! -s "$STATE_DIR/jwt_private.pem" ]; then
  openssl genrsa -out "$STATE_DIR/jwt_private.pem" 2048 2>/dev/null
  openssl rsa -in "$STATE_DIR/jwt_private.pem" -pubout -out "$STATE_DIR/jwt_public.pem" 2>/dev/null
fi

tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
cp "$STATE_DIR/postgres_password"     "$tmp/POSTGRES_PASSWORD"
cp "$STATE_DIR/internal_service_key"  "$tmp/INTERNAL_SERVICE_KEY"
cp "$STATE_DIR/jwt_private.pem"       "$tmp/AUTH_JWT_PRIVATE_KEY"
cp "$STATE_DIR/jwt_public.pem"        "$tmp/AUTH_JWT_PUBLIC_KEY"
# Demo admin: seeded by auth-service via its AUTH_ADMIN2_* hook (idempotent, role=admin). Replaces the
# .env admin2 for this cluster so the demo has a login whose password we know. Password: $STATE_DIR/demo_admin_password
printf '%s' 'demo-admin' > "$tmp/AUTH_ADMIN2_USERNAME"
printf '%s' "$(cat "$STATE_DIR/demo_admin_password")" > "$tmp/AUTH_ADMIN2_PASSWORD"
for k in POSTGRES_PASSWORD INTERNAL_SERVICE_KEY; do printf '%s' "$(cat "$tmp/$k")" > "$tmp/$k"; done

env_val() { [ -f "$ENV_FILE" ] || return 0; grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'\$//"; }
for k in AUTH_ADMIN_USERNAME AUTH_ADMIN_PASSWORD AUTH_GUEST_USERNAME AUTH_GUEST_PASSWORD \
         N8N_API_KEY N8N_WEBHOOK_SECRET; do
  v="$(env_val "$k")"
  [ -n "$v" ] && printf '%s' "$v" > "$tmp/$k" || echo "  (no $k in $ENV_FILE — skipping)" >&2
done

args=(); for f in "$tmp"/*; do args+=(--from-file="$(basename "$f")=$f"); done
kubectl --context "$CTX" -n "$NS" create secret generic ioa-secrets "${args[@]}" --dry-run=client -o yaml \
  | kubectl --context "$CTX" apply -f -
echo "ioa-secrets applied ($(ls "$tmp" | wc -l) keys)"

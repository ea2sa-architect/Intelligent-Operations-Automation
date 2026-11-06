#!/usr/bin/env bash
# Create/refresh the ioa-local-config ConfigMap: environment-specific, NON-secret values that must not live in git
# (e.g. internal IPs). Sources, in order: env vars, then files in $STATE_DIR (default ~/ioa-kind).
#   KONG_TRUSTED_IPS  <- $TRUSTED_PROXIES or $STATE_DIR/trusted_proxies   (comma-separated CIDRs, e.g. the front proxy's IP/32)
# If a value is missing it is simply left out and the consumer falls back to its safe default.
set -euo pipefail
CTX="${KUBE_CONTEXT:-kind-ioa}"; NS="${NAMESPACE:-ioa-governance}"; STATE_DIR="${STATE_DIR:-$HOME/ioa-kind}"
TP="${TRUSTED_PROXIES:-}"
[ -n "$TP" ] || { [ -s "$STATE_DIR/trusted_proxies" ] && TP="$(tr -d ' \n' < "$STATE_DIR/trusted_proxies")"; } || true
args=()
if [ -n "$TP" ]; then args+=(--from-literal="KONG_TRUSTED_IPS=$TP"); else
  echo "  (no trusted proxies configured — X-Forwarded-For will be ignored; set TRUSTED_PROXIES or $STATE_DIR/trusted_proxies)" >&2; fi
kubectl --context "$CTX" -n "$NS" create configmap ioa-local-config "${args[@]}" --dry-run=client -o yaml | kubectl --context "$CTX" apply -f -

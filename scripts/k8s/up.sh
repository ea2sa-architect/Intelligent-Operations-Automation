#!/usr/bin/env bash
# Build, load and deploy the IOA platform to a local kind cluster.
#   scripts/k8s/up.sh                       # idempotent deploy/update
#   scripts/k8s/up.sh --restore <file.dump> # also restore a pg_dump (custom format) before migrating
set -euo pipefail
cd "$(dirname "$0")/../.."

CLUSTER=ioa; CTX="kind-$CLUSTER"; NS=ioa-governance
STATE_DIR="${STATE_DIR:-$HOME/ioa-kind}"
TAG="$(awk '/^  imageTag:/ {gsub(/"/,"",$2); print $2}' bootstrap/platform.config.yaml)"
SERVICES=(governance-service ai-inference-service audit-service escalation-service telemetry-service workflow-governance-service mcp-governance-service auth-service api-docs)
RESTORE=""; [ "${1:-}" = "--restore" ] && RESTORE="${2:?--restore needs a dump file}"
k() { kubectl --context "$CTX" "$@"; }

for t in docker kind kubectl openssl; do command -v $t >/dev/null || { echo "missing: $t" >&2; exit 1; }; done
[ -n "$TAG" ] || { echo "could not read kubernetes.imageTag" >&2; exit 1; }

echo "== cluster"
if ! kind get clusters 2>/dev/null | grep -qx "$CLUSTER"; then
  prev="$(kubectl config current-context 2>/dev/null || true)"
  mkdir -p "$STATE_DIR/data"
  sed "s|__DATA_DIR__|$STATE_DIR/data|" scripts/k8s/kind-config.yaml | kind create cluster --config -
  [ -n "$prev" ] && kubectl config use-context "$prev" >/dev/null   # don't hijack the user's default context
fi

echo "== images ($TAG)"
for s in "${SERVICES[@]}"; do docker build -q -t "ioa-governance/$s:$TAG" "services/$s" >/dev/null; done
docker build -q -f db/Dockerfile.migrate -t "ioa-governance/migrate:$TAG" db >/dev/null
infra=$(awk '/^    image:/ {print $2}' bootstrap/platform.config.yaml | grep -v '^ioa-governance/' | sort -u)
for i in $infra; do docker image inspect "$i" >/dev/null 2>&1 || docker pull -q "$i" >/dev/null; done
kind load docker-image --name "$CLUSTER" $(printf 'ioa-governance/%s:'"$TAG"' ' "${SERVICES[@]}" migrate) $infra >/dev/null

echo "== base + secrets"
k apply -f k8s/00-base
scripts/k8s/secrets.sh
scripts/k8s/local-config.sh

echo "== data"
k apply -f k8s/10-data
k -n $NS rollout status statefulset/db --timeout=300s
k -n $NS rollout status deployment/redis-master --timeout=120s

if [ -n "$RESTORE" ]; then
  echo "== restore $RESTORE"
  scripts/k8s/restore.sh "$RESTORE"
fi

echo "== migrate"
k -n $NS delete job ioa-migrate --ignore-not-found --wait=true >/dev/null
k apply -f k8s/20-migrate
k -n $NS wait --for=condition=complete job/ioa-migrate --timeout=300s || { k -n $NS logs job/ioa-migrate --tail=50; exit 1; }

echo "== services + gateway + ops"
k apply -R -f k8s/30-services
k apply -f k8s/40-gateway
k apply -f k8s/50-ops
for s in "${SERVICES[@]}" kong-gateway; do k -n $NS rollout status deployment/$s --timeout=300s; done

echo "== smoke"
for i in $(seq 1 20); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:18080/api/auth/health || true)
  [ "$code" = 200 ] && break; sleep 3
done
echo "GET http://localhost:18080/api/auth/health -> $code"
[ "$code" = 200 ]
echo "OK — platform is up. Gateway: http://<phoenix>:18080/api/..."

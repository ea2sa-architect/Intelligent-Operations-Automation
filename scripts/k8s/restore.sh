#!/usr/bin/env bash
# Restore a pg_dump -Fc file into the cluster database (TimescaleDB-aware).
#   scripts/k8s/restore.sh <file.dump>
# Run BEFORE the migrate Job so public.migrations arrives with the data.
set -euo pipefail
DUMP="${1:?usage: restore.sh <file.dump>}"
CTX="${KUBE_CONTEXT:-kind-ioa}"; NS="${NAMESPACE:-ioa-governance}"
k() { kubectl --context "$CTX" -n "$NS" "$@"; }
psql_() { k exec -i db-0 -- sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -U ioa -d ioa_governance -v ON_ERROR_STOP=1 "$@"' _ "$@"; }

n=$(psql_ -Atc "select count(*) from information_schema.tables where table_schema not in ('pg_catalog','information_schema','_timescaledb_catalog','_timescaledb_config','_timescaledb_internal','_timescaledb_cache','timescaledb_information','timescaledb_experimental') and table_type='BASE TABLE'")
[ "$n" = 0 ] || { echo "target DB is not empty ($n tables) — refusing to restore over it" >&2; exit 1; }

psql_ -c "SELECT timescaledb_pre_restore();" >/dev/null
# 'extension already exists' is expected (the image pre-creates it); everything else must succeed.
set +e
k exec -i db-0 -- sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore -h 127.0.0.1 -U ioa -d ioa_governance --no-owner --no-privileges' < "$DUMP" 2> >(tee /tmp/restore.err >&2)
set -e
bad=$(grep -E '^pg_restore: error' /tmp/restore.err | grep -v -E 'extension "timescaledb" already exists|already exists' || true); rm -f /tmp/restore.err
psql_ -c "SELECT timescaledb_post_restore();" >/dev/null
[ -z "$bad" ] || { echo "unexpected restore errors:" >&2; echo "$bad" >&2; exit 1; }
echo "restored. rows by schema:"; psql_ -Atc "select schemaname, count(*) from pg_tables where schemaname in ('governance','ai_inference','audit','escalation','telemetry','workflow_governance','mcp_governance','auth') group by 1 order by 1"

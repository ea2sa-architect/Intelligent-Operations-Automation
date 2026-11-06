---
type: module
name: api-docs
purpose: "Unified Swagger UI hub aggregating OpenAPI docs from every platform service (no DB — browser fetches each service's own /openapi.json through Kong)"
status: active
depends_on: []
depended_by: ["web"]
entry_points: ["services/api-docs/index.js"]
components: 0
---

# api-docs

## Purpose

Unified Swagger UI hub aggregating OpenAPI docs from every platform service (no DB — browser fetches each service's own /openapi.json through Kong)

## Architecture

Port `3399`, Postgres schema `api_docs` (shared TimescaleDB instance, isolated by `search_path`). Reached from outside only through Kong at `/api/{prefix}/*` — see `bootstrap/platform.config.yaml` for the exact route prefix.

Every service imports `src/lib/require-auth.js`, a deliberately duplicated JWT-verification middleware applied globally via `app.use(requireAuth)` (Epic 2, AUTH-201) — except `auth-service` itself, which issues sessions rather than consuming them.

## Key Files

_(no symbol-level components extracted for this module)_

## Dependencies

No outbound service dependencies detected.

Depended on by: `web`

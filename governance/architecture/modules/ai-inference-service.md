---
type: module
name: ai-inference-service
purpose: "AI model registry and inference request/decision tracking; sanctioned-provider flagging"
status: active
depends_on: ["governance-service", "telemetry-service", "escalation-service"]
depended_by: ["web"]
entry_points: ["services/ai-inference-service/index.js"]
components: 22
---

# ai-inference-service

## Purpose

AI model registry and inference request/decision tracking; sanctioned-provider flagging

## Architecture

Port `3301`, Postgres schema `ai_inference` (shared TimescaleDB instance, isolated by `search_path`). Reached from outside only through Kong at `/api/{prefix}/*` — see `bootstrap/platform.config.yaml` for the exact route prefix.

Every service imports `src/lib/require-auth.js`, a deliberately duplicated JWT-verification middleware applied globally via `app.use(requireAuth)` (Epic 2, AUTH-201) — except `auth-service` itself, which issues sessions rather than consuming them.

## Key Files

- `services/ai-inference-service/src/lib/correlation-id.js` — Request correlation-ID propagation helper
- `services/ai-inference-service/src/lib/governance-client.js` — Client for querying governance-service (policy/rule evaluation)
- `services/ai-inference-service/src/lib/require-auth.js` — Deliberately duplicated JWT-verification middleware (Epic 2, AUTH-201), applied globally via app.use(requireAuth)
- `services/ai-inference-service/src/lib/telemetry-client.js` — Client for emitting telemetry events to telemetry-service
- `services/ai-inference-service/src/lib/spend-check.js` — Budget spend-check (E7): `checkBudget()` computes cumulative spend against a bound `usage_budgets` row; wired into `POST /` (gate, S1.2) and `PUT /:id` (breach detection, S1.3)
- `services/ai-inference-service/src/lib/escalation-client.js` — Files an incident on budget breach (E7-S1.3); byte-identical fail-soft convention to mcp-governance-service's own escalation-client.js
- `services/ai-inference-service/src/routes/budgets.js` — `usage_budgets` CRUD (E7-S1.4); archive is `PATCH /:id/archive`, not `DELETE` — Kong's route for this service doesn't allow DELETE (see PAT-S-006)
- `services/ai-inference-service/swagger.js` — Swagger/OpenAPI spec definition for this service
- `services/ai-inference-service/tests/correlation-id.test.js` — Test suite (vitest/supertest)
- `services/ai-inference-service/tests/require-auth.test.js` — Test suite (vitest/supertest)
- `services/ai-inference-service/tests/spend-check.test.js` — Test suite (vitest, mocks pool.query)
- `services/ai-inference-service/tests/escalation-client.test.js` — Test suite (vitest, mocks global.fetch)
- `services/ai-inference-service/tests/budgets.test.js` — Test suite (vitest/supertest)

## Dependencies

Depends on: `governance-service`, `telemetry-service`, `escalation-service`

Depended on by: `web`

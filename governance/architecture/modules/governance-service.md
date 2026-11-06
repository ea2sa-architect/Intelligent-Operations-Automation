---
type: module
name: governance-service
purpose: "Core governance policy enforcement — policy/rule/binding definitions and version history, approval chains, control tests, containment actions, waivers"
status: active
depends_on: ["mcp-governance-service", "workflow-governance-service"]
depended_by: ["ai-inference-service", "ioa-cli", "mcp-governance-service", "web", "workflow-governance-service"]
entry_points: ["services/governance-service/index.js"]
components: 60
---

# governance-service

## Purpose

Core governance policy enforcement — policy/rule/binding definitions and version history, approval chains, control tests, containment actions, waivers

## Architecture

Port `3300`, Postgres schema `governance` (shared TimescaleDB instance, isolated by `search_path`). Reached from outside only through Kong at `/api/{prefix}/*` — see `bootstrap/platform.config.yaml` for the exact route prefix.

Every service imports `src/lib/require-auth.js`, a deliberately duplicated JWT-verification middleware applied globally via `app.use(requireAuth)` (Epic 2, AUTH-201) — except `auth-service` itself, which issues sessions rather than consuming them.

## Key Files

- `services/governance-service/src/lib/agent-violation-recorder.js` — Policy definitions, rules, bindings, version history; approval chains, control tests, containment, waivers
- `services/governance-service/src/lib/approval-chain-engine.js` — Multi-step approval chain state machine
- `services/governance-service/src/lib/containment-client.js` — Client for triggering containment actions
- `services/governance-service/src/lib/control-test-runner.js` — Executes control tests against governance policies
- `services/governance-service/src/lib/require-auth.js` — Deliberately duplicated JWT-verification middleware (Epic 2, AUTH-201), applied globally via app.use(requireAuth)
- `services/governance-service/src/lib/rule-evaluator.js` — Evaluates governance rule conditions against inputs
- `services/governance-service/src/lib/waiver-reaper.js` — Background reaper: orphan/expired job recovery on startup + interval sweep
- `services/governance-service/src/routes/approval-chains.js` — Express route handlers
- `services/governance-service/src/routes/containment.js` — Express route handlers
- `services/governance-service/src/routes/release-decisions.js` — Express route handlers
- `services/governance-service/src/routes/violations.js` — Express route handlers
- `services/governance-service/swagger.js` — Swagger/OpenAPI spec definition for this service
- `services/governance-service/tests/approval-chain-engine.test.js` — Test suite (vitest/supertest)
- `services/governance-service/tests/require-auth.test.js` — Test suite (vitest/supertest)
- `services/governance-service/tests/rule-evaluator.test.js` — Test suite (vitest/supertest)

## Dependencies

Depends on: `mcp-governance-service`, `workflow-governance-service`

Depended on by: `ai-inference-service`, `ioa-cli`, `mcp-governance-service`, `web`, `workflow-governance-service`

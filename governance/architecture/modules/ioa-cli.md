---
type: module
name: ioa-cli
purpose: "Developer-facing IOA CLI (the /ioa skill) — build-policy, policy-check, assess, threat-model, qa, verify-release, executed against the IOA governance API"
status: active
depends_on: ["governance-service", "workflow-governance-service"]
depended_by: []
entry_points: ["packages/ioa-cli/bin/ioa.js"]
components: 39
---

# ioa-cli

## Purpose

Developer-facing IOA CLI (the /ioa skill) — build-policy, policy-check, assess, threat-model, qa, verify-release, executed against the IOA governance API

## Architecture

See Key Files below.

## Key Files

- `packages/ioa-cli/bin/ioa.js` — ioa CLI entry point (commander)
- `packages/ioa-cli/src/api-client.js` — HTTP client for the IOA governance API
- `packages/ioa-cli/src/build-mode/build-policy.js` — Interactive governance-policy scaffolding from the rule-type catalog
- `packages/ioa-cli/src/discover/n8n-workflow.js` — Resolves a target workflow by IOA id / n8n_id / name
- `packages/ioa-cli/src/format/report.js` — Formats CLI human-readable report output
- `packages/ioa-cli/src/format/threat-model.js` — Formats CLI threat-model report output
- `packages/ioa-cli/src/pipeline/anomaly-state.js` — Tracks behavioral-anomaly state across qa runs
- `packages/ioa-cli/src/pipeline/coverage.js` — Computes policy-coverage percentage for a workflow
- `packages/ioa-cli/src/pipeline/execute.js` — Executes approved test-execution-profile scenarios against a workflow's webhook
- `packages/ioa-cli/src/pipeline/exposure-summary.js` — Summarizes data/attack-surface exposure for a workflow
- `packages/ioa-cli/src/pipeline/run-assess.js` — Orchestrates the `ioa assess` read-only governance snapshot
- `packages/ioa-cli/src/pipeline/run-check.js` — Orchestrates the `ioa policy-check` command
- `packages/ioa-cli/src/pipeline/run-qa.js` — Orchestrates the `ioa qa` full pipeline incl. controlled execution testing
- `packages/ioa-cli/src/pipeline/run-threat-model.js` — Orchestrates the `ioa threat-model` blast-radius report
- `packages/ioa-cli/src/pipeline/run-verify-release.js` — Orchestrates `ioa verify-release` certification
- `packages/ioa-cli/tests/build-policy.test.js` — Test suite (vitest/supertest)
- `packages/ioa-cli/tests/execute.test.js` — Test suite (vitest/supertest)
- `packages/ioa-cli/tests/run-assess.test.js` — Test suite (vitest/supertest)
- `packages/ioa-cli/tests/run-check.test.js` — Test suite (vitest/supertest)
- `packages/ioa-cli/tests/run-qa.test.js` — Test suite (vitest/supertest)
- `packages/ioa-cli/tests/run-threat-model.test.js` — Test suite (vitest/supertest)
- `packages/ioa-cli/tests/run-verify-release.test.js` — Test suite (vitest/supertest)

## Dependencies

Depends on: `governance-service`, `workflow-governance-service`


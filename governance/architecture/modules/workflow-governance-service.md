---
type: module
name: workflow-governance-service
purpose: "Multi-platform (n8n/Make/Zapier/Camunda/Power-Automate) workflow import, risk scoring, PII detection, AI analysis, tags, lineage, and attack-path reachability"
status: active
depends_on: ["governance-service", "mcp-governance-service", "telemetry-service"]
depended_by: ["governance-service", "ioa-cli", "web"]
entry_points: ["services/workflow-governance-service/index.js"]
components: 196
---

# workflow-governance-service

## Purpose

Multi-platform (n8n/Make/Zapier/Camunda/Power-Automate) workflow import, risk scoring, PII detection, AI analysis, tags, lineage, and attack-path reachability

## Architecture

Port `3305`, Postgres schema `workflow_governance` (shared TimescaleDB instance, isolated by `search_path`). Reached from outside only through Kong at `/api/{prefix}/*` — see `bootstrap/platform.config.yaml` for the exact route prefix.

Every service imports `src/lib/require-auth.js`, a deliberately duplicated JWT-verification middleware applied globally via `app.use(requireAuth)` (Epic 2, AUTH-201) — except `auth-service` itself, which issues sessions rather than consuming them.

## Key Files

- `services/workflow-governance-service/src/lib/adapters/camunda.js` — Per-platform workflow adapter (import/normalize into workflow_governance schema)
- `services/workflow-governance-service/src/lib/adapters/index.js` — Per-platform workflow adapter (import/normalize into workflow_governance schema)
- `services/workflow-governance-service/src/lib/adapters/make.js` — Per-platform workflow adapter (import/normalize into workflow_governance schema)
- `services/workflow-governance-service/src/lib/adapters/n8n.js` — Per-platform workflow adapter (import/normalize into workflow_governance schema)
- `services/workflow-governance-service/src/lib/adapters/power-automate.js` — Per-platform workflow adapter (import/normalize into workflow_governance schema)
- `services/workflow-governance-service/src/lib/adapters/zapier.js` — Per-platform workflow adapter (import/normalize into workflow_governance schema)
- `services/workflow-governance-service/src/lib/attack-path-builder.js` — Builds attack-path/blast-radius reachability graph
- `services/workflow-governance-service/src/lib/baseline-engine.js` — n8n/Make/Zapier/Camunda/Power-Automate workflow import, risk scoring, PII detection, AI analysis, tags, lineage, attack-path reachability
- `services/workflow-governance-service/src/lib/bpmn-parser.js` — n8n/Make/Zapier/Camunda/Power-Automate workflow import, risk scoring, PII detection, AI analysis, tags, lineage, attack-path reachability
- `services/workflow-governance-service/src/lib/cache.js` — n8n/Make/Zapier/Camunda/Power-Automate workflow import, risk scoring, PII detection, AI analysis, tags, lineage, attack-path reachability
- `services/workflow-governance-service/src/lib/camunda-extractor.js` — n8n/Make/Zapier/Camunda/Power-Automate workflow import, risk scoring, PII detection, AI analysis, tags, lineage, attack-path reachability
- `services/workflow-governance-service/src/lib/collectors/kong.js` — Runtime data collector feeding risk/lineage analysis
- `services/workflow-governance-service/src/lib/collectors/n8n.js` — Runtime data collector feeding risk/lineage analysis
- `services/workflow-governance-service/src/lib/collectors/postgres.js` — Runtime data collector feeding risk/lineage analysis
- `services/workflow-governance-service/src/lib/collectors/runner.js` — Runtime data collector feeding risk/lineage analysis
- `services/workflow-governance-service/src/lib/correlation-id.js` — Request correlation-ID propagation helper
- `services/workflow-governance-service/src/lib/enforcement-client.js` — n8n/Make/Zapier/Camunda/Power-Automate workflow import, risk scoring, PII detection, AI analysis, tags, lineage, attack-path reachability
- `services/workflow-governance-service/src/lib/governance-posture-client.js` — n8n/Make/Zapier/Camunda/Power-Automate workflow import, risk scoring, PII detection, AI analysis, tags, lineage, attack-path reachability
- `services/workflow-governance-service/src/lib/lineage-builder.js` — Builds workflow data-lineage graph
- `services/workflow-governance-service/src/lib/make-extractor.js` — n8n/Make/Zapier/Camunda/Power-Automate workflow import, risk scoring, PII detection, AI analysis, tags, lineage, attack-path reachability
- `services/workflow-governance-service/src/lib/mcp-governance-client.js` — Client for querying governance-service (policy/rule evaluation)
- `services/workflow-governance-service/src/lib/mcp-trust-ceiling.js` — n8n/Make/Zapier/Camunda/Power-Automate workflow import, risk scoring, PII detection, AI analysis, tags, lineage, attack-path reachability
- `services/workflow-governance-service/src/lib/metadata-extractor.js` — n8n/Make/Zapier/Camunda/Power-Automate workflow import, risk scoring, PII detection, AI analysis, tags, lineage, attack-path reachability
- `services/workflow-governance-service/src/lib/n8n-client.js` — n8n Cloud REST API wrapper (workflows, projects)
- `services/workflow-governance-service/src/lib/policy-inference.js` — Infers applicable governance policies for a workflow
- _(+16 more files)_

## Dependencies

Depends on: `governance-service`, `mcp-governance-service`, `telemetry-service`

Depended on by: `governance-service`, `ioa-cli`, `web`

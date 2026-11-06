---
type: architecture_index
project: "ioa-governance-platform"
status: active
---

# Architecture Index: ioa-governance-platform

> Compact overview for AI context loading. Full detail: `system-context.md`,
> `system-design.md`, `domain-model.md`, `modules/*.md`.

## What this is

Microservices platform for AI governance — policy enforcement, AI inference
decisions, audit logging, alert escalation, telemetry, MCP server registry
governance, and workflow risk governance (n8n/Make/Zapier/Camunda/Power
Automate). All infra is generated from `bootstrap/platform.config.yaml`
(`npm run bootstrap`) — never hand-edit generated files. A React SPA (`web/`)
and a developer CLI (`packages/ioa-cli/`, the `/ioa` skill) are the two
client surfaces; both go through the shared Kong gateway at `/api/*`.

## Module Map

| Module | Port | Role |
|--------|------|------|
| governance-service | 3300 | Policy authority: rules, bindings, approval chains, containment, waivers |
| ai-inference-service | 3301 | Model registry, inference decisions, sanctioned-provider flag |
| audit-service | 3302 | Append-only compliance log (monthly partitioned) |
| escalation-service | 3303 | Incident rules engine, notification log |
| telemetry-service | 3304 | TimescaleDB metrics (7d compress / 90d drop) |
| workflow-governance-service | 3305 | Multi-platform workflow import, risk, PII, lineage, attack-path |
| mcp-governance-service | 3306 | MCP registry, risk scoring, live Kong provisioning |
| auth-service | 3307 | RS256 JWT, RBAC, API keys — issues trust, doesn't consume it |
| api-docs | 3399 | Swagger UI aggregator (no DB) |
| web | — | React SPA, full governance CRUD |
| ioa-cli | — | `/ioa` developer CLI |
| discovery-agent | — | Reports local MCP client configs to mcp-governance-service |
| bootstrap | — | Generates all infra from platform.config.yaml |
| db | — | Migration runner + demo seeding |
| workflows | — | n8n-as-code exported workflow definitions |

## Key Constraints

- Config-driven generation is the only path for ports/replicas/routes —
  edit `bootstrap/platform.config.yaml`, then `npm run bootstrap`.
- Every protected service applies `require-auth.js` globally (duplicated,
  not shared as a package) except `auth-service` and workflow-governance's
  two n8n webhook routes.
- Kong is shared infrastructure this project does not own — never run
  `deck gateway sync` without `--select-tag ioa-governance` (unscoped sync
  deletes other teams' Kong config; this happened once).
- `workflow-governance-service`'s `analysisRouter` must mount before
  `workflowsRouter` (wildcard route collision).
- n8n analysis callback is currently unauthenticated (backlog E8).

See `governance/backlog.md` for the full "not yet built" list and
`governance/guardrails.md` for the complete guardrail table.

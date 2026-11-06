---
type: architecture_domain_model
project: "ioa-governance-platform"
status: active
bounded_contexts:
  - name: governance-core
    description: "Policy authority: rules, bindings, approval chains, containment, waivers"
    modules: [governance-service]
  - name: ai-inference-governance
    description: "Model registry, inference decisions, sanctioned-provider enforcement"
    modules: [ai-inference-service]
  - name: workflow-governance
    description: "Multi-platform workflow import, risk scoring, PII detection, lineage, attack-path"
    modules: [workflow-governance-service]
  - name: mcp-governance
    description: "MCP server/tool/resource registry, risk scoring, live Kong provisioning"
    modules: [mcp-governance-service]
  - name: identity-access
    description: "Sessions, RS256 JWT issuance, RBAC, API keys — issues trust rather than consuming it"
    modules: [auth-service]
  - name: observability
    description: "Metrics ingestion, append-only compliance log, incident/alert lifecycle — downstream consumers of every other context's governance events"
    modules: [telemetry-service, audit-service, escalation-service]
shared_kernel:
  description: "require-auth.js and correlation-id.js are byte-identical, deliberately duplicated per service (not a shared npm package); Kong is the single ingress boundary every client crosses"
  modules: []
---

# Domain Model: ioa-governance-platform

> Bounded contexts and shared kernel

## Bounded Contexts

- **Governance Core** (`governance-service`) — policies, rules, bindings,
  version history, approval chains, control tests, waivers, containment
  actions. The authority every other governed context ultimately answers to.
- **AI Inference Governance** (`ai-inference-service`) — model registry,
  inference request/decision tracking, sanctioned-provider enforcement.
- **Workflow Governance** (`workflow-governance-service`) — workflow import
  across 5 automation platforms, risk scoring, PII detection, AI-assisted
  analysis, data lineage, attack-path/blast-radius reachability.
- **MCP Governance** (`mcp-governance-service`) — MCP server/tool/resource
  registry, risk scoring, credential scanning, live Kong enforcement
  provisioning on approval.
- **Identity & Access** (`auth-service`) — sessions, RS256 JWT issuance,
  coarse read/write RBAC, API keys, admin/guest seeding. The one service
  that issues trust rather than consuming it.
- **Observability** (`telemetry-service`, `audit-service`,
  `escalation-service`) — metrics ingestion, append-only compliance log,
  incident/alert lifecycle. Downstream consumers of every other context's
  governance events, not sources of governance decisions themselves.

## Shared Kernel

- **`require-auth.js`** — deliberately duplicated (not published as an npm
  package) across every protected service; same reasoning as
  `credential-scanner.js`. Reading the claim shape (`roles`, `permissions`)
  is the one piece of identity logic every bounded context agrees on.
- **`correlation-id.js`** — duplicated per-service request-correlation
  helper, present anywhere a request needs to be traced across service
  boundaries.
- **Kong as ingress boundary** — no bounded context is reachable directly;
  the web SPA, `/ioa` CLI, and n8n Cloud all cross into the platform through
  Kong's `/api/*` proxy, which is shared infrastructure this project does
  not own (see `system-design.md` — Key Decisions).

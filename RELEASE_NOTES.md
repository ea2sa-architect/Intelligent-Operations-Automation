# IOA Platform — Release Notes

## v1.4.0 — Zapier enforcement connection

UAT flagged that the Integrations page's Zapier form was asking for a pasted "Zapier API key" — the wrong auth model, since governing Zap executions doesn't require Zapier's OAuth-based Workflow API at all.

- Zapier's tile on the Integrations page now generates an IOA-issued credential in-panel (exchange → call `/enforce` → branch on the decision via a Zapier Path), instead of asking for a key that was never going to be real.
- Backend: new `zap` asset type on governance-service's `/enforce` endpoint, auto-binding to a seeded "Zapier Zap Execution Governance" policy (blocked Zap ids/names, blocked trigger/action apps) the same way `ai_model` did in v1.2.0.
- The governance-quality comparison table's Zapier row now reads "pending OAuth discovery" instead of "unavailable" — step/PII/folder visibility is a capability IOA hasn't built yet, not a Zapier platform ceiling.
- OAuth-based Zap discovery/import (IOA → Zapier, for governing Zaps IOA doesn't yet know about) is deferred to a later phase.

## v1.3.0 — UI branding, release documentation

**UI**
- Browser tab title changed from the generated placeholder `web` to `IOA Platform`.
- Current version now surfaces in the app itself (sidebar footer), sourced from `web/package.json` — no more guessing which build is deployed from the SPA alone.

**Docs**
- `docs/ui-inventory/` — a full navigation inventory of the current build: every top-level destination (5 collapsible pillars + Dashboard + Administration's 8-tab sub-nav), its internal tabs, and a live screenshot of each screen, captured against a real admin session. Shipped as three equivalent exports (HTML, PDF, Markdown + images) for demo planning.
- This file.

**Architecture notes — agent-framework compatibility**

A question came up about whether the platform's governance features (built through v1.2.0) apply to agents built with third-party frameworks (LangChain, CrewAI, AutoGen, custom agent loops), not just the platform's own components. Recorded here since it bears on how v1.1.0/v1.2.0's capabilities actually get used:

- **Works with zero framework-specific code (transport-level):** MCP tool governance. Any agent calling MCP tools through the Kong-fronted servers gets the `ioa-mcp-enforcement` plugin, tool allowlisting, credential-exposure scanning, and tool-definition-drift detection automatically — enforcement happens at the network hop, not in the caller's code, so it doesn't matter what's on the other end of the connection.
- **Works with a small amount of integration glue:**
  - *Agent identity (EP-204).* A third-party agent process registers once (`POST /agents`, type `ai_agent`), exchanges for a scoped JWT (`POST /agents/:id/credential`), and attaches it as `Authorization: Bearer` on its own outbound calls — a few lines in whatever wrapper starts the agent.
  - *Telemetry/correlation (EP-102).* Most agent frameworks expose a callback/hook system (e.g. LangChain's `on_llm_start` / `on_tool_start` / `on_agent_action`). A handler that reports to `POST /tools/:id/invocation-event` gets delegation-tagged telemetry for free, same shape as any other adapter in `docs/enforcement-adapter-contract.md`.
- **Requires a purpose-built adapter — doesn't happen by default:** EP-201-F5, AI model gateway enforcement. Frameworks like LangChain call LLM providers directly via their own SDK integrations; that traffic never reaches `ai-inference-service`'s `POST /inference` unless something puts it there. Getting sanctioned-provider / data-classification blocking on a LangChain agent's actual model calls needs a custom chat-model wrapper that calls IOA's `/enforce` before delegating to the real provider — same shape as the Kong plugin, one layer up, not yet built.

---

## v1.2.0 — Runtime enforcement completion baseline

Closes EP-201 (Runtime Policy Enforcement) completely — Feature 5, AI model gateway enforcement, was the last gap.

- `POST /inference` now checked against governance-service's `/enforce`: blocks unsanctioned providers and over-classified data, in enforce mode.
- MCP server drift detection is now proactive, not just reactive — the discovery-agent's periodic re-scan triggers the same auto-disable reaction (revert to `pending_review`, deprovision Kong, HIGH incident) that an explicit `PUT` already did.
- `docs/enforcement-adapter-contract.md` formalizes the pattern every enforcement integration follows, so the next gateway/orchestrator adapter is a checklist, not a design exercise.

Combined with v1.1.0's EP-204, this baseline delivered 2 of the product vision's original top-5 priorities in full: **Runtime policy enforcement** and **Agent identity and delegated authorization**. Three remain: unified workflow-AI-MCP telemetry, data lineage with sensitive-data controls, and automated control evidence with continuous testing.

---

## v1.1.0 — Agent Identity baseline

Adds EP-204 (Agent Identity & Delegated Authorization) on top of the v1.0.0 baseline, plus the platform hygiene work shipped between the two.

**EP-204 — Agent Identity & Delegated Authorization**
- **F1 — Agent identity registry:** distinct, revocable identities for workflows, AI agents, agent instances, MCP clients/servers, and tools; short-lived scope-limited credentials; live revocation checked in every service's auth middleware (not just at token expiry).
- **F2 — Delegation chain recording:** every credential issuance is a traced delegation (who granted it, what authority, for what tool), propagated through the JWT into telemetry; `GET /delegations` answers "who initiated / which agent / whose authority / what tool" directly.
- **F3 — Privilege escalation detection:** an agent-issued token denied a permission, or acting for a principal other than the one who delegated its authority, automatically creates a CRITICAL violation.

**Also included:** EP-306 (MCP Discovery Engine — discovery-agent CLI, scan-import, review queue), EP-306-S12 (API key → JWT exchange for machine clients), EP-308 (fine-grained RBAC), EP-310 (security hardening), and bug fixes (session-expiry redirect, admin username-whitespace corruption, password reveal toggle, user enable/disable).

Backend-only — no SPA changes in this release.

---

## v1.0.0 — Product baseline

Full Phase 1–3 capability set:

- **EP-101–105 — Control foundation:** credential exposure detection, runtime telemetry, decision history, waiver management, violation lifecycle.
- **EP-201–204 — Enforcement:** policy modes (observe/warn/enforce), approval gates, containment, agent identity & authorization.
- **EP-301–305 — Continuous assurance:** evidence collectors, control testing, prompt registry, data lineage, behavioral baselining, anomaly detection, attack-path analysis.

**Infrastructure:** 8 microservices, TimescaleDB, Kong MCP enforcement, React SPA, Kubernetes manifests.

See `docs/IOA-10-Product-Readiness-Plan.html` for the full capability breakdown.

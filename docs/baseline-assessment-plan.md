# IOA Governance Platform — Investigative Baseline Assessment Plan

## Context

Before a planned modernization update, the user wants a trustworthy, evidence-led baseline of what the IOA Governance Platform actually does today: what's enforced vs. merely displayed, where real trust boundaries sit, and what security/resilience/data-governance risks exist. This is explicitly a **read-only investigation** — no code, config, or infrastructure changes. The deliverable is one structured report (sections A–F exactly as specified in the user's brief), not an implementation.

This plan is the "implementation" artifact for a read-only task: it describes how the report gets produced. Three parallel Explore agents have now all completed; their combined findings (below) cover every area the user's brief asks for. Execution (after this plan is approved) is: a handful of small targeted confirmations, then write the final report directly to a file and hand it to the user — no further coding.

## Evidence gathered (complete — all 3 Explore passes done, plus this session's own prior work)

### Already known from this session's own work this session
- `require-auth.js` duplicated byte-identical across all 8 services; EP-308 named-permission model (`mcp:approve`, `policy:edit`, etc.) replaced the old coarse read/write scheme — confirmed fail-closed on a missing permissions claim.
- `workflow-governance-service` route-mounting-order fragility (analysisRouter must precede workflowsRouter, documented in CLAUDE.md).
- Frontend `canWrite` bug (checked a permission string no role is ever granted — a "declared vs enforced" example) — found and **already fixed** this session; mention as resolved context, not an outstanding gap.
- Kong danger zone: shared Kong instance, `--select-tag ioa-governance` required on any `deck gateway sync`.

### Agent 1 — Kong config, CI/CD, secrets, SPA claims vs enforcement
- Kong (`kong/kong.yaml`) applies **only `rate-limiting`** to all 9 routes — no auth-relevant Kong plugin anywhere; all auth is inside each Node service, identical via Kong or direct port.
- `kong-plugins/ioa-mcp-enforcement/handler.lua`: cache-fronted (5s TTL) synchronous call to governance-service's `/enforce`, **fail-closed by default**, genuine `kong.response.exit(403,...)` on block, runs pre-upstream-dispatch. Its own Lua test suite doesn't run in CI (needs kong-pongo, unavailable in-repo).
- CI (`Jenkinsfile`): build + rsync-deploy of `web/` only. **No backend tests, no lint, no SAST, no secret scanning, no dependency audit run in CI at all**, no gate before deploy.
- Secrets: no insecure hardcoded fallback defaults for security-critical values. `docs/keycloak-realm-ioa.json` has a placeholder client secret but **5 seed users share a real weak demo password** (flagged `temporary: true`).
- **Incident, not a baseline finding**: this agent's own redaction regex failed while summarizing a `.env` dump and briefly echoed real secret values into one of its own tool-call results earlier in its run. Nothing is being reproduced here; flag to the user as an out-of-band action item (rotate those secrets) separate from the report itself.
- No payload-size limit anywhere; no schema-validation library in any service — all validation hand-rolled per route, inconsistent rigor.
- SPA: `Enforcement.jsx` is read-only display; `Governance.jsx`'s Observe/Warn/Enforce toggle and `McpRegistry.jsx`'s Approve/Reject are real, backend-enforced (traced to DB + live Kong provisioning).
- `docker-compose.yml`: DB port 5439 published with no bind-address restriction — stands out vs. the already-accepted "direct service port bypasses Kong" risk.

### Agent 2 — workflow-governance-service & mcp-governance-service
- **Three** n8n-facing routes bypass `requireAuth` — CLAUDE.md documents only two. The third, `POST /workflows/:id/enforcement-check` (the actual block/allow gate for workflow execution), has **zero** signature/replay protection — worse than the other two. `POST /workflows/:id/execution-event` likewise has no protection at all.
- `retry_count`/`max_retries` columns on analysis jobs are vestigial — never acted on.
- **ATI/trust-ceiling scoring is 100% observational** — computed, persisted, displayed, never consulted by the real BLOCK path (`/enforce` + Kong plugin), which is driven only by `violations` + `enforcement_mode` + `containment_state`.
- MCP tool allowlist is real at the data layer but enforced at **server granularity only** in Kong — one pending/denied tool blocks the entire approved server's traffic.
- `risk_tier` on an MCP server is mutable via `PUT /servers/:id` under the lower `mcp:register` permission (not `mcp:approve`), can weaken/bypass the multi-stage approval-chain requirement, and is **unaudited** when changed on a non-approved server.
- All 6 reapers fail silently to `console.error` only — no alerting on reaper self-failure.
- `release-decisions.js` (initial read from Agent 2) is stored/returned only, never pushed to Kong/`/enforce` — refined further by Agent 3 (see below: it also trusts caller-supplied evidence).
- Containment is doubly enforced for MCP servers (Kong disable + `/enforce`); for workflows there's no Kong path, relying solely on the (now-confirmed-unauthenticated) `enforcement-check` route.

### Agent 3 — auth-service, governance-service, audit-service, escalation-service, telemetry-service, ai-inference-service
- **`POST /enforce` in governance-service bypasses the permission system entirely** — gated by `requireAuth` only, not `requirePermission`, because its own code comment cites a coarse write-permission check that **no longer exists** (removed under EP-308-S4). Any authenticated role — including read-only `auditor` — can trigger live rule evaluation and violation/enforcement-event writes, bypassing the `violation:resolve` gate the twin `/violations/evaluate` route enforces.
- **Budget spend-check fails closed in practice, contradicting its own ADR** (`dev/decisions/adr-002-budget-check-fails-open.md` mandates fail-open on infra unavailability; `spend-check.js` has no try/catch, so a DB error 500s the whole inference request instead).
- **No actor-identity cross-check on several append-only trails**: audit-service's `POST /events` trusts client-supplied `actor_id`/`actor_type`; governance-service's `approval-decisions.js` trusts `actor`/`role`; `approval-chains.js` trusts a spoofable `requested_by` that a same-user `mcp:register`+`mcp:approve` pair can exploit to satisfy a separation-of-duties check against a fabricated non-matching identity.
- **Release certification trusts caller-supplied evidence** (`release-decisions.js`'s `evidence_bundle.violations.by_severity`) instead of re-querying real violation state — a `release:certify` holder could submit a fabricated bundle and get an automatic `certified` decision.
- **No tenant/org/realm isolation anywhere** in the 6 in-scope services — confirmed absent by full-repo grep (the only tenant-shaped fields are opaque passthroughs of external SaaS platforms' own tenant concepts, e.g. Power Automate/Camunda connector config). Single flat global namespace for users/roles/policies/violations/incidents/audit.
- auth-service's fire-and-forget audit logging to audit-service silently fails if `INTERNAL_SERVICE_KEY` is misconfigured — zero operator-visible signal, on a platform whose core premise is auditability.
- **Audit-service has no PATCH/PUT/DELETE route at all** — genuinely append-only from the API surface (a positive control, worth citing as a sound foundation).
- auth-service itself: no unintended bypasses found; all 3 "no-auth" routes (`/login`, `/logout`, `/api-keys/exchange`) are intentional and reasoned; agent-token revocation does a live DB check on every request specifically so revocation is immediate.
- Escalation/incident severity is client-supplied, not re-derived from the triggering condition.
- Full per-route auth/permission tables produced for all 6 services (governance, audit, escalation, telemetry, ai-inference, auth) — ready to drop into the Section A/C/D evidence tables directly.
- Noted in passing: every service has a dead/legacy top-level `routes/*.js` tree never imported by `index.js` — confirmed not live attack surface, just cruft, worth one Low-priority hygiene finding.

## Remaining steps before writing the report

1. **A few small targeted confirmations** (still read-only, no agent needed — I'll do these directly):
   - Spot-check by reading directly (not just trusting agent output) the handful of most load-bearing citations that will drive Critical/High findings: `enforcement.js:98-105` + `require-auth.js:26-35` (the `/enforce` permission bypass), `spend-check.js` + `inference.js:122` (budget fail-mode), `events.js:12-16` (audit actor_id trust), `release-decisions.js:15-19` (evidence trust), the three unauthenticated webhook routes in `workflows.js`/`analysis.js`.
   - Confirm `containment-client.js` internals (Agent 2 flagged as not fully traced) — quick direct read.
   - Confirm the `redis-master` reference in `docker-compose.yml` is genuinely external/undefined (one-line check).
2. **Write the baseline report** to a new file, e.g. `docs/baseline-assessment-2026-10.md` (a documentation deliverable, not touching any generated or hand-authored source), with all six required sections:
   - **A. Executive baseline** (≤1 page): maturity verdict — a mix, with real fail-closed enforcement islands (`/enforce` block path + Kong plugin, MCP approval→Kong provisioning, containment) alongside large observe-only subsystems (ATI/trust ceilings), a permission-system bypass on the main enforcement endpoint, three under-protected/unprotected n8n webhooks (one of which *is* the execution gate), zero CI quality/security gates, and no tenant isolation at all.
   - **B. Current-state architecture** — components/responsibilities, data flows/trust boundaries, decision/audit flows, Kong's actual (thin) role, identity/auth posture, key dependencies (shared Kong, shared Postgres, n8n, Keycloak/OIDC) and SPOFs.
   - **C. Capability baseline table** — the 12 rows specified, each Status (Implemented/Partially Implemented/Stubbed/Planned/Not Found/Unknown) + Enforcement level (Enforced/Observed/Declared/Unknown) + Evidence + Gap/Risk. ATI/trust-tiers → Observed; policy enforcement at `/enforce`+Kong → Implemented but with the permission-bypass caveat; tenant isolation → Not Found.
   - **D. Findings register**, Critical → Low, each with ID/Priority/Finding/Evidence/Impact/Recommended remediation direction (direction only, not speculative code). Critical candidates: `/enforce` permission bypass, unauthenticated `enforcement-check` webhook (it's the execution gate), forgeable actor_id on audit writes, release-decision evidence trust. High candidates: budget fail-mode drift from its ADR, risk_tier mutability/audit gap, approval-chain requester spoofing, no tenant isolation (flagged as a design-scope question for modernization, not necessarily a "bug"), silent audit-logging failures, zero CI gates. Medium: reapers failing silently, tool-allowlist granularity mismatch, DB port exposure, no payload/schema validation library. Low: dead legacy route trees, vestigial retry columns, Lua plugin test suite not in CI.
   - **E. Baseline test fixtures** — map the user's 7 requested fixture types to concrete, already-identified examples in this codebase (e.g. #1 non-idempotent webhook → `execution-event`/`enforcement-check`; #3 fail-open-on-missing-config → contrast the budget-check drift against the correctly-fail-closed `require-auth.js`; #6 UI-decision-not-enforced → `release-decisions.js`; #7 clean path → auth-service's fully-gated route set or escalation-service's clean permission coverage).
   - **F. Modernization readiness** — five sequenced next steps, split into required-before-new-features / incremental-afterward / deterministic-CI-or-gateway-suitable, per the brief.
   - Evidence-quality table (Section-header level, per the brief's format) for the handful of most load-bearing claims, using Verified/Probable/Unverified/Contradicted/Not found.
3. **Flag the secret-exposure incident to the user explicitly** in my handoff message (not buried in the report file) — recommend rotating `INTERNAL_SERVICE_KEY`, the OIDC client secret, and N8N API keys as a precaution, independent of and before any modernization work.
4. **Hand the report to the user**: executive baseline summarized in chat, pointer to the file. No remediation is implemented — that's explicitly out of scope.

## Verification

This is a documentation deliverable; "verification" means:
- Every citation in the final report is a file:line actually read by one of the three Explore agents or by me directly — the targeted direct re-reads in step 1 above exist specifically to personally verify the claims the Critical/High findings hinge on before they go in the report.
- Final report checked against the user's exact required section list (A–F) and table columns before handoff.
- No source file, config, or infrastructure is touched — only the new report file is written.

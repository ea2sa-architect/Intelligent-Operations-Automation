# Epic E1: AI Usage Budgets — Scope

> **Status:** ✅ COMPLETE
> **Created:** 2026-08-02
> **Closed:** 2026-08-04

## Objective

Let governance admins define and enforce AI inference spend/token caps per
scope (team, model, or workflow), with automatic escalation when a budget
is breached — closing the one governance dimension (cost) that today has
full visibility but zero control.

**Value:** `ai-inference-service` already computes and tracks cost per
request (`estimated_cost_usd`, token counts — EP-102), and that data already
flows into `telemetry-service`. Nothing today stops or flags overspend. This
epic adds the actual governance control, following the same
rules → enforcement → escalation pattern already proven for workflow risk
(workflow-governance-service) and MCP server risk (mcp-governance-service).

## Stories (4 MUST, 1 SHOULD)

| ID | Story | Size | Status | Description |
|----|-------|:----:|:------:|-------------|
| S1.1 | Budget schema + spend-check | M | Done ✓ | `ai_inference.usage_budgets` migration; computed-on-read spend aggregation from `inference_requests`; new spend-check function |
| S1.2 | Enforcement wiring | S | Done ✓ | Call the spend-check alongside the existing governance-client call; honor per-budget `soft`/`hard` mode (ADR-002) |
| S1.3 | Escalation on breach | S | Done ✓ | New `escalation-client.js` for ai-inference-service (doesn't have one yet); fires an incident at configurable threshold(s) |
| S1.4 | Budget admin page | M | Done ✓ | CRUD UI under Administration, following the TagAdmin pattern (corrected from the original WaiverAdmin comparison) |
| S1.5 | Budget line on Telemetry chart (SHOULD) | S | Done ✓ | Overlay the bound budget's limit on the existing cost/token trend chart — reuses existing telemetry infra, does not touch RoiIntelligence.jsx |

**Total:** 5 stories (4 MUST + 1 SHOULD)

## Scope

**In scope (MUST):**
- `usage_budgets` table: scope (model_id / user_id / service_id / workflow_id — reusing the existing free-text fields already on `inference_requests`, not a new entity registry), period, limit, mode
- A dedicated spend-check (ADR-001) — not a reuse of governance-service's asset-scoped `/enforce`
- Escalation on threshold breach via a new escalation-client for ai-inference-service
- Budget admin page (create/edit/archive budgets)

**In scope (SHOULD):**
- Soft-warn vs hard-block enforcement mode, configurable per budget (default: soft — ADR-002)
- Budget threshold overlay on the existing Telemetry page's cost chart

**Out of scope:**
- Any changes to `RoiIntelligence.jsx` → not deferred, simply a different, already-complete tool (executive ROI calculator, not operational budget monitoring)
- Multi-currency support → USD only, deferred indefinitely
- Automated budget rollover/reallocation logic → defer to a future epic if requested
- Chargeback/invoicing integration with external billing systems → out of IOA's scope entirely (a governance tool, not a billing system)
- Predictive/forecasted spend (ML-based) → defer

## Done Criteria

**Per story:**
- [ ] Code follows existing per-service conventions (fail-soft/fail-open clients per ADR-002, `require-auth.js` already applied globally)
- [ ] Tests passing (`npx vitest run`)
- [ ] Linting passes (`npx eslint .`)

**Epic complete:**
- [x] All MUST stories complete (S1.1–S1.4) ✓
- [x] At least one budget can be created, bound to a scope, and enforced (soft or hard) ✓ (E2E checkpoint: real hard-mode budget blocked a second request with 403 after breach)
- [x] A threshold breach fires a real escalation-service incident (verified end-to-end, not mocked) ✓ (E2E checkpoint: real incident row, severity=high; caught + fixed a missing ESCALATION_SERVICE_URL config gap along the way)
- [x] Budget admin page live under Administration ✓ (verified via real browser: create/edit/archive all confirmed end-to-end, S1.4)
- [x] `governance/architecture/modules/ai-inference-service.md` and `escalation-service.md` updated ✓ (depends_on/depended_by now reflect the real S1.3 dependency, found stale during this checkpoint)
- [x] Epic retrospective done ✓ (`work/epics/e1-ai-usage-budgets/retrospective.md`)
- [x] Merged to `main` ✓ (all 5 stories merged with --no-ff)

## Dependencies

```
S1.1 (schema + spend-check, foundation)
  ↓
S1.2 (enforcement wiring) ──┐
  ↓                          │
S1.3 (escalation)            │ (parallel with S1.2/S1.3)
                              │
S1.4 (admin page) ◄──────────┘
S1.5 (telemetry overlay, SHOULD) ← depends on S1.1 only
```

**External:** None.

## Architecture

| Decision | ADR | Summary |
|----------|-----|---------|
| Budget spend-check is separate from governance-service's `/enforce` | ADR-001 | The rule-evaluator's per-asset shape (`workflow, nodes, piiRows`) has no fit for a cumulative-spend-over-time check |
| Budget-check fails open on its own unavailability | ADR-002 | Deliberate deviation from asset-enforcement's fail-closed default — cost control, not safety/compliance |

> Problem Brief: N/A (epic designed directly from backlog E7 + a design conversation)

## Risks

| Risk | L/I | Mitigation |
|------|:---:|------------|
| Fail-open budget checks read as "not real enforcement" to stakeholders expecting hard caps | M/M | `hard` mode is fully supported and admin-configurable per budget; fail-open only covers spend-check *unavailability*, not an evaluated-and-exceeded budget |
| Computed-on-read spend aggregation slows down as `inference_requests` grows | L/M | Index on scope columns + `created_at`; revisit a maintained running-counter only if profiling shows it's actually needed — don't build it speculatively |
| Budget scope matching is exact-match against free-text `user_id`/`service_id`/`workflow_id` (no real team/entity registry) | M/L | Deliberate — same loose-reference convention migration 003 already established for these fields; inventing a new entity registry is out of scope for this epic |

## Parking Lot

- Generalized "numeric threshold over a time window" rule type in governance-service's rule engine → if a future epic needs more than budgets to use this shape, revisit ADR-001's boundary then
- Multi-currency, rollover/reallocation, chargeback/invoicing, predictive spend → see Out of scope above

## Implementation Plan

> Added by `/rai-epic-plan` — 2026-08-02

### Story Sequence

| Order | Story | Size | Dependencies | Milestone | Rationale |
|:-----:|-------|:----:|--------------|-----------|-----------|
| 1 | S1.1 | M | None | M1 | Walking skeleton — nothing else (enforcement, escalation, admin UI) has anything to call or CRUD against until the schema + spend-computation exist |
| 2 | S1.2 | S | S1.1 | M1 | Completes the walking skeleton — proves the E2E enforcement path (real budget → real gate decision on a real inference request) before adding UI or escalation on top |
| 3 | S1.4 | M | S1.1 | M2 | Only needs the schema (not enforcement) — runs in parallel with S1.3, since an admin needs *some* way to create a budget besides raw API calls before this is usable |
| 3 | S1.3 | S | S1.1, S1.2 | M2 | Runs in parallel with S1.4 — escalation only needs the enforcement decision from S1.2, not the admin page |
| 4 | S1.5 | S | S1.1 | M3 | SHOULD-priority; deliberately sequenced after all MUST stories even though its only hard dependency (S1.1) would allow it to start earlier — priority-driven, not pure dependency-driven |

### Milestones

| Milestone | Stories | Target | Success Criteria |
|-----------|---------|--------|-------------------|
| **M1: Walking Skeleton** | S1.1, S1.2 | ~Day 3 | A budget row can be created directly via SQL/API, and a real `POST /` inference request against a scope with exceeded spend is actually blocked (hard mode) or warned (soft mode) — proven with a real request, not a mock |
| **M2: Core MVP** | +S1.3, S1.4 | ~Day 6 | All 4 MUST stories done — matches scope.md's Done Criteria exactly: budget creatable through the admin page (not just API), a real threshold breach produces a real escalation-service incident row |
| **E2E Integration Checkpoint** (PAT-E-539) | — | before M3 | Multi-component epic (ai-inference-service + escalation-service + web SPA) — run real `docker compose` infra, not mocks: create a budget via `BudgetAdmin.jsx`, drive real inference requests through to a breach, confirm the incident appears in escalation-service's actual DB, confirm `X-IOA-Warning`/403 contracts match what the SPA expects |
| **M3: Feature Complete** | +S1.5 | ~Day 8 | All 5 planned stories done, including the SHOULD telemetry overlay |
| **M4: Epic Complete** | — | ~Day 9 | Done criteria met (scope.md), `ai-inference-service.md`/`escalation-service.md` module docs updated via `/rai-docs-update`, epic retrospective done |

### Parallel Work Streams

```
Time →
Stream 1 (Critical): S1.1 ─► S1.2 ─► S1.3 ─┐
                                            ├─► E2E checkpoint ─► S1.5 ─► M4
Stream 2 (Parallel):         S1.4 ─────────┘
```

**Merge points:**
- After S1.1: split into Stream 1 (S1.2 → S1.3, backend enforcement/escalation) and Stream 2 (S1.4, admin page UI) — S1.4 only needs the schema, not the enforcement logic
- Before the E2E checkpoint: both streams merge — the checkpoint needs the admin page (S1.4) to create a budget AND the enforcement/escalation path (S1.2/S1.3) to prove it actually fires

### Progress Tracking

| Story | Size | Status | Actual | Velocity | Notes |
|-------|:----:|:------:|:------:|:--------:|-------|
| S1.1 | M | Done ✓ | ~90 min (rough, uncalibrated) | 2.67x | Retro: work/epics/e1-ai-usage-budgets/stories/s1.1-retrospective.md — 4 patterns added (PAT-S-001–004) |
| S1.2 | S | Done ✓ | ~30 min (rough) | 3.0x | Retro: s1.2-retrospective.md — PAT-S-005 added |
| S1.3 | S | Done ✓ | ~30 min (rough) | 3.0x | Retro: s1.3-retrospective.md |
| S1.4 | M | Done ✓ | ~120 min (rough) | 2.0x | Retro: s1.4-retrospective.md — PAT-S-006/007/008 added |
| S1.5 | S | Done ✓ | ~45 min (rough) | 2.0x | Retro: s1.5-retrospective.md — PAT-S-010 added |

### Sequencing Risks

| Risk | L/I | Mitigation |
|------|:---:|------------|
| S1.4 (admin page) built against S1.1's schema before S1.2/S1.3 exist could assume a `status`/`spent`/`breach` shape that doesn't match what the real spend-check ends up returning | M/M | S1.1's contract for `checkBudget()`'s return shape (design.md — Key Contracts) is fixed before S1.4 starts; S1.4 consumes that documented shape, not whatever S1.2 happens to build later |
| No day-level velocity data exists yet for this codebase (first RaiSE-tracked epic) — the ~Day targets above are size-based guesses, not calibrated estimates | M/L | Targets are explicitly non-committal (see scope.md convention: "plans are hypotheses, not commitments"); Progress Tracking's Velocity column will calibrate future epics once S1.1 actually completes |
| Skipping the E2E checkpoint under time pressure, since unit tests with mocked `escalationClient`/`spendCheck` would pass without it | M/H | Checkpoint is a named milestone with its own row above, not folded silently into M2 or M3 — it has to be explicitly marked done, not implied by story completion |

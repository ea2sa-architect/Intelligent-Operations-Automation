# Epic Retrospective: E1 AI Usage Budgets

**Completed:** 2026-08-04
**Duration:** 1 day (started 2026-08-03; scope drafted 2026-08-02)
**Stories:** 5 stories delivered (4 MUST, 1 SHOULD)

> Backlog reference: E7 in `governance/backlog.md` ("AI usage budgets"). The
> `e1-` prefix on this epic's work directory is RaiSE's own sequential epic
> numbering (first epic tracked under this framework), not the backlog ID —
> the two are independent numbering schemes and shouldn't be conflated.

---

## Summary

Governance admins can now define spend/token caps per scope (model, user,
service, or workflow) and have them actually enforced — closing the one
governance dimension (cost) that previously had full visibility
(EP-102's `estimated_cost_usd`/token tracking) but zero control. A breach
either soft-warns or hard-blocks (admin-configurable per budget, ADR-002)
and fires a real escalation-service incident, all manageable through a new
Budget admin page and visible as a reference line on the existing
Telemetry cost chart.

## Metrics

| Metric | Value | Notes |
|--------|-------|-------|
| Stories Delivered | 5 / 5 (100%) | 4 MUST + 1 SHOULD, none descoped |
| Story Sizes | 2×M, 3×S | No story-point convention established in this repo yet — sized only |
| Tests Added | ~48 | spend-check.test.js (12) + budgets.test.js (13) + escalation-client.test.js (3) + budget-enforcement cases in inference.test.js (~20) |
| Average Velocity | 2.5x | Mean of per-story estimate/actual ratios (2.67x, 3.0x, 3.0x, 2.0x, 2.0x) — first RaiSE-tracked epic, so this is the calibration baseline, not yet validated against a second epic |
| Calendar Days | 1 | All 5 stories implemented and merged same day (2026-08-03); closed 2026-08-04 |

### Story Breakdown

| Story | Size | Velocity | Key Learning |
|-------|:----:|:--------:|--------------|
| S1.1 | M | 2.67x | Real-DB manual verification (Task 4) caught a `TIMESTAMPTZ` boundary bug mocked tests structurally couldn't — see PAT-S-003 |
| S1.2 | S | 3.0x | Skipping formal `/rai-story-design` for Simple stories doesn't mean skipping the design *decision* — it just moves into `plan.md` |
| S1.3 | S | 3.0x | Deliberate code duplication (this repo's established convention) extends cleanly to a new cross-service client |
| S1.4 | M | 2.0x | Mandatory browser verification caught two infra-only bugs (stale Docker container, Kong method allow-list) invisible to any test suite |
| S1.5 | S | 2.0x | Screenshot verification caught a Recharts axis-domain bug that "no console errors" would have shipped silently |

## What Went Well

- **Every "MUST verify against the real system" gate paid for itself.** Across the 5 stories, mandatory manual/E2E verification tasks caught 4 distinct bugs that mocked unit tests could not have caught by construction: a timezone-boundary bug (S1.1), a stale Docker container and a Kong method-allowlist gap (S1.4), and an off-screen chart reference line (S1.5). This wasn't incidental — the pattern held across backend, infra, and frontend verification alike.
- **Grounding design in real code before writing ADRs paid off.** ADR-001 (dedicated spend-check vs. reusing governance-service's `/enforce`) and ADR-002 (fail-open on spend-check unavailability) were both written after reading the actual `governance-client.js`/`rule-evaluator.js` code, not speculatively — no architecture rework was needed mid-epic.
- **Convention-mirroring compounded across stories.** S1.4's admin page mirrored `TagAdmin.jsx`, S1.3's escalation client copied `mcp-governance-service`'s near-verbatim, and PAT-S-005 (mirror an existing route's test-mock convention) was reinforced in 3 of 5 stories. Each story got faster to write because it wasn't inventing new patterns.
- **The E2E integration checkpoint was real, not a formality.** Per scope.md's Done Criteria, it drove real inference requests to a real 403 block and a real escalation-service incident row (not mocked), and caught a missing `ESCALATION_SERVICE_URL` config gap along the way.

## What Could Be Improved

- **`.raise/manifest.yaml`'s detected `test_command`/`lint_command` are still wrong** (root `npx vitest run` fails — no root config; `npx eslint .` fails for every backend service). Discovered in S1.1, persisted as PAT-S-001, but the underlying `rai init --detect` heuristic itself wasn't fixed (out of reach from application-repo work) — every future epic will hit this same trap unless the detection logic is fixed upstream.
- **No lint gate exists for backend services at all.** Flagged in S1.1 as a real, unaddressed gap (out of scope for this epic) — Done Criteria's "Linting passes" line is currently unverifiable for any backend story.
- **Velocity numbers across all 5 stories are self-reported, uncalibrated estimates** — no actual wall-clock tracking exists in this session, by every story retrospective's own admission. The 2.5x average should be treated as a first, low-confidence data point, not a number to plan the next epic's timeline against.

## Patterns Discovered

| ID | Pattern | Context |
|----|---------|---------|
| PAT-S-001 | `rai init --detect`'s detected test/lint commands need verification, not blind trust | Any story starting fresh in this repo |
| PAT-S-002 | `pg` returns `NUMERIC` columns as JS strings — parse before threshold comparisons | Any budget/cost/numeric-comparison code touching Postgres |
| PAT-S-003 | This codebase's tests mock `pool.query` entirely; real-DB manual verification is the only way to catch SQL/timezone bugs (includes internal DB connection details) | Any story writing new SQL-backed queries |
| PAT-S-004 | Checks that don't fit an existing rule-evaluator's shape should be a dedicated mechanism, not forced in | Future governance-check design decisions (generalized from ADR-001) |
| PAT-S-005 | Mirror an existing route/client's mock-with-default testing convention when adding a second cross-cutting check, rather than inventing a new one | Any story adding a new client or a second gate to an existing route |
| PAT-S-006 | Kong routes allow-list HTTP methods explicitly — an already-routed path prefix doesn't imply every verb is allowed | Any story adding a new HTTP method to an existing Kong-routed path |
| PAT-S-007 | Backend service containers use a `build:` context (not a bind mount) — code changes need an explicit rebuild to take effect | Any story debugging "my code change isn't showing up" in local Docker dev |
| PAT-S-008 | Long-running Vite dev servers can go stale after heavy git branch-switching; verify source before debugging "phantom" routing bugs | Any frontend story with a long-lived dev session across branch switches |
| PAT-S-009 | New cross-service HTTP clients need their target's `*_SERVICE_URL` wired into the caller's `extraEnv` in `platform.config.yaml` — the localhost fallback resolves to the calling container itself in Docker, not the target | Any story adding a new cross-service client (escalation, governance, telemetry, etc.) |
| PAT-S-010 | Recharts' `YAxis` auto-domain ignores `ReferenceLine` values outside the data's own range — pass an explicit `domain` when overlaying an out-of-range reference value | Any story adding a reference/threshold line to an existing Recharts chart |

## Process Insights

- **Mandatory verification tasks (Task 4/5 pattern) are this epic's single highest-leverage practice.** Every story that included one caught something real; none were wasted effort. Worth keeping as a non-negotiable gate for any story touching Docker infra, real SQL, or rendered UI, not just this epic.
- **Simple-complexity stories skipping `/rai-story-design` (S1.2, S1.3) didn't lose rigor** — the design decision just relocated into `plan.md`. The complexity gate worked as intended and shouldn't be second-guessed for future S-sized stories.
- **Deliberate code duplication (this repo's established convention for `require-auth.js`) extended cleanly to `escalation-client.js`** without needing a fresh design conversation — an existing codebase convention, correctly recognized and reused rather than re-litigated.

## Artifacts

- **Scope:** `work/epics/e1-ai-usage-budgets/scope.md`
- **Design (incl. ADR-001, ADR-002):** `work/epics/e1-ai-usage-budgets/design.md`
- **Stories:** `work/epics/e1-ai-usage-budgets/stories/` (s1.1–s1.5, each with story/design/plan/retrospective)
- **Module docs updated:** `governance/architecture/modules/ai-inference-service.md`, `governance/architecture/modules/escalation-service.md`
- **Tests:** ~48 new tests across `spend-check.test.js`, `budgets.test.js`, `escalation-client.test.js`, and budget-enforcement cases in `inference.test.js`

## Next Steps

- Update `governance/backlog.md` row **E7** (AI usage budgets) to Complete.
- Parking lot carried forward (see scope.md): a generalized "numeric threshold over time window" rule type for governance-service's rule engine (revisit only if a future epic needs it beyond budgets), plus explicitly-deferred multi-currency, rollover/reallocation, chargeback/invoicing, and predictive spend.
- No epic is currently queued to start next — `CLAUDE.local.md` will be updated to reflect E1 closed with no active epic, pending the next `/rai-epic-design`.

# ADR-001: Budget spend-checks are a dedicated mechanism, not an extension of governance-service's `/enforce`

**Status:** Accepted
**Epic:** E1 — AI usage budgets

## Context

`ai-inference-service`'s `governance-client.js` already calls governance-service's
`POST /enforce` before recording a decision, with the contract
`{asset_type, asset_id, correlation_id, context}` → `{decision, reason, ...}`.
It's tempting to reuse this path for budget enforcement too — one enforcement
call site, one place admins look for "is this allowed."

But `governance-service`'s rule engine (`rule-evaluator.js`) evaluates rules
against a single asset: its per-type evaluators all take
`(workflow, nodes, piiRows, config)` and return per-node violation messages.
A budget decision isn't about one asset — it's "has cumulative spend for a
scope (team/model/workflow) over a time window exceeded a limit," which has
no `nodes`/`piiRows` shape at all. Bolting a `budget` rule type onto this
evaluator would mean inventing a parallel, incompatible input shape inside
the same function family, or forking a special case through every layer of
an evaluator built for per-asset policy checks.

## Decision

Budget enforcement is a separate, purpose-built spend-check inside
`ai-inference-service` — a new function that aggregates spend from
`inference_requests` against a bound `usage_budgets` row, called alongside
(not instead of) the existing `governance-client.checkEnforcement()` call.
It does not go through governance-service's `/enforce` endpoint or rule
engine.

## Consequences

- Two enforcement calls per inference request (asset check + budget check),
  not one — acceptable; they answer genuinely different questions.
- Budget policy definitions live in `ai_inference.usage_budgets`, not
  `governance.rules` — budgets are not discoverable through
  governance-service's existing policy/rule CRUD UI. The new budget admin
  page (S4) is the only place to manage them.
- If a future epic needs a generalized "numeric threshold over a time
  window" rule type in governance-service, this spend-check can be
  reconsidered as an input to it — not blocked by this decision, just not
  attempted now, since the existing evaluator has no such shape to build on.

# ADR-002: Budget spend-check fails open on its own unavailability; asset enforcement stays fail-closed

**Status:** Accepted
**Epic:** E1 — AI usage budgets

## Context

`governance-client.js` (asset enforcement) deliberately fails **closed**:
if governance-service is unreachable, the inference request is blocked. Its
own comment states the reasoning explicitly — "Silently treating a
governance-service outage as allow would mean an enforce-mode policy
protects nothing exactly when the platform is unhealthy." That's the right
call for compliance/safety policy (PII exposure, unsanctioned providers).

Budget enforcement (ADR-001) is a new, separate check. The question: should
it inherit the same fail-closed default?

## Decision

No. The new spend-check fails **open** by default: if it can't determine
current spend (DB error, budget lookup failure, etc.), the inference request
proceeds and the failure is logged, not blocked. This is a deliberate
deviation from the fail-closed convention above, not an oversight.

Budget/spend is a cost-control concern, not a safety/compliance one — the
consequence of a missed budget check is "we might slightly overspend before
noticing," not "an ungoverned AI call touched PII." Blocking production
inference because a cost-tracking subsystem hiccupped is a disproportionate
failure mode for what it's protecting against.

This applies only to the spend-check being unavailable. A budget that **is**
successfully evaluated and **is** over its limit still blocks the request
when that budget's mode is `hard` (see S2 / design.md) — fail-open covers
"can't tell," not "can tell, and it's over."

## Consequences

- A budget-check outage is invisible to the calling workflow/user unless
  they're watching logs or the (S3) escalation path — acceptable, since the
  alternative is degrading inference availability for a cost concern.
- Every budget needs an explicit `mode` (`soft` | `hard`); new budgets
  default to `soft` (log + escalate, never block) so misconfiguration can't
  silently start blocking production traffic. Opting into `hard` is a
  deliberate admin action.
- Future engineers reading `governance-client.js` next to the new
  spend-check will see two different failure-mode defaults in the same
  service — this ADR is the reason, so that isn't mistaken for
  inconsistency.

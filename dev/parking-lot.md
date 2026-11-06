# Parking Lot: ioa-governance-platform

Deferred items — not forgotten, just not now. Each entry: origin, priority,
and the condition under which it'd get promoted back into a real epic/story.

## From E2 — ISO 42001 Technical Hardening

- **SAML SSO.** Priority: Low. Promote once an identity provider is chosen
  and it turns out OIDC isn't offered; S2.7 covers OIDC only.
- **Off-host anchoring of audit checkpoints (WORM bucket / external
  timestamping).** Priority: Low. Promote if an auditor or certification body
  asks for stronger tamper evidence than S2.5's signed, chained checkpoints.
- **Environment-specific K8s overlays (backlog E3) and tag usage reporting
  (backlog E9).** Priority: Low. Untouched by E2.

## From E1 — AI Usage Budgets

- **Generalized "numeric threshold over a time window" rule type in
  governance-service's rule engine.** Priority: Low. Promote if a future
  epic needs more than budgets to use this shape — ADR-001 explains why
  budgets don't use the existing per-asset rule-evaluator today.
- **Multi-currency budget support.** Priority: Low. Promote only if a
  non-USD deployment is actually planned.
- **Automated budget rollover/reallocation logic.** Priority: Low. Promote
  if admins ask for it after using fixed-period budgets for a while.
- **Chargeback/invoicing integration with external billing systems.**
  Priority: none — explicitly out of IOA's scope (governance tool, not a
  billing system), not just deferred.
- **Predictive/forecasted spend (ML-based).** Priority: Low. Promote only
  after actual-spend budgets (E1) have been in use long enough to have real
  historical data to forecast from.

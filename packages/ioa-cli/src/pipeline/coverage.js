// Pure — computes policy coverage from a GET /policy-bindings response.
// "Applicable" = every enabled rule on every currently-bound policy.
// "Evaluated"   = rules that carry an evaluated_at (rule_evaluations upsert
//                 fired at least once for this entity — see EP-311-P0).
// "Stale"       = evaluated, but longer ago than staleAfterMs (default 24h)
//                 — distinct from "never evaluated," since a workflow that
//                 hasn't changed but also hasn't been re-checked recently
//                 is a different risk posture than one that was never
//                 checked at all.
const DEFAULT_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export function computeCoverage(bindingsResponse, { staleAfterMs = DEFAULT_STALE_AFTER_MS, now = () => new Date() } = {}) {
  const rules = (bindingsResponse.policies ?? []).flatMap(p => p.rules ?? []);
  const applicable = rules.length;
  const evaluated = rules.filter(r => r.evaluated_at);
  const stale = evaluated.filter(r => now() - new Date(r.evaluated_at) > staleAfterMs);

  return {
    applicable,
    evaluated: evaluated.length,
    pct: applicable ? Math.round((evaluated.length / applicable) * 100) : 100,
    stale: stale.map(r => ({ rule_id: r.id, rule_type: r.rule_type, evaluated_at: r.evaluated_at })),
  };
}

// Pure — groups an open-violations list (GET /violations response shape)
// into per-severity counts, the shape ioa qa/assess/policy-check all print.
export function bucketBySeverity(violations) {
  const buckets = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const v of violations) {
    if (v.severity in buckets) buckets[v.severity]++;
  }
  return buckets;
}

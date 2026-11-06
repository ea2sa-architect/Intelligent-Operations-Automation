// Pure — classifies a workflow's anomaly-baseline state. Distinguishing
// "never computed" from "computed a while ago" from "fresh" matters because
// an empty alerts list means something different in each case: with
// no_baseline, IOA has never watched this workflow's real execution
// behavior at all — an empty list is "unknown," not "clean."
const DEFAULT_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000; // 7 days — baselines are behavioral, not code, so they age slower than rule coverage

export function classifyBaselineState(baseline, { staleAfterMs = DEFAULT_STALE_AFTER_MS, now = () => new Date() } = {}) {
  if (!baseline) return 'no_baseline';
  if (now() - new Date(baseline.computed_at) > staleAfterMs) return 'stale_baseline';
  return 'ok';
}

import { describe, it, expect } from 'vitest';
import { computeCoverage, bucketBySeverity } from '../src/pipeline/coverage.js';

describe('computeCoverage', () => {
  it('reports 100% coverage with zero applicable rules (nothing to check, not a gap)', () => {
    expect(computeCoverage({ policies: [] })).toEqual({ applicable: 0, evaluated: 0, pct: 100, stale: [] });
  });

  it('counts applicable/evaluated across all bound policies\' rules', () => {
    const bindings = {
      policies: [
        { policy_id: 'p1', rules: [{ id: 'r1', evaluated_at: '2026-07-30T00:00:00Z' }, { id: 'r2', evaluated_at: null }] },
        { policy_id: 'p2', rules: [{ id: 'r3', evaluated_at: '2026-07-30T00:00:00Z' }] },
      ],
    };
    const result = computeCoverage(bindings, { now: () => new Date('2026-07-30T00:05:00Z') });
    expect(result.applicable).toBe(3);
    expect(result.evaluated).toBe(2);
    expect(result.pct).toBe(67);
  });

  it('flags evaluated rules older than staleAfterMs as stale, distinct from never-evaluated', () => {
    const bindings = {
      policies: [{ policy_id: 'p1', rules: [
        { id: 'r1', rule_type: 'x', evaluated_at: '2026-07-01T00:00:00Z' }, // old — stale
        { id: 'r2', rule_type: 'y', evaluated_at: '2026-07-30T23:59:00Z' }, // fresh
        { id: 'r3', rule_type: 'z', evaluated_at: null },                    // never evaluated — not "stale"
      ] }],
    };
    const result = computeCoverage(bindings, { staleAfterMs: 24 * 60 * 60 * 1000, now: () => new Date('2026-07-31T00:00:00Z') });
    expect(result.stale).toEqual([{ rule_id: 'r1', rule_type: 'x', evaluated_at: '2026-07-01T00:00:00Z' }]);
  });
});

describe('bucketBySeverity', () => {
  it('counts violations per severity, ignoring unknown severities', () => {
    const violations = [
      { severity: 'high' }, { severity: 'high' }, { severity: 'low' }, { severity: 'weird' },
    ];
    expect(bucketBySeverity(violations)).toEqual({ critical: 0, high: 2, medium: 0, low: 1 });
  });

  it('returns all-zero buckets for an empty list', () => {
    expect(bucketBySeverity([])).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });
});

import { describe, it, expect } from 'vitest';
import { classifyBaselineState } from '../src/pipeline/anomaly-state.js';

describe('classifyBaselineState', () => {
  it('returns no_baseline when there is no baseline at all', () => {
    expect(classifyBaselineState(null)).toBe('no_baseline');
  });

  it('returns ok for a recently computed baseline', () => {
    const now = () => new Date('2026-07-30T12:00:00Z');
    expect(classifyBaselineState({ computed_at: '2026-07-30T11:00:00Z' }, { now })).toBe('ok');
  });

  it('returns stale_baseline for one older than the threshold', () => {
    const now = () => new Date('2026-07-30T12:00:00Z');
    expect(classifyBaselineState(
      { computed_at: '2026-07-01T00:00:00Z' },
      { staleAfterMs: 7 * 24 * 60 * 60 * 1000, now }
    )).toBe('stale_baseline');
  });
});

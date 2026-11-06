import { describe, it, expect } from 'vitest';
import { summarizeExposure } from '../src/pipeline/exposure-summary.js';

describe('summarizeExposure', () => {
  it('handles a workflow with no exposure data at all', () => {
    expect(summarizeExposure({})).toEqual({
      pii_types: [], unmasked_pii_count: 0, unrotated_secrets_count: 0, nodes_with_risk_factors: [],
    });
  });

  it('dedupes pii types and counts only unmasked/unencrypted occurrences', () => {
    const workflow = {
      pii_exposure: [
        { pii_type: 'email', masked: false, encrypted: false },
        { pii_type: 'email', masked: true, encrypted: false },
        { pii_type: 'ssn', masked: false, encrypted: true }, // encrypted — not counted as unmasked exposure
      ],
    };
    const result = summarizeExposure(workflow);
    expect(result.pii_types.sort()).toEqual(['email', 'ssn']);
    expect(result.unmasked_pii_count).toBe(1);
  });

  it('counts secrets with no rotation_confirmed_at as unrotated', () => {
    const workflow = {
      secret_exposure: [
        { rotation_confirmed_at: null },
        { rotation_confirmed_at: '2026-07-01T00:00:00Z' },
      ],
    };
    expect(summarizeExposure(workflow).unrotated_secrets_count).toBe(1);
  });

  it('surfaces only nodes that actually have risk_factors', () => {
    const workflow = {
      nodes: [
        { node_name: 'Safe Node', risk_factors: [] },
        { node_name: 'Risky Node', risk_factors: ['arbitrary_code_execution'] },
      ],
    };
    expect(summarizeExposure(workflow).nodes_with_risk_factors).toEqual([
      { node_name: 'Risky Node', risk_factors: ['arbitrary_code_execution'] },
    ]);
  });
});

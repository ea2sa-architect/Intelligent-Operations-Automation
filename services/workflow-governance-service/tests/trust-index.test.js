import { describe, it, expect } from 'vitest';
import trustIndex from '../src/lib/trust-index.js';

describe('computeTrustIndex', () => {
  it('lower risk_score produces a higher ATI', () => {
    const lowRisk  = trustIndex.computeTrustIndex({ riskScore: 10 });
    const highRisk = trustIndex.computeTrustIndex({ riskScore: 90 });
    expect(lowRisk.ati_score).toBeGreaterThan(highRisk.ati_score);
  });

  // Regression: computeAti in workflows.js once pre-inverted recoverability/
  // operational_visibility scores before passing them in, and this function
  // inverted them a second time — so recording assurance evidence made the
  // ATI's assurance input go *down* instead of up. All four inputs must be
  // raw risk-direction scores (higher = worse), inverted exactly once, here.
  it('a lower recoverabilityRiskScore (better recoverability) raises the ATI, not lowers it', () => {
    const poorRecoverability = trustIndex.computeTrustIndex({ riskScore: 40, recoverabilityRiskScore: 60 });
    const goodRecoverability = trustIndex.computeTrustIndex({ riskScore: 40, recoverabilityRiskScore: 40 });
    expect(goodRecoverability.ati_score).toBeGreaterThan(poorRecoverability.ati_score);
    expect(goodRecoverability.inputs.assurance.value).toBeGreaterThan(poorRecoverability.inputs.assurance.value);
  });

  it('a lower operationalRiskScore (healthier operations) raises the ATI', () => {
    const unhealthy = trustIndex.computeTrustIndex({ riskScore: 40, operationalRiskScore: 80 });
    const healthy   = trustIndex.computeTrustIndex({ riskScore: 40, operationalRiskScore: 10 });
    expect(healthy.ati_score).toBeGreaterThan(unhealthy.ati_score);
  });

  it('missing inputs default to a neutral value and are flagged provisional', () => {
    const result = trustIndex.computeTrustIndex({ riskScore: 40 });
    expect(result.inputs.governance.provisional).toBe(true);
    expect(result.inputs.assurance.provisional).toBe(true);
    expect(result.inputs.operational.provisional).toBe(true);
    expect(result.provisional).toBe(true);
  });

  it('mission-critical workflows are capped at 70 while assurance/governance are unverified', () => {
    const result = trustIndex.computeTrustIndex({ riskScore: 0, criticality: 'mission_critical' });
    expect(result.ati_score).toBeLessThanOrEqual(70);
  });

  // Epic 5, Feature 5.2 — MCP trust-ceiling rules
  describe('mcpCeilings', () => {
    it('a workflow with no MCP references is completely unaffected (empty ceilings_applied, same score as before)', () => {
      const withoutParam = trustIndex.computeTrustIndex({ riskScore: 10 });
      const withEmptyArray = trustIndex.computeTrustIndex({ riskScore: 10, mcpCeilings: [] });
      expect(withEmptyArray.ati_score).toBe(withoutParam.ati_score);
      expect(withEmptyArray.ceilings_applied).toEqual([]);
    });

    it('caps the ATI at the lowest applicable MCP ceiling', () => {
      const result = trustIndex.computeTrustIndex({
        riskScore: 5, // would otherwise produce a high ATI
        mcpCeilings: [
          { cap: 40, reason: 'Unregistered MCP server' },
          { cap: 84, reason: 'No owner assigned' },
        ],
      });
      expect(result.ati_score).toBeLessThanOrEqual(40);
    });

    it('reports every ceiling that constrained the score, not just the lowest', () => {
      const result = trustIndex.computeTrustIndex({
        // all four inputs favorable so the raw ATI (100) exceeds both caps below
        riskScore: 0, governancePostureScore: 0, recoverabilityRiskScore: 0, operationalRiskScore: 0,
        mcpCeilings: [
          { cap: 40, reason: 'Unregistered MCP server' },
          { cap: 84, reason: 'No owner assigned' },
        ],
      });
      expect(result.ceilings_applied).toHaveLength(2);
      expect(result.ceilings_applied.map(c => c.cap).sort()).toEqual([40, 84]);
    });

    it('does not report a ceiling that would not have constrained the raw score', () => {
      const result = trustIndex.computeTrustIndex({
        riskScore: 90, // raw ATI will already be well below 84
        mcpCeilings: [{ cap: 84, reason: 'No owner assigned' }],
      });
      expect(result.ceilings_applied).toEqual([]);
    });

    it('an MCP ceiling and the existing mission_critical ceiling combine — lowest wins', () => {
      const result = trustIndex.computeTrustIndex({
        riskScore: 0,
        criticality: 'mission_critical', // would cap at 70
        mcpCeilings: [{ cap: 15, reason: 'Token passthrough detected' }],
      });
      expect(result.ati_score).toBeLessThanOrEqual(15);
    });
  });
});

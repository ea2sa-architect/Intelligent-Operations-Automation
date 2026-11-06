import { describe, it, expect } from 'vitest';
import scorer from '../src/lib/mcp-risk-scorer.js';

function makeServer(overrides = {}) {
  return {
    id: 'srv-1', status: 'approved', trusted_publisher: true,
    technical_owner: 'jane@company.com', business_owner: 'finance-lead',
    integrity_info: 'sha256:abc123', review_date: new Date().toISOString(),
    ...overrides,
  };
}

describe('scoreServer', () => {
  it('returns all 8 dimensions, a risk_level, and a scoring_version', () => {
    const result = scorer.scoreServer({ server: makeServer() });
    expect(result.server_id).toBe('srv-1');
    expect(Object.keys(result.dimensions)).toHaveLength(8);
    expect(result).toHaveProperty('risk_score');
    expect(result).toHaveProperty('risk_level');
    expect(result).toHaveProperty('scoring_version');
    expect(result).toHaveProperty('calculated_at');
    expect(result).toHaveProperty('top_risk_factors');
  });

  it('a fully trusted, owned, reviewed server scores low', () => {
    const result = scorer.scoreServer({ server: makeServer() });
    expect(['LOW', 'MEDIUM']).toContain(result.risk_level);
  });

  it('an unapproved, untrusted, unowned server scores much higher', () => {
    const goodServer = scorer.scoreServer({ server: makeServer() });
    const badServer = scorer.scoreServer({
      server: makeServer({
        status: 'pending_review', trusted_publisher: false,
        technical_owner: null, business_owner: null, integrity_info: null, review_date: null,
      }),
    });
    expect(badServer.risk_score).toBeGreaterThan(goodServer.risk_score);
  });

  describe('mcp_tool_privilege', () => {
    it('scores higher with T4 destructive write tools than T0 read tools', () => {
      const server = makeServer();
      const low = scorer.scoreServer({ server, tools: [{ classification: 'T0', behavior: 'read', destructive: false }] });
      const high = scorer.scoreServer({ server, tools: [{ classification: 'T4', behavior: 'write', destructive: true }] });
      expect(high.dimensions.mcp_tool_privilege.score).toBeGreaterThan(low.dimensions.mcp_tool_privilege.score);
    });
  });

  describe('mcp_authorization_posture', () => {
    it('flags token passthrough as high risk', () => {
      const server = makeServer();
      const result = scorer.scoreServer({
        server,
        authorizations: [{ token_passthrough_detected: true, oauth_audience: null }],
      });
      expect(result.dimensions.mcp_authorization_posture.score).toBeGreaterThanOrEqual(60);
      expect(result.dimensions.mcp_authorization_posture.factors.join(' ')).toContain('passthrough');
    });

    it('scores well when scoped, audience-restricted, and time-limited', () => {
      const server = makeServer();
      const result = scorer.scoreServer({
        server,
        authorizations: [{ token_passthrough_detected: false, oauth_audience: 'aud', token_expiration_seconds: 3600, downstream_credential_exchange: false }],
      });
      expect(result.dimensions.mcp_authorization_posture.score).toBe(0);
    });
  });

  describe('mcp_tool_integrity', () => {
    it('flags tools with no definition hash or version', () => {
      const server = makeServer();
      const result = scorer.scoreServer({ server, tools: [{ definition_hash: null, version: null }] });
      expect(result.dimensions.mcp_tool_integrity.score).toBeGreaterThan(0);
    });
  });

  describe('mcp_context_injection_risk', () => {
    it('flags prompts with embedded instructions and tool references', () => {
      const server = makeServer();
      const result = scorer.scoreServer({
        server,
        prompts: [{ embedded_instructions: 'do X then Y', tool_references: ['tool-a'], approval_status: 'pending' }],
      });
      expect(result.dimensions.mcp_context_injection_risk.score).toBeGreaterThan(0);
    });
  });

  describe('mcp_approval_controls', () => {
    it('flags unclassified and pending high-privilege tools', () => {
      const server = makeServer();
      const result = scorer.scoreServer({
        server,
        tools: [{ classification: null, approval_status: 'pending' }, { classification: 'T4', approval_status: 'pending' }],
      });
      expect(result.dimensions.mcp_approval_controls.score).toBeGreaterThan(0);
    });

    it('does not flag when there are no high-privilege tools at all', () => {
      const server = makeServer();
      const result = scorer.scoreServer({ server, tools: [{ classification: 'T0', approval_status: 'allowed' }] });
      expect(result.dimensions.mcp_approval_controls.score).toBeLessThanOrEqual(5);
    });
  });

  describe('mcp_runtime_visibility', () => {
    it('defaults to provisional (Epic 6 telemetry not built yet) when no telemetry is passed', () => {
      const result = scorer.scoreServer({ server: makeServer() });
      expect(result.dimensions.mcp_runtime_visibility.score).toBe(70);
    });

    it('scores well with healthy, low-failure telemetry', () => {
      const result = scorer.scoreServer({
        server: makeServer(),
        telemetry: { total_invocations_7d: 100, failure_rate_7d: 0 },
      });
      expect(result.dimensions.mcp_runtime_visibility.score).toBeLessThan(70);
    });
  });

  describe('mcp_data_boundary', () => {
    it('flags sensitive resources with no tenant boundary or retention policy', () => {
      const server = makeServer();
      const result = scorer.scoreServer({
        server,
        resources: [{ sensitivity: 'restricted', tenant_boundary: null, retention_requirements: null }],
      });
      expect(result.dimensions.mcp_data_boundary.score).toBeGreaterThan(0);
    });
  });

  it('determineRiskLevel matches the same thresholds as the workflow scorer', () => {
    expect(scorer.determineRiskLevel(0)).toBe('LOW');
    expect(scorer.determineRiskLevel(29)).toBe('LOW');
    expect(scorer.determineRiskLevel(30)).toBe('MEDIUM');
    expect(scorer.determineRiskLevel(59)).toBe('MEDIUM');
    expect(scorer.determineRiskLevel(60)).toBe('HIGH');
    expect(scorer.determineRiskLevel(79)).toBe('HIGH');
    expect(scorer.determineRiskLevel(80)).toBe('CRITICAL');
  });
});

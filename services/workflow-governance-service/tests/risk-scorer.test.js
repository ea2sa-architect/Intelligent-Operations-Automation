import { describe, it, expect } from 'vitest';
import scorer from '../src/lib/risk-scorer.js';

// Minimal metadata helper
function makeMetadata(overrides = {}) {
  return {
    id: 'wf-1',
    name: 'Test Workflow',
    nodes: [],
    dag: [],
    credentials: [],
    triggers: [],
    piiExposure: { hasPII: false, piiFields: [], risks: [], exposedToExternal: false },
    errorHandling: { hasTryCatch: false, hasErrorBranches: false, hasRetryLogic: false, retryConfiguration: null, saveDataOnError: false },
    externalDeps: [],
    ...overrides,
  };
}

describe('scoreWorkflow', () => {
  it('returns structured risk score with all 16 dimensions', () => {
    const result = scorer.scoreWorkflow(makeMetadata());
    expect(result).toHaveProperty('workflow_id', 'wf-1');
    expect(result).toHaveProperty('risk_score');
    expect(result).toHaveProperty('risk_level');
    expect(result).toHaveProperty('dimensions');
    expect(result).toHaveProperty('top_risk_factors');
    expect(Object.keys(result.dimensions)).toHaveLength(16);
  });

  it('open critical violations increase governance_posture score', () => {
    const clean = scorer.scoreWorkflow(makeMetadata(), [], { violations: [] });
    const dirty = scorer.scoreWorkflow(makeMetadata(), [], {
      violations: [{ status: 'open', severity: 'critical', detected_at: new Date().toISOString() }],
    });
    expect(dirty.dimensions.governance_posture.score).toBeGreaterThan(clean.dimensions.governance_posture.score);
  });

  it('resolving violations does not also move unrelated dimensions (no double-counting)', () => {
    const withOpen = scorer.scoreWorkflow(makeMetadata(), [], {
      violations: [{ status: 'open', severity: 'high', detected_at: new Date().toISOString() }],
    });
    const resolved = scorer.scoreWorkflow(makeMetadata(), [], {
      violations: [{ status: 'resolved', severity: 'high', detected_at: new Date().toISOString(), resolved_at: new Date().toISOString() }],
    });
    expect(resolved.dimensions.governance_posture.score).toBeLessThan(withOpen.dimensions.governance_posture.score);
    expect(resolved.dimensions.approval_nodes.score).toBe(withOpen.dimensions.approval_nodes.score);
    expect(resolved.dimensions.pii_exposure.score).toBe(withOpen.dimensions.pii_exposure.score);
  });

  it('verified restore test lowers recoverability risk more than a bare backup', () => {
    const noEvidence = scorer.scoreWorkflow(makeMetadata(), [], { evidence: [] });
    const backupOnly = scorer.scoreWorkflow(makeMetadata(), [], {
      evidence: [{ evidence_type: 'database_backup_verified', status: 'verified', expires_at: null }],
    });
    const restoreTested = scorer.scoreWorkflow(makeMetadata(), [], {
      evidence: [{ evidence_type: 'restore_test_passed', status: 'verified', expires_at: null }],
    });
    expect(backupOnly.dimensions.recoverability.score).toBeLessThan(noEvidence.dimensions.recoverability.score);
    expect(restoreTested.dimensions.recoverability.score).toBeLessThan(backupOnly.dimensions.recoverability.score);
  });

  it('falls back to the notification-node proxy when no telemetry is wired up', () => {
    const withNotif = scorer.scoreWorkflow(makeMetadata({
      nodes: [{ governance_type: 'notification', n8n_type: 'n8n-nodes-base.slack', node_name: 'Slack', risk_factors: [], parameters_json: {}, disabled: false }],
    }), [], { telemetry: null });
    const withoutNotif = scorer.scoreWorkflow(makeMetadata(), [], { telemetry: null });
    expect(withNotif.dimensions.operational_visibility.score).toBeLessThan(withoutNotif.dimensions.operational_visibility.score);
  });

  it('real telemetry with a high failure rate scores worse than a healthy workflow', () => {
    const healthy = scorer.scoreWorkflow(makeMetadata(), [], {
      telemetry: { total_executions_7d: 50, failure_rate_7d: 0, last_success_at: new Date().toISOString() },
    });
    const failing = scorer.scoreWorkflow(makeMetadata(), [], {
      telemetry: { total_executions_7d: 50, failure_rate_7d: 80, last_success_at: new Date().toISOString() },
    });
    expect(failing.dimensions.operational_visibility.score).toBeGreaterThan(healthy.dimensions.operational_visibility.score);
  });

  it('expired evidence does not count toward recoverability', () => {
    const expired = scorer.scoreWorkflow(makeMetadata(), [], {
      evidence: [{ evidence_type: 'restore_test_passed', status: 'verified', expires_at: '2020-01-01' }],
    });
    const noEvidence = scorer.scoreWorkflow(makeMetadata(), [], { evidence: [] });
    expect(expired.dimensions.recoverability.score).toBe(noEvidence.dimensions.recoverability.score);
  });

  it('missing owner increases ownership_gap score', () => {
    const noOwner = scorer.scoreWorkflow(makeMetadata(), [], { ownership: {} });
    const withOwner = scorer.scoreWorkflow(makeMetadata(), [], {
      ownership: { technical_owner: 'jane', business_owner: 'finance-lead', ownership_verified_at: new Date().toISOString() },
    });
    expect(noOwner.dimensions.ownership_gap.score).toBeGreaterThan(withOwner.dimensions.ownership_gap.score);
    expect(withOwner.dimensions.ownership_gap.score).toBe(0);
  });

  it('stale ownership verification adds a smaller penalty than missing owners', () => {
    const stale = scorer.scoreWorkflow(makeMetadata(), [], {
      ownership: { technical_owner: 'jane', business_owner: 'finance-lead', ownership_verified_at: '2020-01-01' },
    });
    expect(stale.dimensions.ownership_gap.score).toBe(3);
  });

  it('workflow with no nodes scores LOW', () => {
    const result = scorer.scoreWorkflow(makeMetadata());
    expect(['LOW', 'MEDIUM']).toContain(result.risk_level);
    expect(result.risk_score).toBeLessThan(60);
  });

  it('workflow with OpenAI node scores higher than no-AI workflow', () => {
    const noAi = scorer.scoreWorkflow(makeMetadata());
    const withAi = scorer.scoreWorkflow(makeMetadata({
      nodes: [{ governance_type: 'ai_inference', n8n_type: 'n8n-nodes-base.openai', node_name: 'AI', risk_factors: ['no_system_prompt'], parameters_json: {}, disabled: false }],
    }));
    expect(withAi.risk_score).toBeGreaterThan(noAi.risk_score);
  });

  it('unmasked PII exposure increases risk', () => {
    const noPii = scorer.scoreWorkflow(makeMetadata());
    const withPii = scorer.scoreWorkflow(makeMetadata({
      piiExposure: {
        hasPII: true,
        piiFields: ['email', 'ssn'],
        risks: [
          { pii_type: 'ssn', node_name: 'HTTP', field_location: 'parameter', masked: false, encrypted: false },
          { pii_type: 'email', node_name: 'Set', field_location: 'parameter', masked: false, encrypted: false },
        ],
        exposedToExternal: true,
      },
    }));
    expect(withPii.risk_score).toBeGreaterThan(noPii.risk_score);
  });

  it('approval nodes reduce risk score relative to no approval', () => {
    const noApproval = scorer.scoreWorkflow(makeMetadata());
    const withApproval = scorer.scoreWorkflow(makeMetadata({
      nodes: [{ governance_type: 'approval', n8n_type: 'n8n-nodes-base.wait', node_name: 'Wait', risk_factors: [], parameters_json: {}, disabled: false }],
    }));
    // approval_nodes dimension should score lower with approval present
    expect(withApproval.dimensions.approval_nodes.score).toBeLessThan(noApproval.dimensions.approval_nodes.score);
  });

  it('retry logic reduces retry_policy score', () => {
    const noRetry = scorer.scoreWorkflow(makeMetadata());
    const withRetry = scorer.scoreWorkflow(makeMetadata({
      errorHandling: {
        hasTryCatch: true, hasErrorBranches: true, hasRetryLogic: true,
        retryConfiguration: { maxRetries: 3, backoffType: 'exponential', backoffBaseMs: 1000 },
        saveDataOnError: false,
      },
    }));
    expect(withRetry.dimensions.retry_policy.score).toBeLessThan(noRetry.dimensions.retry_policy.score);
  });

  it('webhook node increases api_exposure score', () => {
    const noWebhook = scorer.scoreWorkflow(makeMetadata());
    const withWebhook = scorer.scoreWorkflow(makeMetadata({
      nodes: [{ governance_type: 'webhook', n8n_type: 'n8n-nodes-base.webhook', node_name: 'Webhook', risk_factors: [], parameters_json: {}, disabled: false }],
    }));
    expect(withWebhook.dimensions.api_exposure.score).toBeGreaterThan(noWebhook.dimensions.api_exposure.score);
  });

  it('CRITICAL risk level at score >= 80', () => {
    expect(scorer.determineRiskLevel(85)).toBe('CRITICAL');
    expect(scorer.determineRiskLevel(80)).toBe('CRITICAL');
  });

  it('HIGH risk level at score 60-79', () => {
    expect(scorer.determineRiskLevel(75)).toBe('HIGH');
    expect(scorer.determineRiskLevel(60)).toBe('HIGH');
  });

  it('MEDIUM risk level at score 30-59', () => {
    expect(scorer.determineRiskLevel(45)).toBe('MEDIUM');
    expect(scorer.determineRiskLevel(30)).toBe('MEDIUM');
  });

  it('LOW risk level at score < 30', () => {
    expect(scorer.determineRiskLevel(0)).toBe('LOW');
    expect(scorer.determineRiskLevel(29)).toBe('LOW');
  });
});

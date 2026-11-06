import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

import pool from '../db.js';
import { recordAgentSecurityEvent } from '../src/lib/agent-violation-recorder.js';

const RULE_ROW = { rule_id: 'rule-1', policy_id: 'policy-1', policy_version: 1 };

beforeEach(() => vi.clearAllMocks());

describe('recordAgentSecurityEvent', () => {
  it('throws for an unknown rule_type', async () => {
    await expect(recordAgentSecurityEvent({ agentId: 'a1', ruleType: 'not_a_real_type', message: 'x' }))
      .rejects.toThrow(/unknown agent security rule_type/i);
  });

  it('throws when no enabled policy_rule is seeded for the rule_type', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await expect(recordAgentSecurityEvent({ agentId: 'a1', ruleType: 'agent_privilege_escalation', message: 'x' }))
      .rejects.toThrow(/no enabled policy_rule seeded/i);
  });

  it('creates a critical violation tied to the seeded policy/rule', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [RULE_ROW] })                                  // rule lookup
      .mockResolvedValueOnce({ rows: [] })                                          // dedup check — none open
      .mockResolvedValueOnce({ rows: [{ id: 'violation-1', severity: 'critical' }] }) // insert
      .mockResolvedValueOnce({ rows: [] });                                          // history insert

    const violation = await recordAgentSecurityEvent({
      agentId: 'a1', agentName: 'test-agent', ruleType: 'agent_privilege_escalation', message: 'overreach',
    });
    expect(violation.id).toBe('violation-1');

    const insertCall = pool.query.mock.calls[2];
    expect(insertCall[0]).toContain('INSERT INTO violations');
    expect(insertCall[1]).toEqual(['a1', 'rule-1', 'policy-1', 'overreach']);
  });

  it('returns the existing open violation instead of creating a duplicate (dedup)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [RULE_ROW] })
      .mockResolvedValueOnce({ rows: [{ id: 'existing-violation' }] }); // dedup hit

    const violation = await recordAgentSecurityEvent({
      agentId: 'a1', ruleType: 'agent_confused_deputy', message: 'same message again',
    });
    expect(violation.id).toBe('existing-violation');
    expect(pool.query).toHaveBeenCalledTimes(2); // no insert, no history write
  });
});

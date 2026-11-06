import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

import pool from '../db.js';
import { evaluateZap } from '../src/lib/rule-evaluator.js';

const POLICY = { id: 'policy-1', enforcement_mode: 'observe' };
const RULE = { id: 'rule-1', severity: 'medium', config_json: { blocked_zap_ids: ['bad-zap'], blocked_apps: ['dropbox'] } };

beforeEach(() => vi.clearAllMocks());

describe('evaluateZap', () => {
  it('returns [] when the seed migration has not run (no policy found)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const result = await evaluateZap('some-zap');
    expect(result).toEqual([]);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('auto-binds the policy to the zap on evaluation', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [POLICY] })
      .mockResolvedValueOnce({ rows: [] })                    // binding insert
      .mockResolvedValueOnce({ rows: [{ ...RULE, config_json: { blocked_zap_ids: [], blocked_apps: [] } }] })
      .mockResolvedValueOnce({ rows: [] })                    // rule_evaluations upsert
      .mockResolvedValueOnce({ rows: [] });                    // existing violations

    await evaluateZap('harmless-zap', {});

    const bindCall = pool.query.mock.calls[1];
    expect(bindCall[0]).toContain('INSERT INTO policy_bindings');
    expect(bindCall[1]).toEqual([POLICY.id, 'harmless-zap']);
  });

  it('does not flag a zap with no blocked id or app', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [POLICY] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...RULE, config_json: { blocked_zap_ids: [], blocked_apps: [] } }] })
      .mockResolvedValueOnce({ rows: [] })                    // rule_evaluations upsert
      .mockResolvedValueOnce({ rows: [] });

    const result = await evaluateZap('harmless-zap', { triggerApp: 'slack' });
    expect(result).toEqual([]);
    expect(pool.query).toHaveBeenCalledTimes(5); // no violation insert, no history insert
  });

  it('creates a violation for a blocked zap id', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [POLICY] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [RULE] })
      .mockResolvedValueOnce({ rows: [] })                    // rule_evaluations upsert
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'v-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    await evaluateZap('bad-zap', {});

    const insertCall = pool.query.mock.calls[5];
    expect(insertCall[0]).toContain('INSERT INTO violations');
    expect(insertCall[1]).toEqual(['bad-zap', RULE.id, POLICY.id, RULE.severity, 'Zap "bad-zap" is on the blocked list']);
  });

  it('creates a violation for a blocked trigger or action app', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [POLICY] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [RULE] })
      .mockResolvedValueOnce({ rows: [] })                    // rule_evaluations upsert
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 'v-1' }] })
      .mockResolvedValueOnce({ rows: [] });

    await evaluateZap('some-other-zap', { triggerApp: 'Dropbox' }); // case-insensitive match

    const insertCall = pool.query.mock.calls[5];
    expect(insertCall[1][4]).toMatch(/blocked app "dropbox"/i);
  });

  it('resolves a previously open violation when the condition clears', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [POLICY] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ...RULE, config_json: { blocked_zap_ids: [], blocked_apps: [] } }] })
      .mockResolvedValueOnce({ rows: [] })                    // rule_evaluations upsert
      .mockResolvedValueOnce({ rows: [{ id: 'v-old', message: 'Zap "bad-zap" is on the blocked list', status: 'open' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await evaluateZap('bad-zap', {});
    expect(result).toEqual([]);
    const resolveCall = pool.query.mock.calls[5];
    expect(resolveCall[0]).toContain("SET status = 'resolved'");
  });
});

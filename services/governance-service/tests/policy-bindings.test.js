import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
// Route tests exercise business logic, not auth — require-auth.js has its
// own dedicated conformance suite (tests/require-auth.test.js).
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
import pool from '../db.js';
import app from '../index.js';

beforeEach(() => vi.clearAllMocks());

describe('GET /policy-bindings', () => {
  it('requires entity_type and entity_id', async () => {
    const res = await request(app).get('/policy-bindings');
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('returns an empty policies array when nothing is bound', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // bindings query

    const res = await request(app).get('/policy-bindings?entity_type=workflow&entity_id=wf-1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ entity_type: 'workflow', entity_id: 'wf-1', policies: [] });
    // No rules query fired — nothing to look rules up for.
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('is a pure read — does not auto-bind or write anything', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ policy_id: 'p-1', policy_name: 'Some Policy', policy_status: 'active', enforcement_mode: 'enforce' }] })
      .mockResolvedValueOnce({ rows: [] }); // rules query

    await request(app).get('/policy-bindings?entity_type=zap&entity_id=zap-1');

    for (const [sql] of pool.query.mock.calls) {
      expect(sql.trim().toUpperCase().startsWith('SELECT')).toBe(true);
    }
  });

  it('nests each policy\'s rules, including per-rule coverage from rule_evaluations', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ policy_id: 'p-1', policy_name: 'Zapier Zap Execution Governance', policy_status: 'active', enforcement_mode: 'observe' }] })
      .mockResolvedValueOnce({
        rows: [
          { id: 'rule-1', policy_id: 'p-1', rule_type: 'zap_execution_governance', severity: 'medium', enabled: true, last_result: 'clean', evaluated_at: '2026-07-30T00:00:00Z' },
        ],
      });

    const res = await request(app).get('/policy-bindings?entity_type=zap&entity_id=zap-1');

    expect(res.status).toBe(200);
    expect(res.body.policies).toHaveLength(1);
    expect(res.body.policies[0].rules).toEqual([
      { id: 'rule-1', policy_id: 'p-1', rule_type: 'zap_execution_governance', severity: 'medium', enabled: true, last_result: 'clean', evaluated_at: '2026-07-30T00:00:00Z' },
    ]);

    const [sql, params] = pool.query.mock.calls[1];
    expect(sql).toContain('LEFT JOIN rule_evaluations');
    expect(params).toEqual([['p-1'], 'zap', 'zap-1']);
  });

  it('scopes bindings by effective_to being unset or in the future', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    await request(app).get('/policy-bindings?entity_type=workflow&entity_id=wf-1');

    const [sql] = pool.query.mock.calls[0];
    expect(sql).toContain('effective_to');
  });
});

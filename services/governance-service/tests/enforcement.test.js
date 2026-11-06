import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/lib/rule-evaluator.js', () => ({ evaluateWorkflow: vi.fn(), evaluateMcpServer: vi.fn(), evaluateAiModel: vi.fn(), evaluateZap: vi.fn() }));
// POST /enforce is service-only as of S2.8 (2026-10-08) — every test below
// exercises the route as its real callers do (Kong's plugin, workflow-
// governance-service's enforcement-client.js), both authenticated via
// X-Internal-Service-Key. wrapped in vi.fn() so the dedicated 'service-only
// guard' describe block below can override it per-test for the human-
// session case.
vi.mock('../src/lib/require-auth.js', () => ({
  default: vi.fn((req, _res, next) => { req.user = { id: 'internal-service', isService: true }; next(); }),
  requirePermission: () => (_req, _res, next) => next(),
}));
import pool from '../db.js';
import { evaluateWorkflow, evaluateMcpServer, evaluateAiModel, evaluateZap } from '../src/lib/rule-evaluator.js';
import requireAuth from '../src/lib/require-auth.js';
import app from '../index.js';

beforeEach(() => vi.clearAllMocks());
afterEach(() => requireAuth.mockImplementation((req, _res, next) => { req.user = { id: 'internal-service', isService: true }; next(); }));

const BINDING = (mode, overrides = {}) => ({
  policy_id: 'policy-1', policy_name: 'Test Policy', enforcement_mode: mode, ...overrides,
});
const VIOLATION = { id: 'violation-1', message: 'something is wrong' };

describe('POST /enforce — S2.8 service-only guard (2026-10-08, finding F-01)', () => {
  it('403s a human-session caller regardless of role/permissions', async () => {
    requireAuth.mockImplementationOnce((req, _res, next) => {
      req.user = { id: 'user-1', username: 'auditor1', roles: ['auditor'], permissions: ['mcp:read', 'policy:read', 'audit:read', 'workflow:read'] };
      next();
    });

    const res = await request(app).post('/enforce').send({ asset_type: 'workflow', asset_id: 'wf-1' });
    expect(res.status).toBe(403);
    expect(evaluateWorkflow).not.toHaveBeenCalled();
  });

  it('allows a service-key caller through to normal evaluation', async () => {
    evaluateWorkflow.mockResolvedValueOnce([]);
    pool.query
      .mockResolvedValueOnce({ rows: [{ containment_state: 'active' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).post('/enforce').send({ asset_type: 'workflow', asset_id: 'wf-1' });
    expect(res.status).toBe(200);
  });
});

describe('POST /enforce', () => {
  it('rejects an unknown asset_type', async () => {
    const res = await request(app).post('/enforce').send({ asset_type: 'widget', asset_id: 'w1' });
    expect(res.status).toBe(400);
    expect(evaluateWorkflow).not.toHaveBeenCalled();
    expect(evaluateMcpServer).not.toHaveBeenCalled();
  });

  it('requires asset_id', async () => {
    const res = await request(app).post('/enforce').send({ asset_type: 'workflow' });
    expect(res.status).toBe(400);
  });

  it('allows with no events when nothing is bound to the asset', async () => {
    evaluateWorkflow.mockResolvedValueOnce([]);
    pool.query
      .mockResolvedValueOnce({ rows: [{ containment_state: 'active' }] }) // containment check
      .mockResolvedValueOnce({ rows: [] }); // bindings

    const res = await request(app).post('/enforce').send({ asset_type: 'workflow', asset_id: 'wf-1' });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('allow');
    expect(res.body.events).toEqual([]);
    expect(evaluateWorkflow).toHaveBeenCalledWith('wf-1', {});
  });

  it('allows and records an allow event when the bound policy has no active violation', async () => {
    evaluateMcpServer.mockResolvedValueOnce([]);
    pool.query
      .mockResolvedValueOnce({ rows: [{ containment_state: 'active' }] }) // containment check
      .mockResolvedValueOnce({ rows: [BINDING('enforce')] })
      .mockResolvedValueOnce({ rows: [] }) // no violations for this policy
      .mockResolvedValueOnce({ rows: [{ id: 'event-1', outcome: 'allow' }] }); // event insert

    const res = await request(app).post('/enforce').send({ asset_type: 'mcp_server', asset_id: 'srv-1' });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('allow');
    expect(res.body.blocked_by).toBeNull();

    const eventInsertArgs = pool.query.mock.calls[3][1];
    expect(eventInsertArgs).toEqual(['policy-1', null, 'mcp_server', 'srv-1', 'enforce', 'allow', null, null]);
  });

  // The core observe-mode promise: a violation exists, but nothing about the
  // request is blocked or flagged — only the event and the violation record it.
  it('observe mode never blocks or warns even when a violation exists', async () => {
    evaluateMcpServer.mockResolvedValueOnce([]);
    pool.query
      .mockResolvedValueOnce({ rows: [{ containment_state: 'active' }] })
      .mockResolvedValueOnce({ rows: [BINDING('observe')] })
      .mockResolvedValueOnce({ rows: [VIOLATION] })
      .mockResolvedValueOnce({ rows: [{ id: 'event-1', outcome: 'allow' }] });

    const res = await request(app).post('/enforce').send({ asset_type: 'mcp_server', asset_id: 'srv-1' });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('allow');
    expect(res.body.blocked_by).toBeNull();
    expect(res.body.warnings).toEqual([]);
    expect(res.headers['x-ioa-warning']).toBeUndefined();

    const eventInsertArgs = pool.query.mock.calls[3][1];
    expect(eventInsertArgs).toEqual(['policy-1', 'violation-1', 'mcp_server', 'srv-1', 'observe', 'allow', 'something is wrong', null]);
  });

  it('warn mode passes through with an X-IOA-Warning header and a warnings entry', async () => {
    evaluateMcpServer.mockResolvedValueOnce([]);
    pool.query
      .mockResolvedValueOnce({ rows: [{ containment_state: 'active' }] })
      .mockResolvedValueOnce({ rows: [BINDING('warn')] })
      .mockResolvedValueOnce({ rows: [VIOLATION] })
      .mockResolvedValueOnce({ rows: [{ id: 'event-1', outcome: 'warn' }] });

    const res = await request(app).post('/enforce').send({ asset_type: 'mcp_server', asset_id: 'srv-1' });
    expect(res.status).toBe(200);
    expect(res.body.decision).toBe('warn');
    expect(res.body.warnings).toEqual([{ policy_id: 'policy-1', policy_name: 'Test Policy', violation_id: 'violation-1', message: 'something is wrong' }]);
    expect(res.headers['x-ioa-warning']).toBe('Test Policy');
  });

  it('enforce mode blocks with a 403 and identifies the policy + violation', async () => {
    evaluateMcpServer.mockResolvedValueOnce([]);
    pool.query
      .mockResolvedValueOnce({ rows: [{ containment_state: 'active' }] })
      .mockResolvedValueOnce({ rows: [BINDING('enforce')] })
      .mockResolvedValueOnce({ rows: [VIOLATION] })
      .mockResolvedValueOnce({ rows: [{ id: 'event-1', outcome: 'block' }] });

    const res = await request(app).post('/enforce').send({ asset_type: 'mcp_server', asset_id: 'srv-1', correlation_id: 'corr-1' });
    expect(res.status).toBe(403);
    expect(res.body.decision).toBe('block');
    expect(res.body.blocked_by).toEqual({ policy_id: 'policy-1', policy_name: 'Test Policy', violation_id: 'violation-1', message: 'something is wrong' });
    expect(res.body.correlation_id).toBe('corr-1');
  });

  it('a block from any policy wins over a warn from another', async () => {
    evaluateMcpServer.mockResolvedValueOnce([]);
    pool.query
      .mockResolvedValueOnce({ rows: [{ containment_state: 'active' }] })
      .mockResolvedValueOnce({ rows: [BINDING('warn', { policy_id: 'policy-warn', policy_name: 'Warn Policy' }), BINDING('enforce', { policy_id: 'policy-enforce', policy_name: 'Enforce Policy' })] })
      .mockResolvedValueOnce({ rows: [{ id: 'v-warn', message: 'warn condition' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'event-warn' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'v-enforce', message: 'enforce condition' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'event-enforce' }] });

    const res = await request(app).post('/enforce').send({ asset_type: 'mcp_server', asset_id: 'srv-1' });
    expect(res.status).toBe(403);
    expect(res.body.decision).toBe('block');
    expect(res.body.blocked_by.policy_id).toBe('policy-enforce');
    expect(res.body.warnings).toHaveLength(1);
    expect(res.body.warnings[0].policy_id).toBe('policy-warn');
  });

  // EP-201-S12/S13 — no CONTAINMENT_STATE_QUERIES entry for ai_model, so the
  // containment check is skipped entirely (not an error, just nothing to check).
  describe('ai_model asset type', () => {
    it('evaluates and passes context through to evaluateAiModel', async () => {
      evaluateAiModel.mockResolvedValueOnce([]);
      pool.query.mockResolvedValueOnce({ rows: [] }); // bindings

      const res = await request(app).post('/enforce').send({
        asset_type: 'ai_model', asset_id: 'model-1', context: { dataClassification: 'restricted' },
      });
      expect(res.status).toBe(200);
      expect(evaluateAiModel).toHaveBeenCalledWith('model-1', { dataClassification: 'restricted' });
    });

    it('blocks when the auto-bound policy is in enforce mode and finds a violation', async () => {
      evaluateAiModel.mockResolvedValueOnce([]);
      pool.query
        .mockResolvedValueOnce({ rows: [BINDING('enforce', { policy_id: 'ai-policy', policy_name: 'AI Model Direct-Request Governance' })] })
        .mockResolvedValueOnce({ rows: [{ id: 'v-1', message: 'Model "gpt-x" is not sanctioned' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'event-1' }] });

      const res = await request(app).post('/enforce').send({ asset_type: 'ai_model', asset_id: 'model-1' });
      expect(res.status).toBe(403);
      expect(res.body.blocked_by.message).toMatch(/not sanctioned/i);
    });
  });

  // Zapier -> IOA enforcement (proof-of-concept direction) — no
  // CONTAINMENT_STATE_QUERIES entry for zap either.
  describe('zap asset type', () => {
    it('evaluates and passes context through to evaluateZap', async () => {
      evaluateZap.mockResolvedValueOnce([]);
      pool.query.mockResolvedValueOnce({ rows: [] }); // bindings

      const res = await request(app).post('/enforce').send({
        asset_type: 'zap', asset_id: 'my-zap', context: { triggerApp: 'gmail', actionApp: 'slack' },
      });
      expect(res.status).toBe(200);
      expect(evaluateZap).toHaveBeenCalledWith('my-zap', { triggerApp: 'gmail', actionApp: 'slack' });
    });

    it('blocks when the auto-bound policy is in enforce mode and finds a violation', async () => {
      evaluateZap.mockResolvedValueOnce([]);
      pool.query
        .mockResolvedValueOnce({ rows: [BINDING('enforce', { policy_id: 'zap-policy', policy_name: 'Zapier Zap Execution Governance' })] })
        .mockResolvedValueOnce({ rows: [{ id: 'v-1', message: 'Zap "bad-zap" is on the blocked list' }] })
        .mockResolvedValueOnce({ rows: [{ id: 'event-1' }] });

      const res = await request(app).post('/enforce').send({ asset_type: 'zap', asset_id: 'bad-zap' });
      expect(res.status).toBe(403);
      expect(res.body.blocked_by.message).toMatch(/blocked list/i);
    });
  });

  // EP-203-S4
  describe('containment', () => {
    it('blocks outright when the asset is suspended, before evaluating any policy', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ containment_state: 'suspended' }] });

      const res = await request(app).post('/enforce').send({ asset_type: 'mcp_server', asset_id: 'srv-1' });
      expect(res.status).toBe(403);
      expect(res.body.decision).toBe('block');
      expect(res.body.reason).toBe('contained');
      expect(res.body.containment_state).toBe('suspended');
      expect(evaluateMcpServer).not.toHaveBeenCalled();
      expect(pool.query).toHaveBeenCalledTimes(1); // no bindings query, no enforcement_events write
    });

    it('blocks outright when the asset is quarantined', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ containment_state: 'quarantined' }] });

      const res = await request(app).post('/enforce').send({ asset_type: 'workflow', asset_id: 'wf-1' });
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('contained');
      expect(evaluateWorkflow).not.toHaveBeenCalled();
    });

    it('proceeds to normal policy evaluation when the asset is active', async () => {
      evaluateMcpServer.mockResolvedValueOnce([]);
      pool.query
        .mockResolvedValueOnce({ rows: [{ containment_state: 'active' }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app).post('/enforce').send({ asset_type: 'mcp_server', asset_id: 'srv-1' });
      expect(res.status).toBe(200);
      expect(res.body.decision).toBe('allow');
      expect(evaluateMcpServer).toHaveBeenCalled();
    });
  });
});

describe('GET /enforce', () => {
  it('lists events filtered by the given query params', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'event-1', outcome: 'block' }] });
    const res = await request(app).get('/enforce?policy_id=policy-1&outcome=block');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'event-1', outcome: 'block' }]);

    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('ee.policy_id = $1');
    expect(sql).toContain('ee.outcome = $2');
    expect(params).toEqual(['policy-1', 'block']);
  });

  it('caps an oversized limit at 500', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/enforce?limit=99999');
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('LIMIT 500');
  });
});

describe('GET /enforce/summary', () => {
  it('returns totals and a per-policy breakdown', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ total: '10', allow: '6', warn: '3', block: '1', last_24h: '4' }] })
      .mockResolvedValueOnce({ rows: [{ policy_id: 'policy-1', policy_name: 'Test Policy', enforcement_mode: 'enforce', total: '10', warn: '3', block: '1' }] });

    const res = await request(app).get('/enforce/summary');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe('10');
    expect(res.body.block).toBe('1');
    expect(res.body.by_policy).toHaveLength(1);
    expect(res.body.by_policy[0].policy_name).toBe('Test Policy');
  });
});

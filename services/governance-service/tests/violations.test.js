import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/lib/rule-evaluator.js', () => ({ evaluateWorkflow: vi.fn(), evaluateMcpServer: vi.fn(), evaluateAiModel: vi.fn(), evaluateZap: vi.fn() }));
vi.mock('../src/lib/agent-violation-recorder.js', () => ({ recordAgentSecurityEvent: vi.fn() }));
// Route tests exercise business logic, not auth — require-auth.js has its
// own dedicated conformance suite (tests/require-auth.test.js).
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
import pool from '../db.js';
import { evaluateWorkflow, evaluateMcpServer } from '../src/lib/rule-evaluator.js';
import { recordAgentSecurityEvent } from '../src/lib/agent-violation-recorder.js';
import app from '../index.js';

beforeEach(() => vi.clearAllMocks());

describe('GET /violations', () => {
  it('filters by entity_type and entity_id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/violations?entity_type=mcp_server&entity_id=srv-1');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('entity_type');
    expect(sql).toContain('entity_id');
    expect(params).toEqual(['mcp_server', 'srv-1']);
  });

  it('still filters by workflow_id (backward compatible)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/violations?workflow_id=wf-1');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('workflow_id');
    expect(params).toEqual(['wf-1']);
  });

  it('returns violations with no filters', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'v-1', entity_type: 'workflow', entity_id: 'wf-1' }] });
    const res = await request(app).get('/violations');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

// EP-103-S6
describe('GET /violations/:id/history', () => {
  it('returns the history timeline oldest first', async () => {
    const rows = [
      { id: 'h1', violation_id: 'v-1', prev_status: null, new_status: 'open', actor: 'system' },
      { id: 'h2', violation_id: 'v-1', prev_status: 'open', new_status: 'acknowledged', actor: 'jane' },
    ];
    pool.query.mockResolvedValueOnce({ rows });
    const res = await request(app).get('/violations/v-1/history');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toContain('ORDER BY changed_at ASC');
  });
});

describe('POST /violations/evaluate', () => {
  it('evaluates a workflow when workflow_id is given', async () => {
    evaluateWorkflow.mockResolvedValueOnce([{ id: 'v-1' }]);
    const res = await request(app).post('/violations/evaluate').send({ workflow_id: 'wf-1' });
    expect(res.status).toBe(201);
    expect(res.body.violations_created).toBe(1);
    expect(evaluateWorkflow).toHaveBeenCalledWith('wf-1');
    expect(evaluateMcpServer).not.toHaveBeenCalled();
  });

  // Epic 4, Feature 4.5 — evaluate an MCP server directly against policies
  // bound to it, independent of any workflow referencing it
  it('evaluates an MCP server directly when server_id is given', async () => {
    evaluateMcpServer.mockResolvedValueOnce([{ id: 'v-2', entity_type: 'mcp_server', entity_id: 'srv-1' }]);
    const res = await request(app).post('/violations/evaluate').send({ server_id: 'srv-1' });
    expect(res.status).toBe(201);
    expect(res.body.violations_created).toBe(1);
    expect(evaluateMcpServer).toHaveBeenCalledWith('srv-1');
    expect(evaluateWorkflow).not.toHaveBeenCalled();
  });

  it('rejects a request with neither workflow_id nor server_id', async () => {
    const res = await request(app).post('/violations/evaluate').send({});
    expect(res.status).toBe(400);
  });
});

// EP-204-S7/S8 — a service (require-auth.js's requirePermission, or
// mcp-governance-service's confused-deputy check) reports an agent-identity
// security event it just detected.
describe('POST /violations/agent-security-event', () => {
  it('returns 400 when agent_id is missing', async () => {
    const res = await request(app).post('/violations/agent-security-event').send({ rule_type: 'agent_privilege_escalation', message: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/agent_id/i);
  });

  it('returns 400 when rule_type is missing', async () => {
    const res = await request(app).post('/violations/agent-security-event').send({ agent_id: 'a1', message: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/rule_type/i);
  });

  it('returns 400 when message is missing', async () => {
    const res = await request(app).post('/violations/agent-security-event').send({ agent_id: 'a1', rule_type: 'agent_privilege_escalation' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/message/i);
  });

  it('records the event and returns 201 with the violation', async () => {
    recordAgentSecurityEvent.mockResolvedValueOnce({ id: 'violation-1', severity: 'critical' });
    const res = await request(app).post('/violations/agent-security-event').send({
      agent_id: 'a1', agent_name: 'test-agent', rule_type: 'agent_privilege_escalation', message: 'overreach',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('violation-1');
    expect(recordAgentSecurityEvent).toHaveBeenCalledWith({
      agentId: 'a1', agentName: 'test-agent', ruleType: 'agent_privilege_escalation', message: 'overreach',
    });
  });

  it('returns 400 when the recorder rejects an unknown rule_type', async () => {
    recordAgentSecurityEvent.mockRejectedValueOnce(new Error('Unknown agent security rule_type: bogus'));
    const res = await request(app).post('/violations/agent-security-event').send({ agent_id: 'a1', rule_type: 'bogus', message: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/unknown agent security rule_type/i);
  });
});

describe('PATCH /violations/:id/status', () => {
  it('rejects an invalid status', async () => {
    const res = await request(app).patch('/violations/v-1/status').send({ status: 'ignored' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown violation', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] }); // existing lookup
    const res = await request(app).patch('/violations/unknown/status').send({ status: 'acknowledged' });
    expect(res.status).toBe(404);
  });

  it('acknowledges a violation', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'open', policy_version: 1 }] })       // existing lookup
      .mockResolvedValueOnce({ rows: [{ id: 'v-1', status: 'acknowledged' }] })        // update
      .mockResolvedValueOnce({ rows: [] });                                            // history insert
    const res = await request(app).patch('/violations/v-1/status').send({ status: 'acknowledged' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('acknowledged');
  });

  // EP-104/EP-105-S1 — waiver states are reachable only through the waiver
  // routes (POST .../waivers, PATCH .../approve), not this generic endpoint.
  it('rejects waived_temporarily as a direct status value', async () => {
    const res = await request(app).patch('/violations/v-1/status').send({ status: 'waived_temporarily' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('status must be one of');
  });

  it('reopens a resolved violation', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'resolved', policy_version: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'v-1', status: 'open' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/violations/v-1/status').send({ status: 'open' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('open');
    const updateArgs = pool.query.mock.calls[1][1];
    expect(updateArgs[1]).toBeNull(); // resolved_at cleared on reopen
  });

  // EP-103-S1/S3 — every transition gets an append-only history row
  it('records prev_status, new_status, and actor in violation_history', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'open', policy_version: 3 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'v-1', status: 'acknowledged' }] })
      .mockResolvedValueOnce({ rows: [] });
    await request(app).patch('/violations/v-1/status').send({ status: 'acknowledged' });
    const historyInsert = pool.query.mock.calls.find(c => c[0].includes('violation_history'));
    expect(historyInsert[1]).toEqual(['v-1', 'open', 'acknowledged', 'unknown', null, 3, null]);
  });
});

// EP-105-S2
describe('dedicated lifecycle endpoints', () => {
  it('PATCH /:id/acknowledge transitions to acknowledged', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'open', policy_version: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'v-1', status: 'acknowledged' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/violations/v-1/acknowledge').send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('acknowledged');
  });

  it('PATCH /:id/remediating transitions to remediating', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'acknowledged', policy_version: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'v-1', status: 'remediating' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/violations/v-1/remediating').send({});
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('remediating');
  });

  it('PATCH /:id/resolve transitions to resolved with an optional reason', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'remediating', policy_version: 1 }] })
      .mockResolvedValueOnce({ rows: [{ id: 'v-1', status: 'resolved' }] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/violations/v-1/resolve').send({ resolution_reason: 'Patched the underlying issue' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('resolved');
  });

  it('returns 404 for an unknown violation on any dedicated endpoint', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/violations/unknown/acknowledge').send({});
    expect(res.status).toBe(404);
  });
});

// EP-104
describe('POST /violations/:id/waivers', () => {
  it('requires justification', async () => {
    const res = await request(app).post('/violations/v-1/waivers').send({ expires_at: '2026-08-01T00:00:00Z' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('justification');
  });

  it('requires expires_at', async () => {
    const res = await request(app).post('/violations/v-1/waivers').send({ justification: 'Compensating control in place' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('expires_at');
  });

  it('transitions the violation to waiver_requested and creates the waiver row', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ status: 'open', policy_version: 1 }] })             // transitionViolation: existing lookup
      .mockResolvedValueOnce({ rows: [{ id: 'v-1', status: 'waiver_requested', policy_id: 'pol-1' }] }) // transitionViolation: update
      .mockResolvedValueOnce({ rows: [] })                                                   // transitionViolation: history insert
      .mockResolvedValueOnce({ rows: [{ id: 'w-1', violation_id: 'v-1', status: 'pending' }] }); // waiver insert
    const res = await request(app).post('/violations/v-1/waivers').send({
      justification: 'Compensating control in place', expires_at: '2026-08-01T00:00:00Z',
    });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    const waiverInsert = pool.query.mock.calls.find(c => c[0].includes('INSERT INTO waivers'));
    expect(waiverInsert[1]).toEqual([
      'v-1', 'pol-1', 'Compensating control in place', null, null, 'unknown', null, '2026-08-01T00:00:00Z', 0, null, null,
    ]);
  });

  it('returns 404 for an unknown violation', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/violations/unknown/waivers').send({
      justification: 'x', expires_at: '2026-08-01T00:00:00Z',
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /violations/waivers/:id/approve', () => {
  it('rejects an invalid decision', async () => {
    const res = await request(app).patch('/violations/waivers/w-1/approve').send({ decision: 'maybe' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown waiver', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/violations/waivers/unknown/approve').send({ decision: 'approved' });
    expect(res.status).toBe(404);
  });

  it('rejects approval when the approver is the same as the requester', async () => {
    // require-auth.js is mocked to a no-op (see top of file) — the resolved
    // actor is always the 'unknown' fallback, so that's the requester here.
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'w-1', status: 'pending', requested_by: 'unknown', violation_id: 'v-1' }] });
    const res = await request(app).patch('/violations/waivers/w-1/approve').send({ decision: 'approved' });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('must be different');
  });

  it('rejects deciding an already-decided waiver', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'w-1', status: 'approved', requested_by: 'jane', violation_id: 'v-1' }] });
    const res = await request(app).patch('/violations/waivers/w-1/approve').send({ decision: 'denied' });
    expect(res.status).toBe(409);
  });

  it('approves a waiver and transitions the violation to waived_temporarily', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'w-1', status: 'pending', requested_by: 'jane', violation_id: 'v-1' }] }) // waiver lookup
      .mockResolvedValueOnce({ rows: [{ id: 'w-1', status: 'approved' }] })          // waiver update
      .mockResolvedValueOnce({ rows: [{ status: 'waiver_requested', policy_version: 1 }] }) // transitionViolation: existing lookup
      .mockResolvedValueOnce({ rows: [{ id: 'v-1', status: 'waived_temporarily' }] }) // transitionViolation: update
      .mockResolvedValueOnce({ rows: [] });                                          // transitionViolation: history insert
    const res = await request(app).patch('/violations/waivers/w-1/approve').send({ decision: 'approved' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('approved');
    const violationUpdate = pool.query.mock.calls.find(c => c[0].includes('UPDATE violations') && !c[0].includes('waivers'));
    expect(violationUpdate[1][0]).toBe('waived_temporarily');
  });
});

describe('GET /violations/waivers', () => {
  it('lists waivers ordered by expiry', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'w-1' }] });
    const res = await request(app).get('/violations/waivers');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(pool.query.mock.calls[0][0]).toContain('ORDER BY expires_at ASC');
  });

  it('filters by status and expiring_before', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/violations/waivers?status=pending&expiring_before=2026-08-01');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('status');
    expect(sql).toContain('expires_at');
    expect(params).toEqual(['pending', '2026-08-01']);
  });
});

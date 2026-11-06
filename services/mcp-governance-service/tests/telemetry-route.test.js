import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/lib/telemetry-client.js', () => ({
  default: { recordInvocationEvent: vi.fn().mockResolvedValue(undefined), queryInvocations: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../src/lib/governance-client.js', () => ({
  default: { reportAgentConfusedDeputy: vi.fn().mockResolvedValue(undefined) },
}));
// Route tests exercise business logic, not auth — require-auth.js has its
// own dedicated conformance suite (tests/require-auth.test.js). requireAuth
// itself is bypassed, but a test-only header lets the EP-204-S8 tests below
// simulate an agent-authenticated request (there's no other hook point to
// populate req.user before supertest dispatches the request).
vi.mock('../src/lib/require-auth.js', () => ({
  default: (req, _res, next) => {
    req.user = { id: 'user-1', username: 'test-user' };
    if (req.headers['x-test-delegation-id']) req.user.delegationId = req.headers['x-test-delegation-id'];
    if (req.headers['x-test-agent-id']) req.user.id = req.headers['x-test-agent-id'];
    next();
  },
  requirePermission: () => (_req, _res, next) => next(),
}));

import pool from '../db.js';
import telemetryClient from '../src/lib/telemetry-client.js';
import governanceClient from '../src/lib/governance-client.js';
import app from '../index.js';

const TOOL = { id: 'tool-1', name: 'search', server_id: 'srv-1' };

beforeEach(() => vi.clearAllMocks());

describe('POST /tools/:id/invocation-event', () => {
  it('rejects an invalid outcome', async () => {
    const res = await request(app).post('/tools/tool-1/invocation-event').send({ outcome: 'maybe' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown tool', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/tools/unknown/invocation-event').send({ outcome: 'success' });
    expect(res.status).toBe(404);
  });

  it('records a successful invocation and generates a correlation ID when none is given', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [TOOL] })       // tool lookup
      .mockResolvedValueOnce({ rows: [] });          // redaction patterns lookup

    const res = await request(app).post('/tools/tool-1/invocation-event').send({ outcome: 'success', duration_ms: 100 });
    expect(res.status).toBe(202);
    expect(res.body.recorded).toBe(true);
    expect(res.body.correlation_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(telemetryClient.recordInvocationEvent).toHaveBeenCalledWith(expect.objectContaining({
      serverId: 'srv-1', toolId: 'tool-1', toolName: 'search', outcome: 'success', durationMs: 100,
    }));
  });

  it('preserves a caller-supplied correlation ID', async () => {
    pool.query.mockResolvedValueOnce({ rows: [TOOL] }).mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/tools/tool-1/invocation-event').send({ outcome: 'denied', correlation_id: 'my-corr-id' });
    expect(res.body.correlation_id).toBe('my-corr-id');
  });

  // EP-102-S3 — a caller (e.g. workflow-governance-service, forwarding the
  // chain id from the workflow execution that triggered this tool call) that
  // sets x-correlation-id but doesn't repeat it in the body must still have
  // its chain honored, not overwritten by a disconnected freshly-minted id.
  it('continues an existing chain from the x-correlation-id header when the body omits correlation_id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [TOOL] }).mockResolvedValueOnce({ rows: [] });
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const res = await request(app)
      .post('/tools/tool-1/invocation-event')
      .set('x-correlation-id', id)
      .send({ outcome: 'success' });
    expect(res.body.correlation_id).toBe(id);
    expect(telemetryClient.recordInvocationEvent).toHaveBeenCalledWith(expect.objectContaining({ correlationId: id }));
  });

  // Epic 6, Feature 6.2 — arguments/output redacted before being forwarded,
  // never the raw value
  it('redacts a hardcoded credential in the tool arguments before forwarding', async () => {
    const key = 'sk-' + 'a'.repeat(40);
    pool.query.mockResolvedValueOnce({ rows: [TOOL] }).mockResolvedValueOnce({ rows: [] });

    await request(app).post('/tools/tool-1/invocation-event').send({
      outcome: 'success',
      arguments: { apiKey: key },
    });

    const call = telemetryClient.recordInvocationEvent.mock.calls[0][0];
    expect(JSON.stringify(call.redactedArguments)).not.toContain(key);
    expect(call.redactionApplied).toBe(true);
  });

  // EP-204-S8 — confused deputy: the agent's actual delegation record says
  // who really granted its authority; acting_for_user_id is what the
  // caller claims. A mismatch is the exact "one principal's authority for
  // another's request" pattern this story exists to catch.
  describe('confused-deputy detection (EP-204-S8)', () => {
    it('reports a violation when acting_for_user_id does not match the delegation record', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [TOOL] })                              // tool lookup
        .mockResolvedValueOnce({ rows: [{ initiating_user_id: 'user-a' }] })  // delegation lookup
        .mockResolvedValueOnce({ rows: [] });                                  // redaction patterns lookup

      await request(app)
        .post('/tools/tool-1/invocation-event')
        .set('x-test-delegation-id', 'delegation-1')
        .set('x-test-agent-id', 'agent:agent-1')
        .send({ outcome: 'success', acting_for_user_id: 'user-b' });

      expect(governanceClient.reportAgentConfusedDeputy).toHaveBeenCalledWith({
        agentId: 'agent-1', agentName: 'test-user', delegatedForUserId: 'user-a', actingForUserId: 'user-b',
      });
    });

    it('does not report anything when acting_for_user_id matches the delegation record', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [TOOL] })
        .mockResolvedValueOnce({ rows: [{ initiating_user_id: 'user-a' }] })
        .mockResolvedValueOnce({ rows: [] });

      await request(app)
        .post('/tools/tool-1/invocation-event')
        .set('x-test-delegation-id', 'delegation-1')
        .send({ outcome: 'success', acting_for_user_id: 'user-a' });

      expect(governanceClient.reportAgentConfusedDeputy).not.toHaveBeenCalled();
    });

    it('does not check anything when the request carries no delegationId (not an agent token)', async () => {
      pool.query.mockResolvedValueOnce({ rows: [TOOL] }).mockResolvedValueOnce({ rows: [] });

      await request(app).post('/tools/tool-1/invocation-event').send({ outcome: 'success', acting_for_user_id: 'user-b' });

      expect(governanceClient.reportAgentConfusedDeputy).not.toHaveBeenCalled();
      expect(pool.query).toHaveBeenCalledTimes(2); // tool lookup + redaction patterns only, no delegation lookup
    });

    it('does not throw when the delegation lookup itself fails', async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [TOOL] })
        .mockRejectedValueOnce(new Error('db unreachable'))
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app)
        .post('/tools/tool-1/invocation-event')
        .set('x-test-delegation-id', 'delegation-1')
        .send({ outcome: 'success', acting_for_user_id: 'user-b' });

      expect(res.status).toBe(202);
      expect(governanceClient.reportAgentConfusedDeputy).not.toHaveBeenCalled();
    });
  });
});

describe('GET /telemetry/mcp-invocations', () => {
  it('delegates to telemetryClient.queryInvocations with the query params', async () => {
    telemetryClient.queryInvocations.mockResolvedValueOnce([{ time: '2026-07-17T00:00:00Z' }]);
    const res = await request(app).get('/telemetry/mcp-invocations?server_id=srv-1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(telemetryClient.queryInvocations).toHaveBeenCalledWith(expect.objectContaining({ server_id: 'srv-1' }));
  });
});

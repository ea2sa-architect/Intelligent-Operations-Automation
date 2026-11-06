import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
// Route tests exercise business logic, not auth — require-auth.js has its own dedicated conformance suite (tests/require-auth.test.js).
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
// EP-102-S4/S5/S6 — avoid a real cross-service fetch to telemetry-service in route tests.
vi.mock('../src/lib/telemetry-client.js', () => ({
  default: { recordInferenceEvent: vi.fn().mockResolvedValue(undefined), recordPolicyDecisionEvent: vi.fn().mockResolvedValue(undefined) },
}));
// EP-201-S12/S13 — default to an allow decision so every pre-existing test
// below (written before enforcement existed) keeps passing unmodified;
// individual tests override this per-case with mockResolvedValueOnce.
vi.mock('../src/lib/governance-client.js', () => ({
  default: { checkEnforcement: vi.fn().mockResolvedValue({ status: 200, body: { decision: 'allow', warnings: [] } }) },
}));
// E7-S1.2 — default to no budget bound, same "pre-existing tests keep
// passing unmodified" trick governance-client.js uses above; individual
// tests override with mockResolvedValueOnce.
vi.mock('../src/lib/spend-check.js', () => ({
  default: { checkBudget: vi.fn().mockResolvedValue({ status: 'ok', budget: null, spent_usd: 0, limit_usd: null }) },
}));
// E7-S1.3
vi.mock('../src/lib/escalation-client.js', () => ({
  default: { createIncident: vi.fn().mockResolvedValue({ id: 'incident-1' }) },
}));
import pool from '../db.js';
import telemetryClient from '../src/lib/telemetry-client.js';
import governanceClient from '../src/lib/governance-client.js';
import spendCheck from '../src/lib/spend-check.js';
import escalationClient from '../src/lib/escalation-client.js';
import app from '../index.js';

const MODEL = { id: 'bbbbbbbb-0000-0000-0000-000000000001', status: 'active' };
const REQ = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  model_id: MODEL.id,
  input_hash: 'abc123',
  status: 'pending',
  created_at: '2026-05-11T00:00:00Z',
};
const DECISION = {
  id: 'cccccccc-0000-0000-0000-000000000001',
  inference_request_id: REQ.id,
  outcome: 'allow',
  confidence: 0.95,
  created_at: '2026-05-11T00:00:00Z',
};

beforeEach(() => vi.clearAllMocks());

describe('GET /inference', () => {
  it('returns list of inference requests', async () => {
    pool.query.mockResolvedValueOnce({ rows: [REQ] });
    const res = await request(app).get('/inference');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('filters by model_id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get(`/inference?model_id=${REQ.model_id}`);
    expect(pool.query.mock.calls[0][0]).toContain('model_id');
  });

  it('filters by status', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/inference?status=pending');
    expect(pool.query.mock.calls[0][0]).toContain('status');
  });
});

describe('GET /inference/decisions', () => {
  it('returns list of decisions', async () => {
    pool.query.mockResolvedValueOnce({ rows: [DECISION] });
    const res = await request(app).get('/inference/decisions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('filters by outcome', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/inference/decisions?outcome=allow');
    expect(pool.query.mock.calls[0][0]).toContain('outcome');
  });
});

describe('POST /inference', () => {
  it('creates an inference request', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [MODEL] })
      .mockResolvedValueOnce({ rows: [REQ] });
    const res = await request(app)
      .post('/inference')
      .send({ model_id: REQ.model_id, input: { prompt: 'hello' } });
    expect(res.status).toBe(202);
    expect(res.body.model_id).toBe(REQ.model_id);
  });

  it('returns 400 when model_id is missing', async () => {
    const res = await request(app).post('/inference').send({ input: { prompt: 'hello' } });
    expect(res.status).toBe(400);
  });

  it('returns 400 when input is missing', async () => {
    const res = await request(app).post('/inference').send({ model_id: REQ.model_id });
    expect(res.status).toBe(400);
  });

  it('returns 404 when model is not active', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post('/inference')
      .send({ model_id: REQ.model_id, input: { prompt: 'hello' } });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/model/i);
  });

  // EP-201-S12/S13 — governance-service's /enforce decision gates request
  // creation; docs/enforcement-adapter-contract.md.
  describe('governance enforcement', () => {
    it('blocks and never creates the request when governance-service returns block', async () => {
      pool.query.mockResolvedValueOnce({ rows: [MODEL] }); // model lookup only — no insert follows
      governanceClient.checkEnforcement.mockResolvedValueOnce({
        status: 403,
        body: { decision: 'block', blocked_by: { policy_name: 'AI Model Direct-Request Governance', message: 'Model "gpt-x" is not sanctioned' } },
      });
      const res = await request(app)
        .post('/inference')
        .send({ model_id: REQ.model_id, input: { prompt: 'hello' } });
      expect(res.status).toBe(403);
      expect(res.body.blocked_by.message).toMatch(/not sanctioned/i);
      expect(pool.query).toHaveBeenCalledTimes(1); // model lookup only
    });

    it('proceeds and sets X-IOA-Warning on a warn decision', async () => {
      pool.query.mockResolvedValueOnce({ rows: [MODEL] }).mockResolvedValueOnce({ rows: [REQ] });
      governanceClient.checkEnforcement.mockResolvedValueOnce({
        status: 200,
        body: { decision: 'warn', warnings: [{ policy_name: 'AI Model Direct-Request Governance' }] },
      });
      const res = await request(app)
        .post('/inference')
        .send({ model_id: REQ.model_id, input: { prompt: 'hello' } });
      expect(res.status).toBe(202);
      expect(res.headers['x-ioa-warning']).toContain('AI Model Direct-Request Governance');
    });

    it('fails closed (blocks) when governance-service is unreachable', async () => {
      pool.query.mockResolvedValueOnce({ rows: [MODEL] });
      governanceClient.checkEnforcement.mockResolvedValueOnce({
        status: 403,
        body: { decision: 'block', reason: 'governance-service unreachable' },
      });
      const res = await request(app)
        .post('/inference')
        .send({ model_id: REQ.model_id, input: { prompt: 'hello' } });
      expect(res.status).toBe(403);
      expect(res.body.reason).toBe('governance-service unreachable');
    });

    it('passes data_classification through to checkEnforcement', async () => {
      pool.query.mockResolvedValueOnce({ rows: [MODEL] }).mockResolvedValueOnce({ rows: [REQ] });
      await request(app)
        .post('/inference')
        .send({ model_id: REQ.model_id, input: { prompt: 'hello' }, data_classification: 'restricted' });
      expect(governanceClient.checkEnforcement).toHaveBeenCalledWith(
        expect.objectContaining({ modelId: REQ.model_id, dataClassification: 'restricted' })
      );
    });
  });

  // E7-S1.2 — a bound usage_budgets row gates request creation the
  // same way governance enforcement does above; work/epics/e1-ai-usage-budgets/design.md.
  describe('budget enforcement', () => {
    const HARD_BREACH = {
      status: 'breach',
      budget: { id: 'dddddddd-0000-0000-0000-000000000001', scope_type: 'user_id', scope_value: 'team-x', mode: 'hard' },
      spent_usd: 120, limit_usd: 100,
    };
    const SOFT_BREACH = {
      status: 'breach',
      budget: { id: 'eeeeeeee-0000-0000-0000-000000000001', scope_type: 'user_id', scope_value: 'team-x', mode: 'soft' },
      spent_usd: 120, limit_usd: 100,
    };

    it('blocks and never creates the request on a hard-mode breach', async () => {
      pool.query.mockResolvedValueOnce({ rows: [MODEL] }); // model lookup only — no insert follows
      spendCheck.checkBudget.mockResolvedValueOnce(HARD_BREACH);
      const res = await request(app)
        .post('/inference')
        .send({ model_id: REQ.model_id, input: { prompt: 'hello' }, user_id: 'team-x' });
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/usage budget/i);
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it('proceeds and sets X-IOA-Budget-Warning on a soft-mode breach', async () => {
      pool.query.mockResolvedValueOnce({ rows: [MODEL] }).mockResolvedValueOnce({ rows: [REQ] });
      spendCheck.checkBudget.mockResolvedValueOnce(SOFT_BREACH);
      const res = await request(app)
        .post('/inference')
        .send({ model_id: REQ.model_id, input: { prompt: 'hello' }, user_id: 'team-x' });
      expect(res.status).toBe(202);
      expect(res.headers['x-ioa-budget-warning']).toContain('team-x');
    });

    it('is unaffected when no budget is bound (default mock: status ok, budget null)', async () => {
      pool.query.mockResolvedValueOnce({ rows: [MODEL] }).mockResolvedValueOnce({ rows: [REQ] });
      const res = await request(app)
        .post('/inference')
        .send({ model_id: REQ.model_id, input: { prompt: 'hello' } });
      expect(res.status).toBe(202);
      expect(res.headers['x-ioa-budget-warning']).toBeUndefined();
    });

    // Lineage n8n-execution linkage — 005_n8n_execution_linkage.sql.
    it('persists n8n_execution_id and n8n_node_name when the caller supplies them', async () => {
      pool.query.mockResolvedValueOnce({ rows: [MODEL] }).mockResolvedValueOnce({ rows: [REQ] });
      await request(app)
        .post('/inference')
        .send({
          model_id: REQ.model_id, input: { prompt: 'hello' },
          n8n_execution_id: 'exec-4821', n8n_node_name: 'OpenAI — Summarize Invoice',
        });
      const insertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT INTO inference_requests'));
      expect(insertCall[1]).toContain('exec-4821');
      expect(insertCall[1]).toContain('OpenAI — Summarize Invoice');
    });

    it('checks every scope dimension present on the request, not just user_id', async () => {
      pool.query.mockResolvedValueOnce({ rows: [MODEL] }).mockResolvedValueOnce({ rows: [REQ] });
      await request(app)
        .post('/inference')
        .send({
          model_id: REQ.model_id, input: { prompt: 'hello' },
          user_id: 'team-x', service_id: 'svc-1', workflow_id: 'wf-1',
        });
      const scopeTypesChecked = spendCheck.checkBudget.mock.calls.map(([arg]) => arg.scopeType);
      expect(scopeTypesChecked).toEqual(
        expect.arrayContaining(['model_id', 'user_id', 'service_id', 'workflow_id'])
      );
    });
  });
});

describe('PUT /inference/:id', () => {
  it('transitions status to completed with latency', async () => {
    const updated = { ...REQ, status: 'completed', latency_ms: 42 };
    pool.query.mockResolvedValueOnce({ rows: [updated] });
    const res = await request(app)
      .put(`/inference/${REQ.id}`)
      .send({ status: 'completed', latency_ms: 42 });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
    expect(res.body.latency_ms).toBe(42);
  });

  it('transitions status to failed with error message', async () => {
    const updated = { ...REQ, status: 'failed', error_message: 'timeout' };
    pool.query.mockResolvedValueOnce({ rows: [updated] });
    const res = await request(app)
      .put(`/inference/${REQ.id}`)
      .send({ status: 'failed', error_message: 'timeout' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('failed');
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/inference/does-not-exist').send({ status: 'failed' });
    expect(res.status).toBe(404);
  });

  // EP-102-S4/S5 — a terminal status transition emits telemetry merging
  // request-scoped context (captured at POST / time) with completion metrics.
  it('emits a telemetry event on completion with token counts and cost', async () => {
    const updated = {
      ...REQ, status: 'completed', latency_ms: 42, model_name: 'gpt-4', provider: 'openai',
      input_tokens: 120, output_tokens: 45, estimated_cost_usd: 0.0031,
      prompt_template_version: 'v2', workflow_id: 'wf-1',
    };
    pool.query.mockResolvedValueOnce({ rows: [updated] });
    const res = await request(app)
      .put(`/inference/${REQ.id}`)
      .send({ status: 'completed', latency_ms: 42, input_tokens: 120, output_tokens: 45, estimated_cost_usd: 0.0031 });
    expect(res.status).toBe(200);
    expect(telemetryClient.recordInferenceEvent).toHaveBeenCalledWith(expect.objectContaining({
      modelId: REQ.model_id, modelName: 'gpt-4', provider: 'openai',
      status: 'completed', inputTokens: 120, outputTokens: 45, estimatedCostUsd: 0.0031,
      promptTemplateVersion: 'v2', workflowId: 'wf-1',
    }));
  });

  // Lineage n8n-execution linkage — merges the identifiers captured at
  // POST / time (request-scoped) into the completion-time telemetry event,
  // same pattern as workflow_id/prompt_template_version above.
  it('forwards n8n_execution_id and n8n_node_name to the telemetry event on completion', async () => {
    const updated = { ...REQ, status: 'completed', n8n_execution_id: 'exec-4821', n8n_node_name: 'OpenAI — Summarize Invoice' };
    pool.query.mockResolvedValueOnce({ rows: [updated] });
    await request(app).put(`/inference/${REQ.id}`).send({ status: 'completed' });
    expect(telemetryClient.recordInferenceEvent).toHaveBeenCalledWith(expect.objectContaining({
      n8nExecutionId: 'exec-4821', n8nNodeName: 'OpenAI — Summarize Invoice',
    }));
  });

  it('does not emit telemetry for a non-terminal status update', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...REQ, status: 'pending', latency_ms: 10 }] });
    await request(app).put(`/inference/${REQ.id}`).send({ latency_ms: 10 });
    expect(telemetryClient.recordInferenceEvent).not.toHaveBeenCalled();
  });

  // E7-S1.3 — a completion whose realized cost pushes a scope over
  // budget files an incident; never blocks (S1.2 already gated at POST /).
  describe('budget breach escalation', () => {
    const updated = { ...REQ, status: 'completed', user_id: 'team-x', estimated_cost_usd: 30 };

    it('files an incident (severity=high) when completion pushes a hard-mode budget into breach', async () => {
      pool.query.mockResolvedValueOnce({ rows: [updated] });
      spendCheck.checkBudget.mockResolvedValueOnce({
        status: 'breach',
        budget: { id: 'b-1', scope_type: 'user_id', scope_value: 'team-x', mode: 'hard' },
        spent_usd: 120, limit_usd: 100,
      });
      const res = await request(app).put(`/inference/${REQ.id}`).send({ status: 'completed', estimated_cost_usd: 30 });
      expect(res.status).toBe(200); // never blocks
      expect(escalationClient.createIncident).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'high' })
      );
    });

    it('files an incident (severity=medium) on a soft-mode breach', async () => {
      pool.query.mockResolvedValueOnce({ rows: [updated] });
      spendCheck.checkBudget.mockResolvedValueOnce({
        status: 'breach',
        budget: { id: 'b-2', scope_type: 'user_id', scope_value: 'team-x', mode: 'soft' },
        spent_usd: 120, limit_usd: 100,
      });
      await request(app).put(`/inference/${REQ.id}`).send({ status: 'completed', estimated_cost_usd: 30 });
      expect(escalationClient.createIncident).toHaveBeenCalledWith(
        expect.objectContaining({ severity: 'medium' })
      );
    });

    it('does not file an incident when spend stays under budget', async () => {
      pool.query.mockResolvedValueOnce({ rows: [updated] });
      spendCheck.checkBudget.mockResolvedValueOnce({
        status: 'ok', budget: { id: 'b-3', mode: 'soft' }, spent_usd: 40, limit_usd: 100,
      });
      await request(app).put(`/inference/${REQ.id}`).send({ status: 'completed', estimated_cost_usd: 30 });
      expect(escalationClient.createIncident).not.toHaveBeenCalled();
    });

    it('does not file an incident when no budget is bound (default mock)', async () => {
      pool.query.mockResolvedValueOnce({ rows: [updated] });
      await request(app).put(`/inference/${REQ.id}`).send({ status: 'completed', estimated_cost_usd: 30 });
      expect(escalationClient.createIncident).not.toHaveBeenCalled();
    });

    it('still returns 200 even if escalation-client itself fails soft (returns null)', async () => {
      pool.query.mockResolvedValueOnce({ rows: [updated] });
      spendCheck.checkBudget.mockResolvedValueOnce({
        status: 'breach',
        budget: { id: 'b-4', scope_type: 'user_id', scope_value: 'team-x', mode: 'hard' },
        spent_usd: 120, limit_usd: 100,
      });
      escalationClient.createIncident.mockResolvedValueOnce(null);
      const res = await request(app).put(`/inference/${REQ.id}`).send({ status: 'completed', estimated_cost_usd: 30 });
      expect(res.status).toBe(200);
    });

    it('does not check budget or escalate for a non-terminal status update', async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ ...REQ, status: 'pending' }] });
      await request(app).put(`/inference/${REQ.id}`).send({ latency_ms: 10 });
      expect(escalationClient.createIncident).not.toHaveBeenCalled();
    });
  });
});

describe('GET /inference/:id', () => {
  it('returns request with decisions', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [REQ] })
      .mockResolvedValueOnce({ rows: [DECISION] });
    const res = await request(app).get(`/inference/${REQ.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(REQ.id);
    expect(res.body.decisions).toHaveLength(1);
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/inference/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('POST /inference/:id/decisions', () => {
  it('records a decision and marks request completed', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [DECISION] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app)
      .post(`/inference/${REQ.id}/decisions`)
      .send({ outcome: 'allow', confidence: 0.95 });
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe('allow');
  });

  it('returns 400 when outcome is missing', async () => {
    const res = await request(app)
      .post(`/inference/${REQ.id}/decisions`)
      .send({ confidence: 0.9 });
    expect(res.status).toBe(400);
  });

  // EP-102-S6
  it('emits a policy_decision telemetry event', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [DECISION] })
      .mockResolvedValueOnce({ rows: [{ model_id: REQ.model_id }] });
    await request(app)
      .post(`/inference/${REQ.id}/decisions`)
      .send({ outcome: 'allow', confidence: 0.95, policy_id: 'pol-1' });
    expect(telemetryClient.recordPolicyDecisionEvent).toHaveBeenCalledWith(expect.objectContaining({
      modelId: REQ.model_id, inferenceRequestId: REQ.id, policyId: 'pol-1', outcome: 'allow', confidence: 0.95,
    }));
  });
});

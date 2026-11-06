import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../src/lib/cache.js', () => ({
  default: { get: vi.fn().mockResolvedValue(null), set: vi.fn(), del: vi.fn(), TTL: { METADATA: 300, RISK: 3600, LIST: 300 } },
}));
vi.mock('../src/lib/n8n-client.js', () => ({
  default: { listWorkflows: vi.fn(), getWorkflow: vi.fn(), getExecutions: vi.fn(), listProjects: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../src/lib/mcp-governance-client.js', () => ({
  default: { resolveServerReference: vi.fn().mockResolvedValue({ registered: false }), fetchServerDetail: vi.fn().mockResolvedValue(null) },
}));
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));

import pool from '../db.js';
import app from '../index.js';

function mockClient() {
  const client = { query: vi.fn().mockResolvedValue({ rows: [] }), release: vi.fn() };
  pool.connect.mockResolvedValue(client);
  return client;
}

beforeEach(() => vi.clearAllMocks());

describe('POST /workflows/analyze/callback/:job_id', () => {
  it('persists the analysis payload unchanged when it contains no secrets', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'job-1', workflow_id: 'wf-1', status: 'pending' }] });
    const client = mockClient();

    const res = await request(app)
      .post('/workflows/analyze/callback/job-1')
      .send({ analysis: { summary: 'Looks fine', risk_notes: [] } });

    expect(res.status).toBe(200);
    const updateCall = client.query.mock.calls.find(c => c[0].includes('SET status'));
    expect(updateCall[1][0]).toEqual({ summary: 'Looks fine', risk_notes: [] });
    // No secret findings → no insert into workflow_secret_exposure
    expect(client.query.mock.calls.some(c => c[0].includes('workflow_secret_exposure'))).toBe(false);
  });

  it('redacts a hardcoded secret in the analysis payload before persisting and records the finding', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'job-2', workflow_id: 'wf-2', status: 'pending' }] });
    const client = mockClient();
    const rawKey = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0'.repeat(2);

    const res = await request(app)
      .post('/workflows/analyze/callback/job-2')
      .send({ analysis: { summary: `Found key ${rawKey} in a Set node` } });

    expect(res.status).toBe(200);
    const updateCall = client.query.mock.calls.find(c => c[0].includes('SET status'));
    expect(JSON.stringify(updateCall[1][0])).not.toContain(rawKey);

    const exposureCall = client.query.mock.calls.find(c => c[0].includes('workflow_secret_exposure'));
    expect(exposureCall).toBeTruthy();
    expect(exposureCall[1]).toEqual(['wf-2', 'openai_key', 'ai_analysis_callback', expect.any(String), expect.any(String)]);
  });

  it('returns 404 for an unknown job', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/workflows/analyze/callback/nope').send({ analysis: {} });
    expect(res.status).toBe(404);
  });

  it('returns 409 for a job already in a terminal state', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'job-3', workflow_id: 'wf-3', status: 'completed' }] });
    const res = await request(app).post('/workflows/analyze/callback/job-3').send({ analysis: {} });
    expect(res.status).toBe(409);
  });
});

describe('POST /workflows/analyze/callback/:job_id — EP-310-S1/S2 signature + timestamp', () => {
  const TEST_SECRET = 'ioa-test-webhook-secret';

  function sign(body) {
    return 'sha256=' + createHmac('sha256', TEST_SECRET)
      .update(JSON.stringify(body))
      .digest('hex');
  }

  function validHeaders(body) {
    return { 'X-IOA-Signature': sign(body), 'X-IOA-Timestamp': String(Date.now()) };
  }

  beforeEach(() => vi.stubEnv('N8N_WEBHOOK_SECRET', TEST_SECRET));
  afterEach(() => vi.unstubAllEnvs());

  it('returns 401 when X-IOA-Timestamp header is absent', async () => {
    const body = { analysis: { summary: 'test' } };
    const res = await request(app)
      .post('/workflows/analyze/callback/sig-job-1')
      .set('X-IOA-Signature', sign(body))
      .send(body);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Timestamp/i);
  });

  it('returns 401 when X-IOA-Timestamp is outside the 5-minute window', async () => {
    const body = { analysis: { summary: 'test' } };
    const staleTs = String(Date.now() - 6 * 60 * 1000); // 6 min ago
    const res = await request(app)
      .post('/workflows/analyze/callback/sig-job-2')
      .set('X-IOA-Signature', sign(body))
      .set('X-IOA-Timestamp', staleTs)
      .send(body);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/window/i);
  });

  it('returns 401 when X-IOA-Signature header is absent', async () => {
    const res = await request(app)
      .post('/workflows/analyze/callback/sig-job-3')
      .set('X-IOA-Timestamp', String(Date.now()))
      .send({ analysis: { summary: 'test' } });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Signature/i);
  });

  it('returns 401 when X-IOA-Signature is incorrect', async () => {
    const res = await request(app)
      .post('/workflows/analyze/callback/sig-job-4')
      .set('X-IOA-Timestamp', String(Date.now()))
      .set('X-IOA-Signature', 'sha256=badhash')
      .send({ analysis: { summary: 'test' } });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Invalid/i);
  });

  it('proceeds to the handler when both timestamp and signature are valid', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'sig-job-5', workflow_id: 'wf-sig', status: 'pending' }] });
    const client = mockClient();

    const body = { analysis: { summary: 'Signed callback from n8n' } };
    const res = await request(app)
      .post('/workflows/analyze/callback/sig-job-5')
      .set(validHeaders(body))
      .send(body);

    expect(res.status).toBe(200);
    expect(client.query.mock.calls.find(c => c[0].includes('SET status'))).toBeTruthy();
  });

  it('passes through without headers when N8N_WEBHOOK_SECRET is unset', async () => {
    vi.unstubAllEnvs();
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'sig-job-6', workflow_id: 'wf-open', status: 'pending' }] });
    mockClient();

    const res = await request(app)
      .post('/workflows/analyze/callback/sig-job-6')
      .send({ analysis: { summary: 'Unsigned, secret not configured' } });

    expect(res.status).toBe(200);
  });
});

import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
// EP-101-S5 — avoid a real cross-service fetch to governance-service in route tests.
vi.mock('../src/lib/governance-client.js', () => ({ default: { evaluateServer: vi.fn(), recordApprovalDecision: vi.fn() } }));
import pool from '../db.js';
import governanceClient from '../src/lib/governance-client.js';
import app from '../index.js';

beforeEach(() => vi.clearAllMocks());

describe('POST /servers/:serverId/prompts', () => {
  it('registers a prompt', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'summarizer', approval_status: 'pending' }] });
    const res = await request(app).post('/servers/srv-1/prompts').send({ name: 'summarizer', embedded_instructions: 'Summarize the input.' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('summarizer');
    expect(res.body.credential_exposure_detected).toBe(false);
  });

  it('rejects a missing name', async () => {
    const res = await request(app).post('/servers/srv-1/prompts').send({});
    expect(res.status).toBe(400);
  });

  // EP-101-S4 — prompts.js previously never scanned for hardcoded credentials
  it('redacts a hardcoded secret in embedded_instructions and records the finding', async () => {
    const rawKey = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0'.repeat(2);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 'p1', name: 'summarizer', approval_status: 'pending' }] }) // insert prompt
      .mockResolvedValueOnce({ rows: [] }) // delete existing findings
      .mockResolvedValueOnce({ rows: [] }); // insert finding

    const res = await request(app)
      .post('/servers/srv-1/prompts')
      .send({ name: 'summarizer', embedded_instructions: `Authenticate with ${rawKey}` });

    expect(res.status).toBe(201);
    expect(res.body.credential_exposure_detected).toBe(true);

    const insertArgs = pool.query.mock.calls[0][1];
    expect(insertArgs[5]).not.toContain(rawKey); // embedded_instructions param

    const findingInsert = pool.query.mock.calls.find(c => c[0].includes('INSERT INTO mcp_governance.mcp_credential_exposure'));
    expect(findingInsert[1]).toEqual(['srv-1', 'p1', 'embedded_instructions', 'openai_key', expect.any(String), expect.any(String), null, null]);
    expect(governanceClient.evaluateServer).toHaveBeenCalledWith('srv-1');
  });
});

describe('PATCH /prompts/:id/approval', () => {
  it('updates approval status', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'p1', approval_status: 'allowed' }] });
    const res = await request(app).patch('/prompts/p1/approval').send({ approval_status: 'allowed' });
    expect(res.status).toBe(200);
    expect(res.body.approval_status).toBe('allowed');
  });

  // EP-103-S2/S3 — mcp_prompts has no local decision-history table, so this
  // is the only place the decision is preserved.
  it('mirrors the decision into governance-service via recordApprovalDecision', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'p1', approval_status: 'allowed' }] });
    await request(app).patch('/prompts/p1/approval').send({ approval_status: 'allowed' });
    expect(governanceClient.recordApprovalDecision).toHaveBeenCalledWith(expect.objectContaining({
      assetType: 'mcp_prompt', assetId: 'p1', decision: 'allowed',
    }));
  });

  it('rejects an invalid approval status', async () => {
    const res = await request(app).patch('/prompts/p1/approval').send({ approval_status: 'nope' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown prompt', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/prompts/unknown/approval').send({ approval_status: 'allowed' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /prompts/:id', () => {
  it('deletes a prompt', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(app).delete('/prompts/p1');
    expect(res.status).toBe(204);
  });

  it('returns 404 for an unknown prompt', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(app).delete('/prompts/unknown');
    expect(res.status).toBe(404);
  });
});

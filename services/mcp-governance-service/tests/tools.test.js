import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
// Route tests exercise business logic, not auth — require-auth.js has its own dedicated conformance suite (tests/require-auth.test.js).
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
// EP-101-S5 — avoid a real cross-service fetch to governance-service in route tests.
vi.mock('../src/lib/governance-client.js', () => ({ default: { evaluateServer: vi.fn(), recordApprovalDecision: vi.fn() } }));
import pool from '../db.js';
import governanceClient from '../src/lib/governance-client.js';
import app from '../index.js';

beforeEach(() => vi.clearAllMocks());

describe('POST /servers/:serverId/tools', () => {
  it('registers a tool as pending by default (deny-by-default)', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 't1', name: 'search', approval_status: 'pending' }] });
    const res = await request(app).post('/servers/srv-1/tools').send({ name: 'search', behavior: 'read' });
    expect(res.status).toBe(201);
    expect(res.body.approval_status).toBe('pending');
    // definition_hash is always server-computed, never trusts a client-supplied value
    const insertArgs = pool.query.mock.calls[0][1];
    expect(insertArgs[12]).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects an invalid classification', async () => {
    const res = await request(app).post('/servers/srv-1/tools').send({ name: 'x', classification: 'T9' });
    expect(res.status).toBe(400);
  });

  // EP-101-S4 — tools.js previously never scanned for hardcoded credentials
  it('redacts a hardcoded secret in the description and records the finding', async () => {
    const rawKey = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0'.repeat(2);
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 't1', name: 'search', approval_status: 'pending' }] }) // insert tool
      .mockResolvedValueOnce({ rows: [] }) // delete existing findings
      .mockResolvedValueOnce({ rows: [] }); // insert finding

    const res = await request(app).post('/servers/srv-1/tools').send({ name: 'search', description: `uses key ${rawKey}` });
    expect(res.status).toBe(201);
    expect(res.body.credential_exposure_detected).toBe(true);

    const insertArgs = pool.query.mock.calls[0][1];
    expect(insertArgs[2]).not.toContain(rawKey); // description param

    const findingInsert = pool.query.mock.calls.find(c => c[0].includes('INSERT INTO mcp_governance.mcp_credential_exposure'));
    expect(findingInsert[1]).toEqual(['srv-1', 't1', 'description', 'openai_key', expect.any(String), expect.any(String), null, null]);
    expect(governanceClient.evaluateServer).toHaveBeenCalledWith('srv-1');
  });

  it('does not flag a tool with no secret-shaped values', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 't1', name: 'search', approval_status: 'pending' }] }) // insert tool
      .mockResolvedValueOnce({ rows: [] }); // existing findings (none)
    const res = await request(app).post('/servers/srv-1/tools').send({ name: 'search', description: 'searches records' });
    expect(res.status).toBe(201);
    expect(res.body.credential_exposure_detected).toBe(false);
    // description was scanned (field was present) so the table is still
    // touched — to clear any stale finding — but nothing gets inserted.
    expect(pool.query.mock.calls.some(c => c[0].includes('INSERT INTO mcp_governance.mcp_credential_exposure'))).toBe(false);
  });

  // Epic 3, Feature 3.1 — original classification retained via decision history
  it('records the initial classification in decision history when one is provided', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 't1', name: 'search', approval_status: 'pending', classification: 'T2' }] })
      .mockResolvedValueOnce({ rows: [] }); // decision history insert

    const res = await request(app).post('/servers/srv-1/tools').send({ name: 'search', classification: 'T2' });
    expect(res.status).toBe(201);
    const historyInsert = pool.query.mock.calls.find(c => c[0].includes('mcp_tool_decision_history'));
    expect(historyInsert[1]).toEqual(['t1', 'T2']);
  });

  it('does not write decision history when no classification is given at registration', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 't1', name: 'search', approval_status: 'pending' }] });
    await request(app).post('/servers/srv-1/tools').send({ name: 'search' });
    expect(pool.query).toHaveBeenCalledTimes(1);
  });
});

describe('PATCH /tools/:id/approval', () => {
  it('allows a tool', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ approval_status: 'pending' }] }) // existing lookup
      .mockResolvedValueOnce({ rows: [{ id: 't1', approval_status: 'allowed' }] }) // update
      .mockResolvedValueOnce({ rows: [] }); // decision history insert
    const res = await request(app).patch('/tools/t1/approval').send({ approval_status: 'allowed' });
    expect(res.status).toBe(200);
    expect(res.body.approval_status).toBe('allowed');
  });

  it('rejects an invalid approval_status', async () => {
    const res = await request(app).patch('/tools/t1/approval').send({ approval_status: 'sort-of' });
    expect(res.status).toBe(400);
  });

  // Epic 3, Feature 3.2 — deny-by-default tool approval, with a required reason on denial
  it('requires a reason when denying a tool', async () => {
    const res = await request(app).patch('/tools/t1/approval').send({ approval_status: 'denied' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('reason is required');
  });

  it('denies a tool and records the reason in decision history', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ approval_status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [{ id: 't1', approval_status: 'denied' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).patch('/tools/t1/approval').send({ approval_status: 'denied', reason: 'Excessive filesystem write scope' });
    expect(res.status).toBe(200);
    const historyInsert = pool.query.mock.calls.find(c => c[0].includes('mcp_tool_decision_history'));
    expect(historyInsert[1]).toEqual(['t1', 'pending', 'denied', 'Excessive filesystem write scope']);
  });

  it('returns 404 for an unknown tool', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/tools/unknown/approval').send({ approval_status: 'allowed' });
    expect(res.status).toBe(404);
  });

  // EP-103-S2/S3
  it('mirrors the decision into governance-service via recordApprovalDecision', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ approval_status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [{ id: 't1', approval_status: 'denied' }] })
      .mockResolvedValueOnce({ rows: [] });
    await request(app).patch('/tools/t1/approval').send({ approval_status: 'denied', reason: 'Excessive filesystem write scope' });
    expect(governanceClient.recordApprovalDecision).toHaveBeenCalledWith(expect.objectContaining({
      assetType: 'mcp_tool', assetId: 't1', decision: 'denied', supportingEvidence: 'Excessive filesystem write scope',
    }));
  });

  // EP-105-S4/S5 — denying is a revocation and must re-evaluate the owning
  // server's policies immediately.
  it("re-evaluates the owning server's policies after a decision", async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ approval_status: 'pending' }] })
      .mockResolvedValueOnce({ rows: [{ id: 't1', server_id: 'srv-1', approval_status: 'denied' }] })
      .mockResolvedValueOnce({ rows: [] });
    await request(app).patch('/tools/t1/approval').send({ approval_status: 'denied', reason: 'Excessive filesystem write scope' });
    expect(governanceClient.evaluateServer).toHaveBeenCalledWith('srv-1');
  });
});

describe('GET /tools/:id/decision-history', () => {
  it('returns the decision history in chronological order', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ decision_type: 'classification', from_value: null, to_value: 'T2' }] });
    const res = await request(app).get('/tools/t1/decision-history');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(pool.query.mock.calls[0][0]).toContain('ORDER BY changed_at ASC');
  });
});

describe('GET /tools/:id/definition-history', () => {
  it('returns previous definition snapshots, most recent first', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ description: 'original description', definition_hash: 'old-hash' }] });
    const res = await request(app).get('/tools/t1/definition-history');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(pool.query.mock.calls[0][0]).toContain('ORDER BY superseded_at DESC');
  });
});

describe('PUT /tools/:id — definition drift', () => {
  it('reverts an allowed tool to pending when its description changes', async () => {
    const existing = {
      id: 't1', server_id: 'srv-1', name: 'search', description: 'original description',
      input_schema_json: null, output_schema_json: null, approval_status: 'allowed',
      definition_hash: 'stale-hash-that-will-not-match',
    };
    pool.query
      .mockResolvedValueOnce({ rows: [existing] }) // fetch existing
      .mockResolvedValueOnce({ rows: [{ ...existing, description: 'a new description', approval_status: 'pending' }] }) // update
      .mockResolvedValueOnce({ rows: [] }) // definition history insert (Feature 3.3)
      .mockResolvedValueOnce({ rows: [] }); // existing credential findings (none)

    const res = await request(app).put('/tools/t1').send({ description: 'a new description' });
    expect(res.status).toBe(200);
    expect(res.body.definition_drifted).toBe(true);
    // the UPDATE call's approval_status param must be 'pending', not 'allowed'
    const updateArgs = pool.query.mock.calls[1][1];
    expect(updateArgs).toContain('pending');
    // last_drift_detected_at's CASE param (drifted boolean) must be true —
    // this is what lets Feature 5.2's trust-ceiling logic distinguish
    // "reverted due to drift" from "never yet reviewed"
    expect(updateArgs).toContain(true);

    // Epic 3, Feature 3.3 — the OLD definition (not the new one) is snapshotted
    const historyInsert = pool.query.mock.calls.find(c => c[0].includes('mcp_tool_definition_history'));
    expect(historyInsert[1]).toEqual(['t1', 'original description', null, null, 'stale-hash-that-will-not-match', null]);
  });

  it('does not touch approval_status when nothing meaningful changed', async () => {
    const existing = {
      id: 't1', server_id: 'srv-1', name: 'search', description: 'same description',
      input_schema_json: null, output_schema_json: null, approval_status: 'allowed',
    };
    // First call computes the real hash for "same description" so the second
    // PUT (no changes) recomputes an identical hash and shouldn't drift.
    const crypto = await import('crypto');
    const hash = crypto.createHash('sha256')
      .update(JSON.stringify({ description: 'same description', input_schema_json: null, output_schema_json: null }))
      .digest('hex');
    existing.definition_hash = hash;

    pool.query
      .mockResolvedValueOnce({ rows: [existing] })
      .mockResolvedValueOnce({ rows: [{ ...existing, approval_status: 'allowed' }] });

    const res = await request(app).put('/tools/t1').send({});
    expect(res.status).toBe(200);
    expect(res.body.definition_drifted).toBe(false);
    const updateArgs = pool.query.mock.calls[1][1];
    expect(updateArgs).toContain('allowed');
    // EP-105-S4 — re-evaluated regardless of whether anything drifted
    expect(governanceClient.evaluateServer).toHaveBeenCalledWith('srv-1');
  });

  it('returns 404 for an unknown tool', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/tools/unknown').send({ description: 'x' });
    expect(res.status).toBe(404);
  });

  // Epic 3, Feature 3.1 — classification override requires a reason
  it('rejects overriding an existing classification without a reason', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 't1', classification: 'T1', approval_status: 'pending', description: 'x', definition_hash: 'h' }] });
    const res = await request(app).put('/tools/t1').send({ classification: 'T3' });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('classification_reason is required');
  });

  it('overrides an existing classification with a reason and records it in decision history', async () => {
    const existing = { id: 't1', classification: 'T1', approval_status: 'pending', description: 'x', input_schema_json: null, output_schema_json: null, definition_hash: null };
    pool.query
      .mockResolvedValueOnce({ rows: [existing] })
      .mockResolvedValueOnce({ rows: [{ ...existing, classification: 'T3' }] })
      .mockResolvedValueOnce({ rows: [] }); // classification decision history insert

    const res = await request(app).put('/tools/t1').send({ classification: 'T3', classification_reason: 'Re-reviewed: tool can delete records' });
    expect(res.status).toBe(200);
    const historyInsert = pool.query.mock.calls.find(c => c[0].includes('mcp_tool_decision_history'));
    expect(historyInsert[1]).toEqual(['t1', 'T1', 'T3', 'Re-reviewed: tool can delete records']);
    // EP-103-S2/S3 — classification change is mirrored too
    expect(governanceClient.recordApprovalDecision).toHaveBeenCalledWith(expect.objectContaining({
      assetType: 'mcp_tool', assetId: 't1', decision: 'classification:T3', supportingEvidence: 'Re-reviewed: tool can delete records',
    }));
  });

  it('does not require a reason when classifying a tool for the first time', async () => {
    const existing = { id: 't1', classification: null, approval_status: 'pending', description: 'x', input_schema_json: null, output_schema_json: null, definition_hash: null };
    pool.query
      .mockResolvedValueOnce({ rows: [existing] })
      .mockResolvedValueOnce({ rows: [{ ...existing, classification: 'T0' }] })
      .mockResolvedValueOnce({ rows: [] });

    const res = await request(app).put('/tools/t1').send({ classification: 'T0' });
    expect(res.status).toBe(200);
    const historyInsert = pool.query.mock.calls.find(c => c[0].includes('mcp_tool_decision_history'));
    expect(historyInsert[1]).toEqual(['t1', null, 'T0', null]);
  });

  // EP-101-S4
  it('redacts a hardcoded secret in an updated description and records the finding', async () => {
    const rawKey = 'sk-' + 'a1B2c3D4e5F6g7H8i9J0'.repeat(2);
    const existing = {
      id: 't1', server_id: 'srv-1', name: 'search', description: 'original description',
      input_schema_json: null, output_schema_json: null, approval_status: 'pending',
      definition_hash: 'irrelevant',
    };
    pool.query
      .mockResolvedValueOnce({ rows: [existing] }) // fetch existing
      .mockResolvedValueOnce({ rows: [{ ...existing, description: '[redacted]' }] }) // update
      .mockResolvedValueOnce({ rows: [] }) // definition history insert (drifted)
      .mockResolvedValueOnce({ rows: [] }) // delete existing findings
      .mockResolvedValueOnce({ rows: [] }); // insert finding

    const res = await request(app).put('/tools/t1').send({ description: `uses key ${rawKey}` });
    expect(res.status).toBe(200);
    expect(res.body.credential_exposure_detected).toBe(true);

    const findingInsert = pool.query.mock.calls.find(c => c[0].includes('INSERT INTO mcp_governance.mcp_credential_exposure'));
    expect(findingInsert[1]).toEqual(['srv-1', 't1', 'description', 'openai_key', expect.any(String), expect.any(String), null, null]);
    expect(governanceClient.evaluateServer).toHaveBeenCalledWith('srv-1');
  });
});

// EP-103-S4/S5 — mcp_tool_decision_history/mcp_tool_definition_history are
// append-only at the DB level; a tool with any history can no longer cascade-delete.
describe('DELETE /tools/:id', () => {
  it('deletes a tool with no history', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })          // history check — none
      .mockResolvedValueOnce({ rowCount: 1 });      // delete
    const res = await request(app).delete('/tools/t1');
    expect(res.status).toBe(204);
  });

  it('rejects deletion with 409 when decision or definition history exists', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] }); // history check — found
    const res = await request(app).delete('/tools/t1');
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('append-only');
  });

  it('returns 404 for an unknown tool', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [] })          // history check — none
      .mockResolvedValueOnce({ rowCount: 0 });      // delete — nothing matched
    const res = await request(app).delete('/tools/unknown');
    expect(res.status).toBe(404);
  });
});

// EP-203
describe('POST /tools/:id/containment', () => {
  it('sets containment_state with no Kong side effect', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 't1', containment_state: 'suspended' }] });
    const res = await request(app).post('/tools/t1/containment').send({ containment_state: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.containment_state).toBe('suspended');
  });

  it('rejects an invalid containment_state', async () => {
    const res = await request(app).post('/tools/t1/containment').send({ containment_state: 'disabled' });
    expect(res.status).toBe(400);
  });

  it('returns 404 for an unknown tool', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/tools/unknown/containment').send({ containment_state: 'suspended' });
    expect(res.status).toBe(404);
  });
});

describe('POST /tools/:id/rollback', () => {
  it('restores the most recent definition snapshot, snapshotting the current one first', async () => {
    const current = {
      id: 't1', description: 'current description', input_schema_json: null, output_schema_json: null,
      definition_hash: 'current-hash', version: '2', approval_status: 'allowed',
    };
    const previous = {
      description: 'previous description', input_schema_json: null, output_schema_json: null,
      definition_hash: 'previous-hash', version: '1', superseded_at: '2026-07-01T00:00:00Z',
    };
    pool.query
      .mockResolvedValueOnce({ rows: [current] })                                    // fetch current
      .mockResolvedValueOnce({ rows: [previous] })                                   // most recent snapshot
      .mockResolvedValueOnce({ rows: [] })                                            // snapshot current before overwrite
      .mockResolvedValueOnce({ rows: [{ ...current, ...previous, approval_status: 'pending' }] }) // restore update
      .mockResolvedValueOnce({ rows: [] });                                           // decision history insert

    const res = await request(app).post('/tools/t1/rollback');
    expect(res.status).toBe(200);
    expect(res.body.approval_status).toBe('pending');
    expect(res.body.description).toBe('previous description');
    expect(res.body.rolled_back_from_snapshot_at).toBe('2026-07-01T00:00:00Z');

    const snapshotInsert = pool.query.mock.calls[2][1];
    expect(snapshotInsert).toEqual(['t1', 'current description', null, null, 'current-hash', '2']);

    const decisionInsert = pool.query.mock.calls[4][1];
    expect(decisionInsert).toEqual(['t1', 'allowed']);
  });

  it('returns 404 when the tool has no previous definition snapshot', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ id: 't1' }] })
      .mockResolvedValueOnce({ rows: [] }); // no snapshot history
    const res = await request(app).post('/tools/t1/rollback');
    expect(res.status).toBe(404);
    expect(res.body.error).toContain('No previous definition snapshot');
  });

  it('returns 404 for an unknown tool', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).post('/tools/unknown/rollback');
    expect(res.status).toBe(404);
  });
});

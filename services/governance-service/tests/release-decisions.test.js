import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
import pool from '../db.js';
import app from '../index.js';

beforeEach(() => vi.clearAllMocks());

const CLEAN_BUNDLE = { policy_coverage: { pct: 100 }, violations: { by_severity: { critical: 0, high: 0, medium: 1, low: 0 } } };
const BAD_BUNDLE = { policy_coverage: { pct: 50 }, violations: { by_severity: { critical: 1, high: 0, medium: 0, low: 0 } } };

// S2.10 (2026-10-08, finding F-06) — the decision is now computed from a
// server-side query of governance.violations, not the submitted
// evidence_bundle's violation counts. Stubs the SELECT by matching on SQL
// text (robust to the exact query shape) rather than call order, and the
// INSERT separately, so these tests say what they mean: "given this real
// violation state, the server must decide X" — independent of whatever the
// caller's evidence_bundle claims.
function stubViolations(bySeverityRows, insertedRow) {
  pool.query.mockImplementation(sql => {
    if (sql.includes('FROM governance.violations')) return Promise.resolve({ rows: bySeverityRows });
    if (sql.includes('INSERT INTO release_decisions')) return Promise.resolve({ rows: [insertedRow] });
    return Promise.resolve({ rows: [] });
  });
}

describe('POST /release-decisions', () => {
  it('requires entity_id, evidence_bundle, and decided_by', async () => {
    const res = await request(app).post('/release-decisions').send({});
    expect(res.status).toBe(400);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('server computes "certified" from real violation state, ignoring both the client hint and the submitted evidence_bundle', async () => {
    stubViolations([{ severity: 'medium', count: 1 }], { id: 'rd-1', decision: 'certified' });

    // evidence_bundle here lies and claims a critical violation — the real
    // DB state (medium only) must win.
    const res = await request(app).post('/release-decisions').send({
      entity_id: 'wf-1', evidence_bundle: BAD_BUNDLE, decided_by: 'system:ioa-cli', decision_hint: 'rejected',
    });

    expect(res.status).toBe(201);
    const insertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT INTO release_decisions'));
    expect(insertCall[1][0]).toBe('workflow'); // entity_type default
    expect(insertCall[1][3]).toBe('certified'); // decision — computed from real state, not the client's hint or bundle
    expect(insertCall[1][4]).toBe(50); // coverage_pct still comes from the submitted bundle (supplementary context)
  });

  it('server computes "rejected" on a real open critical violation, even when the submitted evidence_bundle claims none', async () => {
    stubViolations([{ severity: 'critical', count: 1 }], { id: 'rd-2', decision: 'rejected' });

    await request(app).post('/release-decisions').send({
      // evidence_bundle here lies and claims zero critical/high violations.
      entity_id: 'wf-1', evidence_bundle: CLEAN_BUNDLE, decided_by: 'system:ioa-cli',
    });

    const insertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT INTO release_decisions'));
    expect(insertCall[1][3]).toBe('rejected');
  });

  it('excludes resolved and waived_temporarily violations from the severity query', async () => {
    stubViolations([], { id: 'rd-4', decision: 'certified' });
    await request(app).post('/release-decisions').send({ entity_id: 'wf-1', evidence_bundle: CLEAN_BUNDLE, decided_by: 'system:ioa-cli' });

    const selectCall = pool.query.mock.calls.find(c => c[0].includes('FROM governance.violations'));
    expect(selectCall[0]).toContain("status NOT IN ('resolved', 'waived_temporarily')");
    expect(selectCall[1]).toEqual(['workflow', 'wf-1']);
  });

  it('accepts an explicit entity_type and release_ref', async () => {
    stubViolations([], { id: 'rd-3' });

    await request(app).post('/release-decisions').send({
      entity_type: 'mcp_server', entity_id: 'srv-1', release_ref: 'abc123',
      evidence_bundle: CLEAN_BUNDLE, decided_by: 'jane@example.com',
    });

    const insertCall = pool.query.mock.calls.find(c => c[0].includes('INSERT INTO release_decisions'));
    expect(insertCall[1][0]).toBe('mcp_server');
    expect(insertCall[1][2]).toBe('abc123');
    const selectCall = pool.query.mock.calls.find(c => c[0].includes('FROM governance.violations'));
    expect(selectCall[1]).toEqual(['mcp_server', 'srv-1']);
  });
});

describe('GET /release-decisions', () => {
  it('filters by entity_type and entity_id', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/release-decisions?entity_type=workflow&entity_id=wf-1');
    const [sql, params] = pool.query.mock.calls[0];
    expect(sql).toContain('entity_type');
    expect(sql).toContain('entity_id');
    expect(params).toEqual(['workflow', 'wf-1']);
  });

  it('returns all decisions with no filters', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ id: 'rd-1' }] });
    const res = await request(app).get('/release-decisions');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

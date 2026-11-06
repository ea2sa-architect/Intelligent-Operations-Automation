import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
// Route tests exercise business logic, not auth — require-auth.js has its
// own dedicated conformance suite (tests/require-auth.test.js).
vi.mock('../src/lib/require-auth.js', () => ({ default: (req, _res, next) => next(), requirePermission: () => (_req, _res, next) => next() }));
import pool from '../db.js';
import app from '../index.js';

const POLICY = {
  id: 'aaaaaaaa-0000-0000-0000-000000000001',
  name: 'Test Policy',
  description: 'A test policy',
  status: 'draft',
  version: 1,
  created_at: '2026-05-11T00:00:00Z',
  updated_at: '2026-05-11T00:00:00Z',
};
const RULE = { id: 'bbbbbbbb-0000-0000-0000-000000000001', policy_id: POLICY.id, action: 'deny', priority: 0 };
const BINDING = { id: 'cccccccc-0000-0000-0000-000000000001', policy_id: POLICY.id, entity_type: 'model', entity_id: 'model-1' };

beforeEach(() => vi.clearAllMocks());

describe('GET /policies', () => {
  it('returns list of policies', async () => {
    pool.query.mockResolvedValueOnce({ rows: [POLICY] });
    const res = await request(app).get('/policies');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('filters by status', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    await request(app).get('/policies?status=active');
    expect(pool.query.mock.calls[0][0]).toContain('status');
  });
});

describe('GET /policies/:id', () => {
  it('returns policy with rules and bindings', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [POLICY] })
      .mockResolvedValueOnce({ rows: [RULE] })
      .mockResolvedValueOnce({ rows: [BINDING] })
      .mockResolvedValueOnce({ rows: [{ open: 0, acknowledged: 0, resolved: 0, total: 0 }] }); // violation summary
    const res = await request(app).get(`/policies/${POLICY.id}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(POLICY.id);
    expect(res.body.rules).toHaveLength(1);
    expect(res.body.bindings).toHaveLength(1);
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).get('/policies/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('POST /policies', () => {
  it('creates a policy', async () => {
    pool.query.mockResolvedValueOnce({ rows: [POLICY] });
    const res = await request(app).post('/policies').send({ name: 'Test Policy' });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Test Policy');
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app).post('/policies').send({ description: 'oops' });
    expect(res.status).toBe(400);
  });
});

describe('PUT /policies/:id', () => {
  it('updates policy name and description', async () => {
    pool.query.mockResolvedValueOnce({ rows: [{ ...POLICY, name: 'Updated' }] });
    const res = await request(app).put(`/policies/${POLICY.id}`).send({ name: 'Updated' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated');
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).put('/policies/does-not-exist').send({ name: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /policies/:id/status', () => {
  it('activates a policy and snapshots version', async () => {
    const activated = { ...POLICY, status: 'active', version: 2 };
    pool.query
      .mockResolvedValueOnce({ rows: [activated] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch(`/policies/${POLICY.id}/status`).send({ status: 'active' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  it('returns 400 for invalid status value', async () => {
    const res = await request(app).patch(`/policies/${POLICY.id}/status`).send({ status: 'invalid' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/policies/does-not-exist/status').send({ status: 'active' });
    expect(res.status).toBe(404);
  });
});

// EP-201-S2
describe('PATCH /policies/:id/enforcement-mode', () => {
  it('sets enforcement_mode and snapshots version', async () => {
    const warned = { ...POLICY, enforcement_mode: 'warn', version: 2 };
    pool.query
      .mockResolvedValueOnce({ rows: [warned] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch(`/policies/${POLICY.id}/enforcement-mode`).send({ enforcement_mode: 'warn' });
    expect(res.status).toBe(200);
    expect(res.body.enforcement_mode).toBe('warn');

    const updateArgs = pool.query.mock.calls[0][1];
    expect(updateArgs).toEqual(['warn', POLICY.id]);
    const snapshotArgs = pool.query.mock.calls[1][1];
    expect(snapshotArgs).toEqual([warned.id, warned.version, warned]);
  });

  it('returns 400 for an invalid enforcement_mode value', async () => {
    const res = await request(app).patch(`/policies/${POLICY.id}/enforcement-mode`).send({ enforcement_mode: 'block' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch('/policies/does-not-exist/enforcement-mode').send({ enforcement_mode: 'enforce' });
    expect(res.status).toBe(404);
  });
});

describe('DELETE /policies/:id', () => {
  it('deletes a policy', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(app).delete(`/policies/${POLICY.id}`);
    expect(res.status).toBe(204);
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(app).delete('/policies/does-not-exist');
    expect(res.status).toBe(404);
  });
});

describe('POST /policies/:id/rules', () => {
  it('adds a rule', async () => {
    pool.query.mockResolvedValueOnce({ rows: [RULE] });
    const res = await request(app)
      .post(`/policies/${POLICY.id}/rules`)
      .send({ condition_json: { field: 'status' }, action: 'deny' });
    expect(res.status).toBe(201);
  });

  it('returns 400 when condition_json is missing', async () => {
    const res = await request(app).post(`/policies/${POLICY.id}/rules`).send({ action: 'deny' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when action is missing', async () => {
    const res = await request(app).post(`/policies/${POLICY.id}/rules`).send({ condition_json: { field: 'x' } });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /policies/:id/rules/:ruleId', () => {
  it('deletes a rule', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(app).delete(`/policies/${POLICY.id}/rules/${RULE.id}`);
    expect(res.status).toBe(204);
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(app).delete(`/policies/${POLICY.id}/rules/bad-id`);
    expect(res.status).toBe(404);
  });
});

describe('GET /policies/:id/bindings', () => {
  it('returns bindings for a policy', async () => {
    pool.query.mockResolvedValueOnce({ rows: [BINDING] });
    const res = await request(app).get(`/policies/${POLICY.id}/bindings`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });
});

describe('POST /policies/:id/bindings', () => {
  it('creates a binding', async () => {
    pool.query.mockResolvedValueOnce({ rows: [BINDING] });
    const res = await request(app)
      .post(`/policies/${POLICY.id}/bindings`)
      .send({ entity_type: 'model', entity_id: 'model-1' });
    expect(res.status).toBe(201);
  });

  it('returns 400 when entity_type is missing', async () => {
    const res = await request(app)
      .post(`/policies/${POLICY.id}/bindings`)
      .send({ entity_id: 'model-1' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when entity_id is missing', async () => {
    const res = await request(app)
      .post(`/policies/${POLICY.id}/bindings`)
      .send({ entity_type: 'model' });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /policies/:id/bindings/:bindingId', () => {
  it('deletes a binding', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 1 });
    const res = await request(app).delete(`/policies/${POLICY.id}/bindings/${BINDING.id}`);
    expect(res.status).toBe(204);
  });

  it('returns 404 when not found', async () => {
    pool.query.mockResolvedValueOnce({ rowCount: 0 });
    const res = await request(app).delete(`/policies/${POLICY.id}/bindings/bad-id`);
    expect(res.status).toBe(404);
  });
});

// ── Policy bundles groundwork: UI-path rule validation, rule names, and the
// unevaluated-rule safeguard ───────────────────────────────────────────────

const OUTBOUND_SCHEMA = { type: 'outbound_domain', schema_json: { fields: [
  { name: 'allowed_domains', type: 'json_array' },
  { name: 'block_unlisted', type: 'enum', options: ['true', 'false'] },
  { name: 'severity', type: 'severity' },
] } };

describe('POST /policies/:id/rules — typed rule validation (shared with bundle import)', () => {
  it('rejects a config that does not fit the rule type schema', async () => {
    pool.query.mockResolvedValueOnce({ rows: [OUTBOUND_SCHEMA] });
    const res = await request(app).post(`/policies/${POLICY.id}/rules`)
      .send({ rule_type: 'outbound_domain', config_json: { block_unlisted: 'sometimes', surprise: 1 } });
    expect(res.status).toBe(400);
    expect(res.body.details.map(d => d.path).sort()).toEqual(['config.block_unlisted', 'config.surprise']);
    expect(pool.query).toHaveBeenCalledTimes(1); // nothing was inserted
  });

  it('accepts a valid typed rule, with an optional name', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [OUTBOUND_SCHEMA] })
      .mockResolvedValueOnce({ rows: [{ ...RULE, name: 'external-only' }] });
    const res = await request(app).post(`/policies/${POLICY.id}/rules`)
      .send({ rule_type: 'outbound_domain', name: 'external-only', config_json: { allowed_domains: ['a.com'], block_unlisted: 'true' }, severity: 'high' });
    expect(res.status).toBe(201);
    expect(pool.query.mock.calls[1][1][1]).toBe('external-only');
  });

  it('rejects a malformed rule name and maps a duplicate name to 409', async () => {
    const bad = await request(app).post(`/policies/${POLICY.id}/rules`).send({ condition_json: { a: 1 }, action: 'deny', name: '-no' });
    expect(bad.status).toBe(400);

    pool.query.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    const dup = await request(app).post(`/policies/${POLICY.id}/rules`).send({ condition_json: { a: 1 }, action: 'deny', name: 'taken' });
    expect(dup.status).toBe(409);
  });

  it('leaves legacy condition_json rules unvalidated against the catalog', async () => {
    pool.query.mockResolvedValueOnce({ rows: [RULE] });
    const res = await request(app).post(`/policies/${POLICY.id}/rules`).send({ condition_json: { anything: 1 }, action: 'deny' });
    expect(res.status).toBe(201);
  });
});

describe('unevaluated rules (rule types the platform does not evaluate)', () => {
  it('GET /policies/:id lists them, ignoring disabled rules', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [POLICY] })
      .mockResolvedValueOnce({ rows: [
        { ...RULE, rule_type: 'execution_rate', enabled: true },
        { ...RULE, rule_type: 'logging_restriction', enabled: false },
        { ...RULE, rule_type: 'pii_detection', enabled: true },
      ] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{}] });
    const res = await request(app).get(`/policies/${POLICY.id}`);
    expect(res.body.unevaluated_rule_types).toEqual(['execution_rate']);
  });

  it('GET /policies includes the derived column in the list query', async () => {
    pool.query.mockResolvedValueOnce({ rows: [POLICY] });
    await request(app).get('/policies');
    expect(pool.query.mock.calls[0][0]).toContain('unevaluated_rule_types');
    expect(pool.query.mock.calls[0][0]).toContain(`'execution_rate'`);
  });

  it('activating a policy that holds one returns a warning (but still succeeds)', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ ...POLICY, status: 'active', version: 2 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ rule_type: 'prompt_inspection' }] });
    const res = await request(app).patch(`/policies/${POLICY.id}/status`).send({ status: 'active' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body.warnings[0]).toMatch(/prompt_inspection/);
  });

  it('switching to enforce warns; switching back to observe or deactivating does not', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ ...POLICY, enforcement_mode: 'enforce', version: 2 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ rule_type: 'execution_rate' }] });
    const warned = await request(app).patch(`/policies/${POLICY.id}/enforcement-mode`).send({ enforcement_mode: 'enforce' });
    expect(warned.body.warnings[0]).toMatch(/execution_rate/);

    vi.clearAllMocks();
    pool.query
      .mockResolvedValueOnce({ rows: [{ ...POLICY, enforcement_mode: 'observe', version: 3 }] })
      .mockResolvedValueOnce({ rows: [] });
    const quiet = await request(app).patch(`/policies/${POLICY.id}/enforcement-mode`).send({ enforcement_mode: 'observe' });
    expect(quiet.body).not.toHaveProperty('warnings');
    expect(pool.query).toHaveBeenCalledTimes(2); // no extra lookup when nothing "goes live"
  });

  it('a policy without such rules gets no warnings field', async () => {
    pool.query
      .mockResolvedValueOnce({ rows: [{ ...POLICY, status: 'active', version: 2 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const res = await request(app).patch(`/policies/${POLICY.id}/status`).send({ status: 'active' });
    expect(res.body).not.toHaveProperty('warnings');
  });
});

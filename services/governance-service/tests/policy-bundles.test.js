import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const order = [];
vi.mock('../db.js', () => ({ default: { query: vi.fn(), connect: vi.fn() } }));
// Unlike most route tests this mock enforces permissions (taken from the
// x-perms header), because who may import/replace is the point of these tests.
vi.mock('../src/lib/require-auth.js', () => ({
  default: (req, _res, next) => {
    req.user = { username: 'tester', permissions: JSON.parse(req.get('x-perms') ?? '["policy:read","policy:import","policy:edit"]') };
    next();
  },
  requirePermission: action => (req, res, next) =>
    req.user.permissions.includes(action) ? next() : res.status(403).json({ error: `Permission required: ${action}` }),
}));
vi.mock('../src/lib/audit-client.js', () => ({
  logPolicyBundleExport: vi.fn(),
  logPolicyBundleImport: vi.fn(args => order.push(`audit:${args.outcome}`)),
}));
import pool from '../db.js';
import app from '../index.js';
import { logPolicyBundleExport, logPolicyBundleImport } from '../src/lib/audit-client.js';

const here = dirname(fileURLToPath(import.meta.url));
const example = () => JSON.parse(readFileSync(resolve(here, '../../../policies/examples/pii-output-protection.bundle.json'), 'utf8'));

const SCHEMA_ROWS = [
  { type: 'pii_detection', schema_json: { fields: [
    { name: 'inspection_targets', type: 'multi_enum', options: ['webhook_payload', 'http_body', 'email'] },
    { name: 'sensitive_fields', type: 'json_array' },
    { name: 'actions', type: 'multi_enum', options: ['flag_workflow', 'generate_event'] },
    { name: 'severity', type: 'severity' }] } },
  { type: 'outbound_domain', schema_json: { fields: [
    { name: 'allowed_domains', type: 'json_array' },
    { name: 'block_unlisted', type: 'enum', options: ['true', 'false'] },
    { name: 'exempt_private_ranges', type: 'enum', options: ['true', 'false'] },
    { name: 'actions', type: 'multi_enum', options: ['flag_workflow', 'alert_team'] },
    { name: 'severity', type: 'severity' }] } },
];
const LIVE = { id: 'p-live', name: 'PII Output Protection', status: 'active', enforcement_mode: 'enforce', version: 4, metadata_json: {} };

let state;
const sqlOf = s => s.replace(/\s+/g, ' ').trim();
const fakeQuery = async (rawSql, params = []) => {
  const sql = sqlOf(rawSql);
  state.calls.push({ sql, params });
  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) { order.push(sql); }
  if (state.failOn?.test(sql)) throw Object.assign(new Error(state.failMessage ?? 'boom'), state.failCode ? { code: state.failCode } : {});

  if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
  if (sql.includes('FROM rule_schemas')) return { rows: SCHEMA_ROWS };
  if (sql.includes('lower(name) = ANY')) return { rows: state.existing ? [state.existing] : [] };
  if (sql.includes('workflow_governance.workflows')) return { rows: [{ id: 'wf-1' }] };
  if (sql.includes('FROM policy_rules r WHERE r.policy_id')) return { rows: state.depRules ?? [] };
  if (sql.includes('lower(name) = lower($1) FOR UPDATE')) return { rows: state.existing ? [state.existing] : [] };
  if (sql.startsWith('INSERT INTO policies')) return { rows: [{ id: 'p-new', name: params[0], version: 1 }] };
  if (sql.startsWith('UPDATE policies')) return { rows: [{ id: state.existing.id, name: state.existing.name, version: state.existing.version + 1 }] };
  if (sql.includes('FROM policy_rules WHERE policy_id = $1 FOR UPDATE')) return { rows: state.oldRules ?? [] };
  if (sql.startsWith('SELECT (SELECT COUNT(*) FROM violations')) return { rows: [{ n: state.deps ?? 0 }] };
  return { rows: [] };
};
const ran = re => state.calls.filter(c => re.test(c.sql));

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  state = { calls: [], existing: null };
  pool.query.mockImplementation(fakeQuery);
  pool.connect.mockImplementation(async () => ({ query: fakeQuery, release: vi.fn() }));
});

const post = (path, body, perms) => {
  const r = request(app).post(`/policy-bundles/${path}`);
  return (perms ? r.set('x-perms', JSON.stringify(perms)) : r).send(body);
};

describe('GET /policy-bundles/export', () => {
  const exportDb = ({ legacy = false } = {}) => pool.query.mockImplementation(async (sql, params) => {
    const s = sqlOf(sql);
    if (s.startsWith('SELECT * FROM policies')) return { rows: [{ id: 'p1', name: 'Exported', description: null, enforcement_mode: 'warn', status: 'active', version: 3, metadata_json: null }] };
    if (s.startsWith('SELECT * FROM policy_rules')) {
      return { rows: [
        { policy_id: 'p1', name: 'r1', rule_type: 'outbound_domain', severity: 'high', enabled: true, priority: 0, config_json: { b: 1, a: 2 }, created_at: 'x' },
        ...(legacy ? [{ policy_id: 'p1', name: null, rule_type: null, condition_json: { x: 1 }, action: 'block', priority: 1, created_at: 'y' }] : []),
      ] };
    }
    return { rows: [] };
  });

  it('returns a downloadable, deterministic bundle and audits it', async () => {
    exportDb();
    const res = await request(app).get('/policy-bundles/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="ioa-policy-bundle-\d{4}-\d{2}-\d{2}\.json"/);
    const body = JSON.parse(res.text);
    expect(body.policies[0]).toMatchObject({ name: 'Exported', requested_mode: 'warn' });
    expect(Object.keys(body.policies[0].rules[0].config)).toEqual(['a', 'b']);
    expect(res.text.endsWith('\n')).toBe(true);
    expect(logPolicyBundleExport).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success', policyNames: ['Exported'] }));
  });

  it('refuses to silently drop legacy rules unless skip_legacy=true', async () => {
    exportDb({ legacy: true });
    const refused = await request(app).get('/policy-bundles/export');
    expect(refused.status).toBe(422);
    expect(refused.body.policies).toEqual([{ name: 'Exported', legacy_rules: 1 }]);
    expect(logPolicyBundleExport).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure' }));

    const allowed = await request(app).get('/policy-bundles/export?skip_legacy=true');
    expect(allowed.status).toBe(200);
    expect(JSON.parse(allowed.text).policies[0].rules).toHaveLength(1);
  });

  it('validates ids and status, and 404s when nothing matches', async () => {
    expect((await request(app).get('/policy-bundles/export?ids=nope')).status).toBe(400);
    expect((await request(app).get('/policy-bundles/export?status=live')).status).toBe(400);
    pool.query.mockResolvedValueOnce({ rows: [] });
    expect((await request(app).get('/policy-bundles/export')).status).toBe(404);
  });
});

describe('POST /policy-bundles/validate', () => {
  it('previews a valid bundle without writing anything, for a read-only user', async () => {
    const res = await post('validate', { bundle: example() }, ['policy:read']);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.plan[0]).toMatchObject({ action: 'create', effective_mode: 'observe' });
    expect(res.body.warnings.some(w => /no bindings/.test(w.message))).toBe(true);
    expect(ran(/^(INSERT|UPDATE|DELETE|BEGIN)/)).toHaveLength(0);
    expect(pool.connect).not.toHaveBeenCalled();
    expect(logPolicyBundleImport).not.toHaveBeenCalled();
  });

  it('reports errors in the body rather than failing the request', async () => {
    const bundle = example();
    bundle.policies[0].rules[0].rule_type = 'made_up';
    const res = await post('validate', { bundle });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(false);
    expect(res.body.errors[0].path).toBe('policies[0].rules[0].rule_type');
  });

  it('rejects an unknown on_conflict value', async () => {
    expect((await post('validate', { bundle: example(), on_conflict: 'merge' })).status).toBe(400);
  });
});

describe('POST /policy-bundles/import', () => {
  it('requires policy:import', async () => {
    const res = await post('import', { bundle: example() }, ['policy:read', 'policy:edit']);
    expect(res.status).toBe(403);
    expect(pool.connect).not.toHaveBeenCalled();
  });

  it('creates policies as Draft / Observe whatever mode the bundle requests, in one transaction', async () => {
    const bundle = example();
    bundle.policies[0].requested_mode = 'enforce';
    bundle.policies[0].bindings = [{ entity_type: 'workflow', entity_id: 'wf-1' }];
    const res = await post('import', { bundle });

    expect(res.status).toBe(201);
    expect(res.body.imported).toEqual([expect.objectContaining({ name: 'PII Output Protection', action: 'created', status: 'draft', enforcement_mode: 'observe' })]);

    const insert = ran(/^INSERT INTO policies/)[0];
    expect(insert.sql).toContain(`'draft', 'observe'`);
    expect(JSON.parse(insert.params[2])).toMatchObject({ requested_mode: 'enforce', bundle_version: '1.0.0', imported_by: 'tester' });
    expect(ran(/^INSERT INTO policy_rules/)).toHaveLength(2);
    expect(ran(/^INSERT INTO policy_bindings/)).toHaveLength(1);
    expect(ran(/^INSERT INTO policy_versions/)).toHaveLength(1);
    expect(order).toEqual(['BEGIN', 'COMMIT', 'audit:success']); // success is only reported after COMMIT
  });

  it('rejects an invalid bundle before opening a transaction, and audits the failure', async () => {
    const bundle = example();
    bundle.policies[0].extra = true;
    const res = await post('import', { bundle });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].path).toBe('policies[0].extra');
    expect(pool.connect).not.toHaveBeenCalled();
    expect(logPolicyBundleImport).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failure', reason: 'validation' }));
  });

  it('rejects a name collision by default, leaving the live policy alone', async () => {
    state.existing = LIVE;
    const res = await post('import', { bundle: example() });
    expect(res.status).toBe(422);
    expect(res.body.plan[0].action).toBe('conflict');
    expect(pool.connect).not.toHaveBeenCalled();
    expect(ran(/^(UPDATE|DELETE)/)).toHaveLength(0);
  });

  describe('on_conflict: replace', () => {
    it('needs policy:edit as well as policy:import', async () => {
      state.existing = LIVE;
      const res = await post('import', { bundle: example(), on_conflict: 'replace' }, ['policy:read', 'policy:import']);
      expect(res.status).toBe(403);
      expect(res.body.error).toMatch(/policy:edit/);
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('locks the row, resets it to Draft / Observe, bumps the version and snapshots it', async () => {
      state.existing = LIVE;
      state.oldRules = [{ id: 'r-old', name: 'retired-rule' }];
      const res = await post('import', { bundle: example(), on_conflict: 'replace' });

      expect(res.status).toBe(201);
      expect(res.body.imported[0]).toMatchObject({ id: 'p-live', action: 'replaced', status: 'draft', enforcement_mode: 'observe' });
      expect(ran(/FOR UPDATE/).length).toBeGreaterThanOrEqual(2); // policy row + its rules
      const update = ran(/^UPDATE policies/)[0];
      expect(update.sql).toContain(`status = 'draft', enforcement_mode = 'observe'`);
      expect(update.sql).toContain('version = version + 1');
      expect(ran(/^DELETE FROM policy_rules/)).toEqual([expect.objectContaining({ params: ['r-old'] })]);
      expect(ran(/^INSERT INTO policy_versions/)).toHaveLength(1);
      expect(order).toEqual(['BEGIN', 'COMMIT', 'audit:success']);
    });

    it('refuses to delete a rule that has violations attached, and rolls everything back', async () => {
      state.existing = LIVE;
      state.depRules = [{ id: 'r-old', name: 'retired-rule', dependents: 2 }]; // caught at validate time
      const blocked = await post('import', { bundle: example(), on_conflict: 'replace' });
      expect(blocked.status).toBe(422);
      expect(blocked.body.errors[0].message).toMatch(/retired-rule/);
      expect(pool.connect).not.toHaveBeenCalled();

      // ...and again at apply time if one appears between validate and write.
      order.length = 0;
      state.depRules = [];
      state.oldRules = [{ id: 'r-new-dep', name: 'late-rule' }];
      state.deps = 1;
      const late = await post('import', { bundle: example(), on_conflict: 'replace' });
      expect(late.status).toBe(409);
      expect(order).toEqual(['BEGIN', 'ROLLBACK', 'audit:failure']);
      expect(ran(/^DELETE FROM policy_rules/)).toHaveLength(0);
    });
  });

  // Postgres cannot type a parameter a statement never references, and a mocked
  // pool will not notice (this shipped broken once: rule UPDATE was sent
  // policy_id as an unused $1). So check the contract on every statement.
  it('sends each statement exactly the parameters it references', async () => {
    state.existing = LIVE;
    state.oldRules = [{ id: 'r-old', name: 'retired-rule' }, { id: 'r-keep', name: 'pii-in-output' }];
    const bundle = example();
    bundle.policies[0].bindings = [{ entity_type: 'workflow', entity_id: 'wf-1' }];
    await post('import', { bundle, on_conflict: 'replace' });

    const applied = state.calls.filter(c => /^(INSERT|UPDATE|DELETE)/.test(c.sql));
    expect(applied.length).toBeGreaterThan(5);
    expect(ran(/^UPDATE policy_rules/)).toHaveLength(1); // the matched rule really went through the update path
    for (const { sql, params } of applied) {
      const used = [...new Set([...sql.matchAll(/\$(\d+)/g)].map(m => Number(m[1])))].sort((a, b) => a - b);
      expect(used, sql).toEqual(params.map((_, i) => i + 1));
    }
  });

  it('maps a unique violation (concurrent create) to 409 and rolls back', async () => {
    state.failOn = /^INSERT INTO policy_rules/;
    state.failCode = '23505';
    const res = await post('import', { bundle: example() });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/created concurrently/);
    expect(order).toEqual(['BEGIN', 'ROLLBACK', 'audit:failure']);
  });

  it('rolls back and reports failure, never success, on any mid-import error', async () => {
    state.failOn = /^INSERT INTO policy_versions/;
    state.failMessage = 'disk full';
    const res = await post('import', { bundle: example() });
    expect(res.status).toBe(500);
    expect(order).toEqual(['BEGIN', 'ROLLBACK', 'audit:failure']);
    expect(logPolicyBundleImport).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: 'success' }));
    expect(logPolicyBundleImport).not.toHaveBeenCalledWith(expect.objectContaining({ outcome: 'partial' }));
  });
});

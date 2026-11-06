import { vi, describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));
import { validateStructure, validateBundle, buildBundle, BUNDLE_SCHEMA } from '../src/lib/policy-bundle.js';

const here = dirname(fileURLToPath(import.meta.url));
const example = () => JSON.parse(readFileSync(resolve(here, '../../../policies/examples/pii-output-protection.bundle.json'), 'utf8'));

const WF = 'wf-1';
const paths = list => list.map(e => e.path);
const withPolicy = (patch) => { const b = example(); Object.assign(b.policies[0], patch); return b; };

describe('validateStructure', () => {
  it('accepts the checked-in example bundle, warning that it has no bindings', () => {
    const r = validateStructure(example());
    expect(r.errors).toEqual([]);
    expect(paths(r.warnings)).toEqual(['policies[0].bindings']);
    expect(r.policies[0]).toMatchObject({ name: 'PII Output Protection', requested_mode: 'observe', bundle_version: '1.0.0' });
  });

  it('rejects unknown fields at every level', () => {
    const b = example();
    b.extra = 1;
    b.policies[0].mode = 'enforce';
    b.policies[0].rules[0].condition = {};
    b.policies[0].bindings = [{ entity_type: 'workflow', entity_id: WF, destinations: ['x'] }];
    expect(paths(validateStructure(b).errors).sort()).toEqual([
      'bundle.extra', 'policies[0].bindings[0].destinations', 'policies[0].mode', 'policies[0].rules[0].condition',
    ]);
  });

  it('requires the schema id and a non-empty policy list', () => {
    expect(paths(validateStructure({ schema: 'nope', policies: [] }).errors)).toEqual(['schema', 'policies']);
    expect(validateStructure(null).errors[0].path).toBe('bundle');
  });

  it('rejects duplicate policy names (ignoring case), duplicate rule names, and duplicate bindings', () => {
    const b = example();
    b.policies.push({ ...structuredClone(b.policies[0]), name: 'pii output protection' });
    b.policies[0].rules[1].name = 'PII-IN-OUTPUT';
    b.policies[0].bindings = [{ entity_type: 'workflow', entity_id: WF }, { entity_type: 'workflow', entity_id: WF }];
    const msgs = validateStructure(b).errors.map(e => e.message).join('|');
    expect(msgs).toMatch(/duplicate policy name/);
    expect(msgs).toMatch(/duplicate rule name/);
    expect(msgs).toMatch(/duplicate binding/);
  });

  it('rejects malformed ids and unknown entity types', () => {
    const b = withPolicy({ bindings: [
      { entity_type: 'mcp_server', entity_id: 'not-a-uuid' },
      { entity_type: 'ai_model', entity_id: '' },
      { entity_type: 'database', entity_id: 'x' },
    ] });
    expect(validateStructure(b).errors).toHaveLength(3);
  });

  it('rejects bad modes, severities, priorities and rule names', () => {
    const b = example();
    b.policies[0].requested_mode = 'block';
    Object.assign(b.policies[0].rules[0], { severity: 'severe', priority: 1.5, enabled: 'yes', name: '-bad' });
    expect(paths(validateStructure(b).errors).sort()).toEqual([
      'policies[0].requested_mode', 'policies[0].rules[0].enabled', 'policies[0].rules[0].name',
      'policies[0].rules[0].priority', 'policies[0].rules[0].severity',
    ]);
  });

  it('enforces size and shape limits on nested config and on counts', () => {
    const b = example();
    b.policies[0].rules[0].config = { sensitive_fields: ['x'.repeat(20_000)] };
    expect(validateStructure(b).errors[0].message).toMatch(/too large/);

    const many = example();
    many.policies = Array.from({ length: 101 }, (_, i) => ({ ...structuredClone(many.policies[0]), name: `p${i}` }));
    expect(validateStructure(many).errors[0].message).toMatch(/at most 100/);
  });

  it('rejects forbidden keys smuggled into config', () => {
    const b = JSON.parse(JSON.stringify(example()).replace('"actions"', '"__proto__"'));
    expect(validateStructure(b).errors.some(e => /forbidden key/.test(e.message))).toBe(true);
  });
});

// What loadContext would have fetched.
const SCHEMAS = new Map([
  ['pii_detection', { fields: [
    { name: 'inspection_targets', type: 'multi_enum', options: ['webhook_payload', 'http_body', 'email'] },
    { name: 'sensitive_fields', type: 'json_array' },
    { name: 'actions', type: 'multi_enum', options: ['flag_workflow', 'generate_event'] },
    { name: 'severity', type: 'severity' },
  ] }],
  ['outbound_domain', { fields: [
    { name: 'allowed_domains', type: 'json_array' },
    { name: 'block_unlisted', type: 'enum', options: ['true', 'false'] },
    { name: 'exempt_private_ranges', type: 'enum', options: ['true', 'false'] },
    { name: 'actions', type: 'multi_enum', options: ['flag_workflow', 'alert_team'] },
    { name: 'severity', type: 'severity' },
  ] }],
  ['execution_rate', { fields: [{ name: 'severity', type: 'severity' }] }],
]);
const ctx = (over = {}) => ({ ruleSchemas: SCHEMAS, existingByName: new Map(), missingTargets: new Set(), blockedRules: new Map(), ...over });
const analyze = (bundle, c = ctx(), opts = {}) => validateBundle(validateStructure(bundle), c, opts);

describe('validateBundle', () => {
  it('plans a clean create that will land as Draft / Observe', () => {
    const r = analyze(example());
    expect(r.valid).toBe(true);
    expect(r.plan).toEqual([expect.objectContaining({ name: 'PII Output Protection', action: 'create', effective_mode: 'observe', rules: 2 })]);
  });

  it('flags an unknown rule type and an invalid config', () => {
    const b = example();
    b.policies[0].rules[0].rule_type = 'made_up';
    b.policies[0].rules[1].config.block_unlisted = 'sometimes';
    const r = analyze(b);
    expect(r.valid).toBe(false);
    expect(paths(r.errors).sort()).toEqual(['policies[0].rules[0].rule_type', 'policies[0].rules[1].config.block_unlisted']);
  });

  it('reports a binding whose target does not exist', () => {
    const b = withPolicy({ bindings: [{ entity_type: 'workflow', entity_id: WF }] });
    const r = analyze(b, ctx({ missingTargets: new Set([`workflow:${WF}`]) }));
    expect(r.errors[0].message).toMatch(/does not exist/);
    expect(analyze(b).valid).toBe(true);
  });

  it('warns that requested modes other than observe are not applied', () => {
    const r = analyze(withPolicy({ requested_mode: 'enforce' }));
    expect(r.warnings.some(w => /imported as Draft \/ Observe/.test(w.message))).toBe(true);
    expect(r.plan[0]).toMatchObject({ requested_mode: 'enforce', effective_mode: 'observe' });
  });

  it('warns loudly about rules the platform does not evaluate, and lists them in the plan', () => {
    const b = example();
    b.policies[0].rules.push({ name: 'rate', rule_type: 'execution_rate', config: {} });
    const r = analyze(b);
    expect(r.valid).toBe(true);
    expect(r.warnings.some(w => /not evaluated/.test(w.message))).toBe(true);
    expect(r.plan[0].unevaluated_rule_types).toEqual(['execution_rate']);
  });

  const existing = new Map([['pii output protection', { id: 'p1', name: 'PII Output Protection', status: 'active', enforcement_mode: 'enforce', version: 4 }]]);

  it('treats a name collision as a conflict unless replace is requested', () => {
    const r = analyze(example(), ctx({ existingByName: existing }));
    expect(r.valid).toBe(false);
    expect(r.plan[0].action).toBe('conflict');
  });

  it('plans a replace, warning that it resets a live policy', () => {
    const r = analyze(example(), ctx({ existingByName: existing }), { onConflict: 'replace' });
    expect(r.valid).toBe(true);
    expect(r.plan[0]).toMatchObject({ action: 'replace', existing: { status: 'active', enforcement_mode: 'enforce' } });
    expect(r.warnings.some(w => /resets it to Draft \/ Observe/.test(w.message))).toBe(true);
  });

  it('blocks a replace that would delete a rule with violations attached', () => {
    const blocked = new Map([['pii output protection', [{ id: 'r9', name: 'old-rule', dependents: 3 }]]]);
    const r = analyze(example(), ctx({ existingByName: existing, blockedRules: blocked }), { onConflict: 'replace' });
    expect(r.valid).toBe(false);
    expect(r.errors[0].message).toMatch(/old-rule/);
  });
});

describe('buildBundle', () => {
  const policy = { id: 'p1', name: 'B Policy', description: 'd', enforcement_mode: 'enforce', status: 'active', version: 9, metadata_json: { bundle_version: '2.1.0' } };
  const rule = (o) => ({ policy_id: 'p1', name: null, rule_type: 'outbound_domain', severity: 'high', enabled: true, priority: 0, created_at: '2026-01-01', config_json: { b: 1, a: { z: 1, y: 2 } }, ...o });
  const entries = [
    { policy, rules: [rule({ priority: 2, name: 'second' }), rule({ priority: 1 }), rule({ priority: 1, rule_type: 'pii_detection', created_at: '2026-01-02' })],
      bindings: [{ entity_type: 'workflow', entity_id: 'z' }, { entity_type: 'ai_model', entity_id: '00000000-0000-0000-0000-000000000001' }] },
    { policy: { ...policy, id: 'p0', name: 'A Policy', metadata_json: null, description: null }, rules: [], bindings: [] },
  ];

  it('is deterministic and names unnamed rules <rule_type>-<n>', () => {
    const { bundle } = buildBundle(entries, { exportedAt: 'T' });
    expect(bundle.schema).toBe(BUNDLE_SCHEMA);
    expect(bundle.policies.map(p => p.name)).toEqual(['A Policy', 'B Policy']);
    const b = bundle.policies[1];
    expect(b).toMatchObject({ bundle_version: '2.1.0', requested_mode: 'enforce' });
    expect(b.rules.map(r => r.name)).toEqual(['outbound_domain-1', 'pii_detection-1', 'second']);
    expect(Object.keys(b.rules[0].config)).toEqual(['a', 'b']);
    expect(Object.keys(b.rules[0].config.a)).toEqual(['y', 'z']);
    expect(b.bindings.map(x => x.entity_type)).toEqual(['ai_model', 'workflow']);
    expect(JSON.stringify(buildBundle(entries, { exportedAt: 'T' }).bundle)).toBe(JSON.stringify(bundle));
    expect(bundle.policies[0]).not.toHaveProperty('bundle_version');
  });

  it('exports a bundle that passes structural validation (round trip)', () => {
    const { bundle } = buildBundle(entries, { exportedAt: 'T' });
    expect(validateStructure(bundle).errors).toEqual([]);
  });

  it('reports legacy rules instead of silently dropping them', () => {
    const legacy = { policy_id: 'p1', rule_type: null, condition_json: { x: 1 }, action: 'block', priority: 0 };
    const { bundle, legacy: found } = buildBundle([{ policy, rules: [legacy, rule({ name: 'ok' })], bindings: [] }]);
    expect(found).toEqual([{ name: 'B Policy', legacy_rules: 1 }]);
    expect(bundle.policies[0].rules).toHaveLength(1);
  });
});

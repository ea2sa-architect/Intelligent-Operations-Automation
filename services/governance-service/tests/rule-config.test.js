import { describe, it, expect } from 'vitest';
import { validateRuleConfig, checkJsonShape, RULE_NAME_RE } from '../src/lib/rule-config.js';

const SCHEMA = {
  fields: [
    { name: 'inspection_targets', type: 'multi_enum', options: ['prompt', 'email'] },
    { name: 'sensitive_fields', type: 'json_array' },
    { name: 'block_unlisted', type: 'enum', options: ['true', 'false'] },
    { name: 'note', type: 'string' },
    { name: 'owner', type: 'string', required: true },
    { name: 'severity', type: 'severity', required: true, options: ['low', 'high'] },
  ],
};
const ok = { owner: 'sec-team' };
const paths = errs => errs.map(e => e.path);

describe('validateRuleConfig', () => {
  it('accepts a valid config and ignores the severity field (a rule-level column)', () => {
    expect(validateRuleConfig(SCHEMA, { ...ok, inspection_targets: ['email'], sensitive_fields: ['ssn'], block_unlisted: 'true' })).toEqual([]);
  });

  it('accepts a boolean for an enum whose options are "true"/"false"', () => {
    expect(validateRuleConfig(SCHEMA, { ...ok, block_unlisted: true })).toEqual([]);
  });

  it('rejects keys the rule type does not define', () => {
    expect(paths(validateRuleConfig(SCHEMA, { ...ok, surprise: 1 }))).toEqual(['config.surprise']);
  });

  it('rejects a severity key inside config (it belongs on the rule)', () => {
    expect(paths(validateRuleConfig(SCHEMA, { ...ok, severity: 'high' }))).toEqual(['config.severity']);
  });

  it('requires required fields, treating empty values as missing', () => {
    expect(paths(validateRuleConfig(SCHEMA, {}))).toEqual(['config.owner']);
    expect(paths(validateRuleConfig(SCHEMA, { owner: '' }))).toEqual(['config.owner']);
  });

  it('checks enum, multi_enum, json_array and string types', () => {
    const errs = validateRuleConfig(SCHEMA, {
      ...ok, block_unlisted: 'maybe', inspection_targets: ['email', 'nope'], sensitive_fields: 'ssn', note: 5,
    });
    expect(paths(errs).sort()).toEqual(['config.block_unlisted', 'config.inspection_targets', 'config.note', 'config.sensitive_fields']);
  });

  it('rejects a non-object config', () => {
    expect(validateRuleConfig(SCHEMA, [])).toEqual([{ path: 'config', message: 'must be an object' }]);
  });

  it('has nothing to validate against a rule type with no field list', () => {
    expect(validateRuleConfig(undefined, { anything: 1 })).toEqual([]);
    expect(validateRuleConfig({}, { anything: 1 })).toEqual([]);
  });

  it('uses the given path prefix', () => {
    expect(paths(validateRuleConfig(SCHEMA, {}, 'policies[0].rules[1].config'))).toEqual(['policies[0].rules[1].config.owner']);
  });
});

describe('checkJsonShape', () => {
  it('rejects oversized and over-deep values and forbidden keys', () => {
    expect(checkJsonShape({ a: 'x'.repeat(20_000) })).toMatch(/too large/);
    let deep = {}; const root = deep;
    for (let i = 0; i < 12; i++) { deep.n = {}; deep = deep.n; }
    expect(checkJsonShape(root)).toMatch(/nested deeper/);
    expect(checkJsonShape(JSON.parse('{"__proto__": {"x": 1}}'))).toMatch(/forbidden key/);
  });

  it('accepts ordinary config', () => {
    expect(checkJsonShape({ a: [1, 2, { b: 'c' }] })).toBeNull();
  });
});

describe('RULE_NAME_RE', () => {
  it('allows readable names and rejects control characters and leading punctuation', () => {
    expect(RULE_NAME_RE.test('pii-in-output')).toBe(true);
    expect(RULE_NAME_RE.test('Block external (webhook)')).toBe(true);
    expect(RULE_NAME_RE.test('-bad')).toBe(false);
    expect(RULE_NAME_RE.test('bad\nname')).toBe(false);
    expect(RULE_NAME_RE.test('x'.repeat(129))).toBe(false);
  });
});

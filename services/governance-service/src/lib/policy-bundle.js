// Policy bundles (policy-as-code) — format, export shaping and validation.
//
// A bundle is a portable JSON description of one or more policies:
//
//   { schema: 'ioa.policy-bundle/v1', exported_at?, policies: [{
//       name, description?, bundle_version?, requested_mode,
//       rules:    [{ name, rule_type, severity?, enabled?, priority?, config? }],
//       bindings: [{ entity_type, entity_id }] }] }
//
// `requested_mode` is what the author wants. Import never applies it: every
// imported policy lands as status=draft, enforcement_mode=observe, and going
// live is the existing deliberate step. Binding ids are environment-specific,
// so bundles are same-environment today.
//
// Validation is split so the structural half is pure and testable: validate-
// Structure() needs no database, loadContext() gathers what the DB can say
// (rule schemas, existing policies, binding targets), and validateBundle()
// combines them into { errors, warnings, plan }.

import { validateRuleConfig, checkJsonShape, isPlainObject, RULE_NAME_RE } from './rule-config.js';
import { entityRefError, findMissingTargets } from './binding-targets.js';
import { UNEVALUATED_RULE_TYPES } from './unevaluated-rules.js';

export const BUNDLE_SCHEMA = 'ioa.policy-bundle/v1';
export const LIMITS = { maxPolicies: 100, maxRulesPerPolicy: 200, maxBindingsPerPolicy: 500, maxName: 255, maxDescription: 2000, maxLabel: 64 };
export const MODES = ['observe', 'warn', 'enforce'];
export const SEVERITIES = ['low', 'medium', 'high', 'critical'];

const BUNDLE_KEYS  = ['schema', 'exported_at', 'policies'];
const POLICY_KEYS  = ['name', 'description', 'bundle_version', 'requested_mode', 'rules', 'bindings'];
const RULE_KEYS    = ['name', 'rule_type', 'severity', 'enabled', 'priority', 'config'];
const BINDING_KEYS = ['entity_type', 'entity_id'];

// ── export ──────────────────────────────────────────────────────────────

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (isPlainObject(v)) return Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeys(v[k])]));
  return v;
}

// entries: [{ policy, rules, bindings }] straight from the DB. Output is
// deterministic (policies by name, rules by priority then name, bindings by
// type then id, config keys sorted) so re-exporting an unchanged policy gives
// byte-identical JSON and Git diffs show only real changes.
// Legacy rules (condition_json, no rule_type) have no v1 representation; they
// are left out of the bundle and reported in `legacy` so the caller can refuse
// or knowingly skip them.
export function buildBundle(entries, { exportedAt = new Date().toISOString() } = {}) {
  const legacy = [];
  const policies = entries
    .map(({ policy, rules, bindings }) => {
      const typed = rules.filter(r => r.rule_type);
      const legacyCount = rules.length - typed.length;
      if (legacyCount > 0) legacy.push({ name: policy.name, legacy_rules: legacyCount });

      const used = new Set(typed.filter(r => r.name).map(r => r.name.toLowerCase()));
      const counters = {};
      const outRules = typed
        .slice()
        .sort((a, b) => (a.priority - b.priority) || String(a.created_at).localeCompare(String(b.created_at)))
        .map(r => {
          let name = r.name;
          while (!name) {
            counters[r.rule_type] = (counters[r.rule_type] ?? 0) + 1;
            const candidate = `${r.rule_type}-${counters[r.rule_type]}`;
            if (!used.has(candidate.toLowerCase())) { name = candidate; used.add(candidate.toLowerCase()); }
          }
          return { name, rule_type: r.rule_type, severity: r.severity, enabled: r.enabled, priority: r.priority, config: sortKeys(r.config_json ?? {}) };
        })
        .sort((a, b) => (a.priority - b.priority) || a.name.localeCompare(b.name));

      const out = { name: policy.name };
      if (policy.description) out.description = policy.description;
      const label = policy.metadata_json?.bundle_version;
      if (label) out.bundle_version = label;
      out.requested_mode = policy.enforcement_mode;
      out.rules = outRules;
      out.bindings = bindings
        .map(b => ({ entity_type: b.entity_type, entity_id: b.entity_id }))
        .sort((a, b) => a.entity_type.localeCompare(b.entity_type) || a.entity_id.localeCompare(b.entity_id));
      return out;
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { bundle: { schema: BUNDLE_SCHEMA, exported_at: exportedAt, policies }, legacy };
}

// ── validation ──────────────────────────────────────────────────────────

const err = (path, message) => ({ path, message });

function checkKeys(obj, allowed, path, errors) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) errors.push(err(`${path}.${key}`, 'unknown field'));
  }
}

function checkString(value, path, errors, { max, required = false, re, what = 'a string' } = {}) {
  if (value === undefined || value === null) {
    if (required) errors.push(err(path, 'is required'));
    return false;
  }
  if (typeof value !== 'string' || (required && value.trim() === '')) {
    errors.push(err(path, `must be ${what}`));
    return false;
  }
  if (value.length > max) { errors.push(err(path, `must be at most ${max} characters`)); return false; }
  if (re && !re.test(value)) { errors.push(err(path, 'contains characters that are not allowed')); return false; }
  return true;
}

// Pure structural validation. Returns { errors, warnings, policies } where
// policies is the normalized form (defaults applied) used for the DB checks
// and for apply. Never touches the database.
export function validateStructure(bundle) {
  const errors = [];
  const warnings = [];
  const policies = [];

  if (!isPlainObject(bundle)) return { errors: [err('bundle', 'must be a JSON object')], warnings, policies };
  checkKeys(bundle, BUNDLE_KEYS, 'bundle', errors);
  if (bundle.schema !== BUNDLE_SCHEMA) errors.push(err('schema', `must be "${BUNDLE_SCHEMA}"`));
  if (bundle.exported_at !== undefined) checkString(bundle.exported_at, 'exported_at', errors, { max: 64 });

  if (!Array.isArray(bundle.policies) || bundle.policies.length === 0) {
    errors.push(err('policies', 'must be a non-empty list'));
    return { errors, warnings, policies };
  }
  if (bundle.policies.length > LIMITS.maxPolicies) {
    errors.push(err('policies', `at most ${LIMITS.maxPolicies} policies per bundle`));
    return { errors, warnings, policies };
  }

  const seenPolicyNames = new Set();
  bundle.policies.forEach((p, i) => {
    const at = `policies[${i}]`;
    if (!isPlainObject(p)) { errors.push(err(at, 'must be an object')); return; }
    checkKeys(p, POLICY_KEYS, at, errors);

    const nameOk = checkString(p.name, `${at}.name`, errors, { max: LIMITS.maxName, required: true });
    if (nameOk) {
      const key = p.name.trim().toLowerCase();
      if (seenPolicyNames.has(key)) errors.push(err(`${at}.name`, `duplicate policy name "${p.name}"`));
      seenPolicyNames.add(key);
    }
    checkString(p.description, `${at}.description`, errors, { max: LIMITS.maxDescription });
    checkString(p.bundle_version, `${at}.bundle_version`, errors, { max: LIMITS.maxLabel });

    if (!MODES.includes(p.requested_mode)) errors.push(err(`${at}.requested_mode`, `must be one of: ${MODES.join(', ')}`));

    const rules = [];
    if (!Array.isArray(p.rules)) errors.push(err(`${at}.rules`, 'must be a list'));
    else if (p.rules.length > LIMITS.maxRulesPerPolicy) errors.push(err(`${at}.rules`, `at most ${LIMITS.maxRulesPerPolicy} rules per policy`));
    else {
      const seenRuleNames = new Set();
      p.rules.forEach((r, j) => {
        const rat = `${at}.rules[${j}]`;
        if (!isPlainObject(r)) { errors.push(err(rat, 'must be an object')); return; }
        checkKeys(r, RULE_KEYS, rat, errors);

        if (checkString(r.name, `${rat}.name`, errors, { max: 128, required: true, re: RULE_NAME_RE })) {
          const key = r.name.toLowerCase();
          if (seenRuleNames.has(key)) errors.push(err(`${rat}.name`, `duplicate rule name "${r.name}" in this policy`));
          seenRuleNames.add(key);
        }
        checkString(r.rule_type, `${rat}.rule_type`, errors, { max: 100, required: true });

        const severity = r.severity ?? 'medium';
        if (!SEVERITIES.includes(severity)) errors.push(err(`${rat}.severity`, `must be one of: ${SEVERITIES.join(', ')}`));
        const enabled = r.enabled ?? true;
        if (typeof enabled !== 'boolean') errors.push(err(`${rat}.enabled`, 'must be true or false'));
        const priority = r.priority ?? 0;
        if (!Number.isInteger(priority) || Math.abs(priority) > 32767) errors.push(err(`${rat}.priority`, 'must be an integer between -32767 and 32767'));

        const config = r.config ?? {};
        if (!isPlainObject(config)) errors.push(err(`${rat}.config`, 'must be an object'));
        else {
          const shape = checkJsonShape(config);
          if (shape) errors.push(err(`${rat}.config`, shape));
        }
        rules.push({ name: r.name, rule_type: r.rule_type, severity, enabled, priority, config });
      });
    }

    const bindings = [];
    if (!Array.isArray(p.bindings)) errors.push(err(`${at}.bindings`, 'must be a list'));
    else if (p.bindings.length > LIMITS.maxBindingsPerPolicy) errors.push(err(`${at}.bindings`, `at most ${LIMITS.maxBindingsPerPolicy} bindings per policy`));
    else {
      const seenBindings = new Set();
      p.bindings.forEach((b, j) => {
        const bat = `${at}.bindings[${j}]`;
        if (!isPlainObject(b)) { errors.push(err(bat, 'must be an object')); return; }
        checkKeys(b, BINDING_KEYS, bat, errors);
        const refErr = entityRefError(b.entity_type, b.entity_id);
        if (refErr) { errors.push(err(bat, refErr)); return; }
        const key = `${b.entity_type}:${b.entity_id}`.toLowerCase();
        if (seenBindings.has(key)) errors.push(err(bat, `duplicate binding ${b.entity_type} ${b.entity_id}`));
        seenBindings.add(key);
        bindings.push({ entity_type: b.entity_type, entity_id: b.entity_id });
      });
      if (p.bindings.length === 0) {
        warnings.push(err(`${at}.bindings`, 'no bindings: this policy will not apply to anything until it is bound to a target'));
      }
    }

    if (Array.isArray(p.rules) && p.rules.length === 0) warnings.push(err(`${at}.rules`, 'no rules: this policy has nothing to evaluate'));

    policies.push({
      name: typeof p.name === 'string' ? p.name.trim() : p.name,
      description: typeof p.description === 'string' ? p.description : null,
      bundle_version: typeof p.bundle_version === 'string' ? p.bundle_version : null,
      requested_mode: p.requested_mode,
      rules,
      bindings,
    });
  });

  return { errors, warnings, policies };
}

// Everything validation needs from the database, fetched in a few batched
// queries. `db` is the pool (or a client). Only called once structure is clean.
export async function loadContext(db, policies, { onConflict } = {}) {
  const types = [...new Set(policies.flatMap(p => p.rules.map(r => r.rule_type)))];
  const { rows: schemaRows } = types.length
    ? await db.query('SELECT type, schema_json FROM rule_schemas WHERE type = ANY($1::text[])', [types])
    : { rows: [] };
  const ruleSchemas = new Map(schemaRows.map(r => [r.type, r.schema_json]));

  const { rows: existingRows } = await db.query(
    'SELECT id, name, status, enforcement_mode, version FROM policies WHERE lower(name) = ANY($1::text[])',
    [policies.map(p => p.name.toLowerCase())]
  );
  const existingByName = new Map(existingRows.map(r => [r.name.toLowerCase(), r]));

  const refs = policies.flatMap(p => p.bindings);
  const missingTargets = refs.length ? await findMissingTargets(db, refs) : new Set();

  // Replacing keeps rule ids stable where names match (violations and control
  // tests point at rule ids). A rule the bundle drops can only be deleted if
  // nothing depends on it; report the ones that block.
  const blockedRules = new Map();
  if (onConflict === 'replace' && existingRows.length) {
    for (const row of existingRows) {
      const incoming = policies.find(p => p.name.toLowerCase() === row.name.toLowerCase());
      const keep = new Set(incoming.rules.map(r => r.name.toLowerCase()));
      const { rows } = await db.query(
        `SELECT r.id, r.name, r.rule_type,
                (SELECT COUNT(*) FROM violations v WHERE v.rule_id = r.id)::int
              + (SELECT COUNT(*) FROM control_tests c WHERE c.violation_rule_id = r.id)::int AS dependents
           FROM policy_rules r WHERE r.policy_id = $1`,
        [row.id]
      );
      const blocked = rows.filter(r => (!r.name || !keep.has(r.name.toLowerCase())) && r.dependents > 0);
      if (blocked.length) blockedRules.set(row.name.toLowerCase(), blocked);
    }
  }
  return { ruleSchemas, existingByName, missingTargets, blockedRules };
}

// Combines the structural result with database facts. Returns the full
// preview: { valid, errors, warnings, plan, policies }.
export function validateBundle(structure, ctx, { onConflict } = {}) {
  const errors = [...structure.errors];
  const warnings = [...structure.warnings];
  const plan = [];

  structure.policies.forEach((p, i) => {
    const at = `policies[${i}]`;

    const unevaluated = new Set();
    p.rules.forEach((r, j) => {
      const rat = `${at}.rules[${j}]`;
      const schema = ctx.ruleSchemas.get(r.rule_type);
      if (!schema) {
        errors.push(err(`${rat}.rule_type`, `unknown rule type "${r.rule_type}"`));
        return;
      }
      for (const e of validateRuleConfig(schema, r.config, `${rat}.config`)) errors.push(e);
      if (UNEVALUATED_RULE_TYPES.includes(r.rule_type)) {
        unevaluated.add(r.rule_type);
        warnings.push(err(`${rat}.rule_type`, `"${r.rule_type}" is not evaluated by the platform yet: this rule will not protect anything`));
      }
    });

    p.bindings.forEach((b, j) => {
      if (ctx.missingTargets.has(`${b.entity_type}:${b.entity_id}`)) {
        errors.push(err(`${at}.bindings[${j}]`, `${b.entity_type} ${b.entity_id} does not exist in this environment`));
      }
    });

    if (p.requested_mode !== 'observe') {
      warnings.push(err(`${at}.requested_mode`, `requests "${p.requested_mode}"; it will be imported as Draft / Observe and must be activated deliberately`));
    }

    const existing = ctx.existingByName.get(p.name.toLowerCase()) ?? null;
    let action = 'create';
    if (existing) {
      if (onConflict === 'replace') {
        action = 'replace';
        warnings.push(err(`${at}.name`, `replaces the existing policy (currently ${existing.status} / ${existing.enforcement_mode}) and resets it to Draft / Observe`));
        for (const r of ctx.blockedRules.get(p.name.toLowerCase()) ?? []) {
          errors.push(err(`${at}.name`, `cannot replace: existing rule "${r.name ?? r.rule_type}" is not in the bundle but has violations or control tests attached`));
        }
      } else {
        action = 'conflict';
        errors.push(err(`${at}.name`, `a policy named "${p.name}" already exists (re-run with on_conflict: "replace" to replace it)`));
      }
    }

    plan.push({
      name: p.name,
      action,
      existing: existing && { id: existing.id, status: existing.status, enforcement_mode: existing.enforcement_mode, version: existing.version },
      rules: p.rules.length,
      bindings: p.bindings.length,
      requested_mode: p.requested_mode,
      effective_mode: 'observe',
      unevaluated_rule_types: [...unevaluated],
    });
  });

  return { valid: errors.length === 0, errors, warnings, plan };
}

// Convenience used by both routes: structure → context → validation.
export async function analyzeBundle(db, bundle, { onConflict } = {}) {
  const structure = validateStructure(bundle);
  if (structure.errors.length) {
    return { valid: false, errors: structure.errors, warnings: structure.warnings, plan: [], policies: structure.policies };
  }
  const ctx = await loadContext(db, structure.policies, { onConflict });
  return { ...validateBundle(structure, ctx, { onConflict }), policies: structure.policies, ctx };
}

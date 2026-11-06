// Policy bundles (policy-as-code): export, validate and import.
//
//   GET  /policy-bundles/export    policy:read
//   POST /policy-bundles/validate  policy:read    dry run, writes nothing
//   POST /policy-bundles/import    policy:import  (+ policy:edit to replace)
//
// Imports always land as status=draft, enforcement_mode=observe, whatever the
// bundle requests; activating is the existing deliberate step. The whole import
// is one transaction, and import re-validates server-side rather than trusting
// an earlier /validate. See lib/policy-bundle.js for the format.

import { Router } from 'express';
import pool from '../../db.js';
import { requirePermission } from '../lib/require-auth.js';
import { analyzeBundle, buildBundle } from '../lib/policy-bundle.js';
import { logPolicyBundleExport, logPolicyBundleImport } from '../lib/audit-client.js';
import { UNEVALUATED_RULE_TYPES } from '../lib/unevaluated-rules.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(err.message);
  res.status(err.status ?? 500).json({ error: err.message });
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = ['draft', 'active', 'inactive', 'archived'];
const CONFLICT_MODES = ['reject', 'replace'];

const actorOf = req => req.user?.username || req.user?.id || (req.user?.isService ? 'service' : 'unknown');
const canEditPolicies = req => !!(req.user?.isService || req.user?.permissions?.includes('policy:edit'));

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// ── export ──────────────────────────────────────────────────────────────

router.get('/export', requirePermission('policy:read'), wrap(async (req, res) => {
  const { status, ids, skip_legacy } = req.query;
  const conditions = [];
  const params = [];
  if (status) {
    if (!STATUSES.includes(status)) throw new HttpError(400, `status must be one of: ${STATUSES.join(', ')}`);
    conditions.push(`status = $${params.push(status)}`);
  }
  if (ids) {
    const list = String(ids).split(',').map(s => s.trim()).filter(Boolean);
    if (!list.length || list.length > 100 || !list.every(i => UUID_RE.test(i))) {
      throw new HttpError(400, 'ids must be a comma-separated list of up to 100 policy ids');
    }
    conditions.push(`id = ANY($${params.push(list)}::uuid[])`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows: policies } = await pool.query(`SELECT * FROM policies ${where} ORDER BY name`, params);
  if (!policies.length) throw new HttpError(404, 'No policies match');

  const policyIds = policies.map(p => p.id);
  const [{ rows: rules }, { rows: bindings }] = await Promise.all([
    pool.query('SELECT * FROM policy_rules WHERE policy_id = ANY($1::uuid[])', [policyIds]),
    pool.query('SELECT policy_id, entity_type, entity_id FROM policy_bindings WHERE policy_id = ANY($1::uuid[])', [policyIds]),
  ]);

  const entries = policies.map(policy => ({
    policy,
    rules: rules.filter(r => r.policy_id === policy.id),
    bindings: bindings.filter(b => b.policy_id === policy.id),
  }));
  const { bundle, legacy } = buildBundle(entries);

  // A bundle that silently drops rules would restore to a weaker policy, so
  // refuse unless the caller says they know.
  if (legacy.length && skip_legacy !== 'true') {
    logPolicyBundleExport({ actorId: actorOf(req), outcome: 'failure', policyNames: policies.map(p => p.name), reason: 'legacy_rules' });
    return res.status(422).json({
      error: 'Some policies contain legacy (condition_json) rules that a bundle cannot represent. Pass skip_legacy=true to export without them.',
      policies: legacy,
    });
  }

  logPolicyBundleExport({ actorId: actorOf(req), outcome: 'success', policyNames: bundle.policies.map(p => p.name) });
  res.set('Content-Disposition', `attachment; filename="ioa-policy-bundle-${bundle.exported_at.slice(0, 10)}.json"`);
  res.type('application/json').send(`${JSON.stringify(bundle, null, 2)}\n`);
}));

// ── validate (dry run) ──────────────────────────────────────────────────

function readRequest(req) {
  const { bundle, on_conflict } = req.body ?? {};
  if (on_conflict !== undefined && !CONFLICT_MODES.includes(on_conflict)) {
    throw new HttpError(400, `on_conflict must be one of: ${CONFLICT_MODES.join(', ')}`);
  }
  return { bundle, onConflict: on_conflict ?? 'reject' };
}

router.post('/validate', requirePermission('policy:read'), wrap(async (req, res) => {
  const { bundle, onConflict } = readRequest(req);
  const { valid, errors, warnings, plan } = await analyzeBundle(pool, bundle, { onConflict });
  res.json({ valid, errors, warnings, plan });
}));

// ── import ──────────────────────────────────────────────────────────────

async function ruleDependents(client, ruleId) {
  const { rows: [row] } = await client.query(
    `SELECT (SELECT COUNT(*) FROM violations WHERE rule_id = $1)::int
          + (SELECT COUNT(*) FROM control_tests WHERE violation_rule_id = $1)::int AS n`,
    [ruleId]
  );
  return row.n;
}

// Writes one policy inside the caller's transaction. Returns { id, action }.
async function applyPolicy(client, p, { onConflict, actor, importedAt }) {
  const { rows: existingRows } = await client.query(
    'SELECT * FROM policies WHERE lower(name) = lower($1) FOR UPDATE', [p.name]
  );
  if (existingRows.length > 1) throw new HttpError(409, `More than one existing policy matches "${p.name}" ignoring case`);
  const existing = existingRows[0];
  if (existing && onConflict !== 'replace') {
    throw new HttpError(409, `A policy named "${p.name}" was created after validation; nothing was imported`);
  }

  const unevaluated = [...new Set(p.rules.map(r => r.rule_type).filter(t => UNEVALUATED_RULE_TYPES.includes(t)))];
  const metadata = {
    ...(existing?.metadata_json ?? {}),
    bundle_version: p.bundle_version,
    requested_mode: p.requested_mode,
    imported_by: actor,
    imported_at: importedAt,
    unevaluated_rule_types: unevaluated,
  };

  let policy;
  if (existing) {
    // Keep the existing name (matching was case-insensitive), reset to the
    // safe landing state, and bump the version so the change is snapshotted.
    ({ rows: [policy] } = await client.query(
      `UPDATE policies
          SET description = $2, status = 'draft', enforcement_mode = 'observe',
              version = version + 1, metadata_json = $3, updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [existing.id, p.description, JSON.stringify(metadata)]
    ));
  } else {
    ({ rows: [policy] } = await client.query(
      `INSERT INTO policies (name, description, status, enforcement_mode, metadata_json)
       VALUES ($1, $2, 'draft', 'observe', $3) RETURNING *`,
      [p.name, p.description, JSON.stringify(metadata)]
    ));
  }

  const ruleSql = {
    insert: `INSERT INTO policy_rules (policy_id, name, rule_type, config_json, severity, enabled, priority)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    // No policy_id parameter: Postgres cannot type a parameter the statement never uses.
    update: `UPDATE policy_rules
                SET name = $1, rule_type = $2, config_json = $3, severity = $4, enabled = $5, priority = $6,
                    condition_json = NULL, action = NULL
              WHERE id = $7`,
  };

  if (existing) {
    // Match by name so rule ids (and the violations pointing at them) survive.
    const { rows: oldRules } = await client.query('SELECT id, name FROM policy_rules WHERE policy_id = $1 FOR UPDATE', [policy.id]);
    const oldByName = new Map(oldRules.filter(r => r.name).map(r => [r.name.toLowerCase(), r]));
    const kept = new Set();
    for (const r of p.rules) {
      const match = oldByName.get(r.name.toLowerCase());
      const values = [r.name, r.rule_type, JSON.stringify(r.config), r.severity, r.enabled, r.priority];
      if (match) { kept.add(match.id); await client.query(ruleSql.update, [...values, match.id]); }
      else await client.query(ruleSql.insert, [policy.id, ...values]);
    }
    for (const old of oldRules.filter(o => !kept.has(o.id))) {
      if (await ruleDependents(client, old.id) > 0) {
        throw new HttpError(409, `Cannot replace "${p.name}": existing rule "${old.name ?? old.id}" is not in the bundle but has violations or control tests attached`);
      }
      await client.query('DELETE FROM policy_rules WHERE id = $1', [old.id]);
    }
    const keys = p.bindings.map(b => `${b.entity_type}:${b.entity_id}`);
    await client.query(
      `DELETE FROM policy_bindings WHERE policy_id = $1 AND (entity_type || ':' || entity_id) <> ALL($2::text[])`,
      [policy.id, keys]
    );
  } else {
    for (const r of p.rules) {
      await client.query(ruleSql.insert, [policy.id, r.name, r.rule_type, JSON.stringify(r.config), r.severity, r.enabled, r.priority]);
    }
  }
  for (const b of p.bindings) {
    await client.query(
      `INSERT INTO policy_bindings (policy_id, entity_type, entity_id) VALUES ($1, $2, $3)
       ON CONFLICT (policy_id, entity_type, entity_id) DO NOTHING`,
      [policy.id, b.entity_type, b.entity_id]
    );
  }

  await client.query(
    'INSERT INTO policy_versions (policy_id, version, snapshot_json) VALUES ($1, $2, $3)',
    [policy.id, policy.version, policy]
  );
  return { id: policy.id, name: policy.name, action: existing ? 'replaced' : 'created' };
}

router.post('/import', requirePermission('policy:import'), wrap(async (req, res) => {
  const { bundle, onConflict } = readRequest(req);
  const actor = actorOf(req);

  // Replacing a live policy is at least as consequential as editing or
  // deactivating one, so policy:import alone is not enough.
  if (onConflict === 'replace' && !canEditPolicies(req)) {
    throw new HttpError(403, 'Permission required: policy:edit (replacing an existing policy)');
  }

  const analysis = await analyzeBundle(pool, bundle, { onConflict });
  if (!analysis.valid) {
    logPolicyBundleImport({ actorId: actor, outcome: 'failure', onConflict, reason: 'validation', results: [] });
    return res.status(422).json({ valid: false, errors: analysis.errors, warnings: analysis.warnings, plan: analysis.plan });
  }

  // Fixed order so two concurrent imports lock policy rows consistently.
  const ordered = analysis.policies.slice().sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  const importedAt = new Date().toISOString();
  const client = await pool.connect();
  let results;
  try {
    await client.query('BEGIN');
    results = [];
    for (const p of ordered) results.push(await applyPolicy(client, p, { onConflict, actor, importedAt }));
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // A unique violation here means someone created the same policy or rule
    // name between our validation and our write; the constraint caught it.
    const status = err.status ?? (err.code === '23505' ? 409 : 500);
    const message = err.code === '23505' ? 'A policy or rule with the same name was created concurrently; nothing was imported' : err.message;
    logPolicyBundleImport({ actorId: actor, outcome: 'failure', onConflict, reason: message, results: [] });
    throw new HttpError(status, message);
  } finally {
    client.release();
  }

  // Only now, after COMMIT, is it true that the import happened.
  logPolicyBundleImport({ actorId: actor, outcome: 'success', onConflict, results: results.map(r => ({ name: r.name, id: r.id, action: r.action })) });
  res.status(201).json({
    imported: results.map(r => ({ ...r, status: 'draft', enforcement_mode: 'observe' })),
    warnings: analysis.warnings,
  });
}));

export default router;

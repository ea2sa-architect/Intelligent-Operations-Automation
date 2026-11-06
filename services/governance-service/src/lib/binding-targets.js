// Policy-binding targets: which entity types a policy can be bound to, what a
// well-formed id looks like for each, and whether the target actually exists.
//
// The four types match ASSET_EVALUATORS in routes/enforcement.js — anything else
// would bind a policy to something /enforce can never evaluate. Existence is
// checked with schema-qualified reads, the same cross-schema access
// enforcement.js and rule-evaluator.js already use (single Postgres database).
//
// Zaps have no registry table: evaluateZap auto-binds the seeded Zap policy on
// a Zap's first evaluation. So a Zap "exists" if some policy already has a
// binding for it.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

const TARGETS = {
  // workflow ids are TEXT (n8n-derived), not UUIDs
  workflow:   { idRe: TEXT_ID_RE, sql: 'SELECT id::text AS id FROM workflow_governance.workflows WHERE id = ANY($1::text[])' },
  mcp_server: { idRe: UUID_RE,    sql: 'SELECT id::text AS id FROM mcp_governance.mcp_servers WHERE id = ANY($1::uuid[])' },
  ai_model:   { idRe: UUID_RE,    sql: 'SELECT id::text AS id FROM ai_inference.models WHERE id = ANY($1::uuid[])' },
  zap:        { idRe: TEXT_ID_RE, sql: "SELECT DISTINCT entity_id AS id FROM policy_bindings WHERE entity_type = 'zap' AND entity_id = ANY($1::text[])" },
};

export const BINDABLE_ENTITY_TYPES = Object.keys(TARGETS);

// Returns an error message, or null when type and id are well-formed.
export function entityRefError(entityType, entityId) {
  const target = TARGETS[entityType];
  if (!target) return `entity_type must be one of: ${BINDABLE_ENTITY_TYPES.join(', ')}`;
  if (typeof entityId !== 'string' || !target.idRe.test(entityId)) {
    return `entity_id is not a valid ${entityType} id`;
  }
  return null;
}

// refs: [{ entity_type, entity_id }], all already well-formed. Returns the
// subset that does not exist, as a Set of "type:id" keys.
export async function findMissingTargets(db, refs) {
  const byType = new Map();
  for (const r of refs) {
    if (!byType.has(r.entity_type)) byType.set(r.entity_type, new Set());
    byType.get(r.entity_type).add(r.entity_id);
  }

  const missing = new Set();
  for (const [type, ids] of byType) {
    const { rows } = await db.query(TARGETS[type].sql, [[...ids]]);
    const found = new Set(rows.map(r => r.id.toLowerCase()));
    for (const id of ids) {
      if (!found.has(id.toLowerCase())) missing.add(`${type}:${id}`);
    }
  }
  return missing;
}

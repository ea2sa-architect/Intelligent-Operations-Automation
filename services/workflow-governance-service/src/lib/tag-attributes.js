// Parses free-form workflow tags into ownership + business-classification
// attributes and applies them to workflow_governance.workflows.
//
// Recognized prefixes: owner:, team:, backup-owner:, escalation:, domain:,
// capability:, criticality:, data:
//
// Ownership fields respect manual overrides: once ownership_source = 'manual'
// (set by an explicit SPA edit, not by this parser), tag-driven sync no longer
// touches technical_owner/business_owner/owning_team for that workflow.
// Business classification fields have no such distinction — they're always
// tag-driven, per the "classification-only, always in sync with tags" design.

import pool from '../../db.js';

const CRITICALITY_VALUES = ['low', 'moderate', 'high', 'mission_critical'];

// Tags arrive as plain strings (workflows.tags TEXT[]) or, from some upstream
// APIs, as { id, name } objects — normalize before parsing either way.
function normalizeTags(tags = []) {
  return tags.map(t => (typeof t === 'string' ? t : t?.name ?? '')).filter(Boolean);
}

function prefixValue(rawTags, prefix) {
  const tags = normalizeTags(rawTags);
  const match = tags.find(t => t.toLowerCase().startsWith(prefix));
  return match ? match.slice(prefix.length).trim() || null : null;
}

function parseOwnership(tags) {
  return {
    technical_owner:    prefixValue(tags, 'owner:'),
    business_owner:     prefixValue(tags, 'business-owner:'),
    owning_team:        prefixValue(tags, 'team:'),
    backup_owner:       prefixValue(tags, 'backup-owner:'),
    escalation_contact: prefixValue(tags, 'escalation:'),
  };
}

// Merges freshly-parsed tags with the workflow's current DB row for use as
// *scoring* input (not persistence — see `apply` for the persisted merge).
// Manual overrides always win; otherwise the freshly parsed tag value wins,
// falling back to whatever was already on the row.
function resolveForScoring(existingRow = {}, tags = []) {
  const parsed = parseOwnership(tags);
  const manual = existingRow.ownership_source === 'manual';
  return {
    technical_owner:       manual ? existingRow.technical_owner : (parsed.technical_owner ?? existingRow.technical_owner ?? null),
    business_owner:        manual ? existingRow.business_owner  : (parsed.business_owner  ?? existingRow.business_owner  ?? null),
    ownership_verified_at: existingRow.ownership_verified_at ?? null,
  };
}

function parseBusinessClassification(tags) {
  const criticality = prefixValue(tags, 'criticality:')?.toLowerCase();
  return {
    business_domain:     prefixValue(tags, 'domain:'),
    business_capability: prefixValue(tags, 'capability:'),
    criticality:         CRITICALITY_VALUES.includes(criticality) ? criticality : null,
    data_classification: prefixValue(tags, 'data:'),
  };
}

// Applies both ownership and business-classification tag attributes to a
// workflow in one UPDATE. Safe to call on every import/discover/rescore —
// no-ops on fields that have no matching tag (COALESCE keeps the prior value).
async function apply(workflowId, tags = []) {
  const own  = parseOwnership(tags);
  const biz  = parseBusinessClassification(tags);
  const hasOwnershipTag = Object.values(own).some(Boolean);

  await pool.query(
    `UPDATE workflow_governance.workflows
        SET technical_owner    = CASE WHEN ownership_source = 'manual' THEN technical_owner
                                       ELSE COALESCE($2, technical_owner) END,
            owning_team        = CASE WHEN ownership_source = 'manual' THEN owning_team
                                       ELSE COALESCE($3, owning_team) END,
            backup_owner       = CASE WHEN ownership_source = 'manual' THEN backup_owner
                                       ELSE COALESCE($4, backup_owner) END,
            escalation_contact = CASE WHEN ownership_source = 'manual' THEN escalation_contact
                                       ELSE COALESCE($5, escalation_contact) END,
            ownership_source   = CASE WHEN ownership_source = 'manual' THEN ownership_source
                                       WHEN $6 THEN 'tag' ELSE ownership_source END,
            business_domain     = COALESCE($7,  business_domain),
            business_capability = COALESCE($8,  business_capability),
            criticality         = COALESCE($9,  criticality),
            data_classification = COALESCE($10, data_classification)
      WHERE id = $1`,
    [
      workflowId,
      own.technical_owner, own.owning_team, own.backup_owner, own.escalation_contact,
      hasOwnershipTag,
      biz.business_domain, biz.business_capability, biz.criticality, biz.data_classification,
    ]
  );
}

// Effective criticality for scoring/ATI purposes: freshly parsed tag wins,
// falling back to whatever is already on the row.
function resolveCriticality(existingCriticality, tags = []) {
  return parseBusinessClassification(tags).criticality ?? existingCriticality ?? null;
}

export default { apply, parseOwnership, parseBusinessClassification, resolveForScoring, resolveCriticality };

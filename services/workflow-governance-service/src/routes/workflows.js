import { Router } from 'express';
import pool from '../../db.js';
import cache from '../lib/cache.js';
import n8nClient from '../lib/n8n-client.js';
import extractor from '../lib/metadata-extractor.js';
import { getImporter } from '../lib/platform-importers.js';
import scorer from '../lib/risk-scorer.js';
import policyInference from '../lib/policy-inference.js';
import { getAdapter } from '../lib/adapters/index.js';
import riskHistory from '../lib/risk-history.js';
import trustIndex from '../lib/trust-index.js';
import tagAttributes from '../lib/tag-attributes.js';
import governancePostureClient from '../lib/governance-posture-client.js';
import enforcementClient from '../lib/enforcement-client.js';
import telemetryClient from '../lib/telemetry-client.js';
import mcpGovernanceClient from '../lib/mcp-governance-client.js';
import requireAuth, { requirePermission } from '../lib/require-auth.js';
import mcpTrustCeiling from '../lib/mcp-trust-ceiling.js';
import verifyN8nCallback from '../lib/verify-n8n-signature.js';
import { logWorkflowsCleared, logWorkflowsRestored } from '../lib/audit-client.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => {
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  res.status(500).json({ error: err.message });
});

// Shared by every code path that scores a workflow: computes the executive-facing
// Automation Trust Index alongside the engineering risk_score. All four inputs
// below are raw *risk*-direction dimension scores (higher = worse) — same as
// riskScore.risk_score itself — trustIndex.computeTrustIndex is the single
// place that inverts each into a trust-direction value. Don't invert here too;
// that was a real bug (recorded evidence made ATI's assurance input go *down*).
function computeAti(riskScore, criticality, mcpCeilings = []) {
  return trustIndex.computeTrustIndex({
    riskScore: riskScore.risk_score,
    governancePostureScore: riskScore.dimensions?.governance_posture?.score,
    recoverabilityRiskScore: riskScore.dimensions?.recoverability?.score,
    operationalRiskScore: riskScore.dimensions?.operational_visibility?.score,
    criticality,
    mcpCeilings,
  });
}

// EP-101-S9 — before wiping this workflow's secret-exposure rows for a fresh
// scan, carry forward rotation_confirmed_at/by for any finding whose exact
// fingerprint reappears. A credential claimed as rotated that's detected
// again (same fingerprint) keeps showing its rotation-confirmed state next
// to a finding that's still present — proof the claim didn't hold. A finding
// that genuinely disappears (fingerprint gone) just isn't reinserted, and
// its rotation-confirmed state goes with it.
async function persistSecretExposure(workflowId, risks) {
  const { rows: existing } = await pool.query(
    `SELECT fingerprint_sha256, rotation_confirmed_at, rotation_confirmed_by
       FROM workflow_governance.workflow_secret_exposure WHERE workflow_id = $1`,
    [workflowId]
  );
  const priorByFingerprint = new Map(existing.map(e => [e.fingerprint_sha256, e]));

  await pool.query('DELETE FROM workflow_governance.workflow_secret_exposure WHERE workflow_id = $1', [workflowId]);
  for (const risk of risks) {
    const carried = priorByFingerprint.get(risk.fingerprint_sha256);
    await pool.query(
      `INSERT INTO workflow_governance.workflow_secret_exposure
         (workflow_id, secret_type, node_name, redacted_preview, fingerprint_sha256, rotation_confirmed_at, rotation_confirmed_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [workflowId, risk.secret_type, risk.node_name, risk.redacted_preview, risk.fingerprint_sha256,
       carried?.rotation_confirmed_at ?? null, carried?.rotation_confirmed_by ?? null]
    );
  }
}

// Assurance evidence lives in this same schema — a direct query, not a network
// client like governance-posture-client.js (which crosses a service boundary).
async function fetchEvidence(workflowId) {
  const { rows } = await pool.query(
    'SELECT * FROM workflow_governance.assurance_evidence WHERE workflow_id = $1',
    [workflowId]
  );
  return rows;
}

// Resolves each MCP-client node reference found in a workflow against the MCP
// registry — this is what makes "unregistered" observable rather than a
// tautology (see workflow_governance/015_mcp_references.sql). Split from
// persistence so the resolved result can also feed ATI ceiling computation
// (Feature 5.2) before the workflow row is written, without a duplicate
// resolve call.
//
// EP-306-S6 — a cleanly-unregistered reference (not ambiguous, not a
// low-confidence/malformed extraction) is also reported as a discovery
// candidate, so it shows up in the same Discovered queue (S5) a config-file
// scan would populate. workflowLabel identifies the source workflow in the
// candidate's source_path — it's the caller's own name/id, not looked up
// here, since this function only knows about references, not the workflow.
async function resolveMcpReferences(mcpReferences = [], workflowLabel = null) {
  const resolved = [];
  for (const ref of mcpReferences) {
    const resolution = await mcpGovernanceClient.resolveServerReference(ref.server_reference);
    const ambiguous = !!resolution.ambiguous;
    resolved.push({
      node_name: ref.node_name,
      server_reference: ref.server_reference,
      registered: !!resolution.registered,
      mcp_server_id: resolution.registered ? resolution.id : null,
      mcp_server_name: resolution.registered ? resolution.name : null,
      // Epic 2, Feature 2.1 — carried through from metadata-extractor.js so
      // a reference recovered only via node-name fallback is distinguishable
      // from a confidently-extracted one.
      malformed: !!ref.malformed,
      malformed_reason: ref.malformed_reason ?? null,
      // Epic 2, Feature 2.2 — a reference matching more than one registered
      // server needs manual resolution, distinct from both registered/unregistered.
      ambiguous,
      ambiguous_candidates: ambiguous ? resolution.candidates ?? [] : null,
    });

    if (!resolution.registered && !ambiguous && !ref.malformed) {
      await mcpGovernanceClient.reportDiscovery({
        name: ref.server_reference,
        sourcePath: workflowLabel ? `n8n workflow: ${workflowLabel} (node: ${ref.node_name})` : `n8n workflow node: ${ref.node_name}`,
      });
    }
  }
  return resolved;
}

async function persistMcpReferences(workflowId, resolvedRefs = []) {
  await pool.query('DELETE FROM workflow_governance.workflow_mcp_references WHERE workflow_id = $1', [workflowId]);
  for (const ref of resolvedRefs) {
    await pool.query(
      `INSERT INTO workflow_governance.workflow_mcp_references
         (workflow_id, node_name, server_reference, mcp_server_id, mcp_server_name, registered,
          malformed, malformed_reason, ambiguous, ambiguous_candidates)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        workflowId, ref.node_name, ref.server_reference, ref.mcp_server_id, ref.mcp_server_name, ref.registered,
        ref.malformed ?? false, ref.malformed_reason ?? null,
        ref.ambiguous ?? false, ref.ambiguous_candidates ? JSON.stringify(ref.ambiguous_candidates) : null,
      ]
    );
  }
}

// Resolves an n8n platform_connections row into the { base_url, api_key }
// config n8nClient's functions take, so an admin who set up an n8n
// connection via the Integrations UI actually governs which instance
// Discover/Import pull from. With connectionId, resolves that specific
// row (the SPA sends the one selected in its connection dropdown when
// more than one n8n connection is registered — see WorkflowGovernance.jsx).
// Without it, falls back to the most recently connected row for backward
// compatibility with existing callers, and to {} (→ n8nClient's own
// N8N_BASE_URL/N8N_API_KEY env-var defaults) when no connection row
// exists at all, so a dev setup with no connections configured keeps
// working unchanged.
async function getN8nConfig(connectionId) {
  const { rows: [conn] } = connectionId
    ? await pool.query(
        `SELECT config_json FROM workflow_governance.platform_connections
           WHERE id = $1 AND platform = 'n8n' AND status = 'connected'`,
        [connectionId]
      )
    : await pool.query(
        `SELECT config_json FROM workflow_governance.platform_connections
           WHERE platform = 'n8n' AND status = 'connected'
           ORDER BY created_at DESC LIMIT 1`
      );
  return conn?.config_json ?? {};
}

// Derives ATI trust-ceiling conditions (Epic 5, Feature 5.2) from the
// resolved MCP references: fetches full detail for each registered server
// (owner, hosting environment, tools, authorizations) and hands it to the
// pure ceiling-derivation logic in mcp-trust-ceiling.js.
async function fetchMcpCeilings(resolvedRefs = []) {
  const serverIds = [...new Set(resolvedRefs.filter(r => r.registered).map(r => r.mcp_server_id))];
  const detailsById = new Map();
  for (const id of serverIds) {
    const detail = await mcpGovernanceClient.fetchServerDetail(id);
    if (detail) detailsById.set(id, detail);
  }
  return mcpTrustCeiling.deriveMcpCeilings(resolvedRefs, detailsById);
}

// ── GET /workflows ─────────────────────────────────────────────────────────
// List all discovered workflows with optional filters
router.get('/', requireAuth, wrap(async (req, res) => {
  const { risk_level, active, project_id, platform, limit = 50, offset = 0 } = req.query;
  const params = [];
  const where = [];

  if (risk_level)  { params.push(risk_level);         where.push(`risk_level  = $${params.length}`); }
  if (active !== undefined) { params.push(active === 'true'); where.push(`active = $${params.length}`); }
  if (project_id)  { params.push(project_id);         where.push(`project_id  = $${params.length}`); }
  if (platform)    { params.push(platform);            where.push(`platform    = $${params.length}`); }

  const whereClause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  params.push(Math.min(Number(limit) || 50, 200));
  params.push(Number(offset) || 0);

  const { rows } = await pool.query(
    `SELECT id, name, n8n_id, platform, source_id, active, risk_score, risk_level, tags,
            project_id, project_name, discovered_at, scored_at, policies_applied
       FROM workflow_governance.workflows
       ${whereClause}
       ORDER BY project_name NULLS LAST, risk_score DESC NULLS LAST
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json(rows);
}));

// ── GET /workflows/export ──────────────────────────────────────────────────
// Full snapshot of every table DELETE / below would wipe — meant to be
// downloaded immediately before a Clear All so an admin can start a fresh
// discovery session without losing the prior data. Mirrors DELETE /'s own
// scope exactly (same table list, same "unconditional, not filtered"
// choice) rather than being scoped per-workflow, since Clear All itself
// isn't scoped either. "/export" as a literal first segment, same reason
// "/secret-exposure/..." below is: it must not be shadowed by the /:id
// route further down this file.
const EXPORT_TABLES = [
  'workflows', 'workflow_nodes', 'workflow_pii_exposure', 'workflow_secret_exposure',
  'workflow_dependencies', 'workflow_analyses', 'workflow_risk_score_history',
  'assurance_evidence', 'workflow_mcp_references', 'behavior_baselines',
  'anomaly_alerts', 'attack_paths', 'test_execution_profiles',
];
router.get('/export', requireAuth, requirePermission('workflow:manage'), wrap(async (req, res) => {
  const exportedAt = new Date().toISOString();
  const tables = {};
  for (const table of EXPORT_TABLES) {
    // EXPORT_TABLES is a fixed internal list, not request input — safe to
    // interpolate as an identifier (pg can't parameterize table names).
    const { rows } = await pool.query(`SELECT * FROM workflow_governance.${table}`);
    tables[table] = rows;
  }
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="ioa-workflow-backup-${exportedAt.slice(0, 10)}.json"`
  );
  res.json({ exported_at: exportedAt, tables });
}));

// ── POST /workflows/restore ────────────────────────────────────────────────
// Imports a GET /workflows/export payload back in — the counterpart to
// Clear All's Backup button, and (per work/epics/) deliberately scoped to
// this platform's own export shape only: restoring into another IOA
// Governance Platform environment requires that environment running a
// matching schema, since this inserts raw rows with no migration/version
// translation.
//
// Requires an empty target (no existing workflows) rather than attempting
// any merge/upsert — safest option given how easily upserting could
// silently overwrite an admin's real current data on an accidental ID
// collision. Point them at Clear All first if the target isn't empty.
//
// Inserts in EXPORT_TABLES order inside a single transaction, so a
// mid-restore failure (e.g. malformed payload, FK violation) rolls back
// to a clean empty state rather than leaving a half-restored mess —
// ordering matters here since it's also each table's FK dependency order
// (workflows first, everything else references it).
router.post('/restore', requireAuth, requirePermission('workflow:manage'), wrap(async (req, res) => {
  const { exported_at: exportedAt, tables } = req.body ?? {};
  if (!tables || typeof tables !== 'object') {
    return res.status(400).json({ error: 'Expected a backup payload with a tables object — see GET /workflows/export' });
  }

  const { rows: [{ count }] } = await pool.query(
    'SELECT COUNT(*)::int AS count FROM workflow_governance.workflows'
  );
  if (count > 0) {
    return res.status(409).json({
      error: `workflow_governance.workflows already has ${count} row(s) — restore requires an empty target. Run Clear All first if you want to replace the existing data.`,
    });
  }

  const client = await pool.connect();
  const counts = {};
  try {
    await client.query('BEGIN');
    for (const table of EXPORT_TABLES) {
      const rows = Array.isArray(tables[table]) ? tables[table] : [];
      counts[table] = rows.length;
      if (rows.length === 0) continue;

      const columns = Object.keys(rows[0]);
      // EXPORT_TABLES/columns are both fixed/derived, never request-controlled
      // strings used as identifiers — safe to interpolate.
      const colList = columns.map(c => `"${c}"`).join(', ');
      const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
      for (const row of rows) {
        const values = columns.map(c => {
          const v = row[c];
          // jsonb columns round-trip through export/import as plain JS
          // objects/arrays (the pg driver auto-parses jsonb on SELECT) —
          // re-stringify them so the parameterized INSERT binds text pg
          // can cast back to jsonb, rather than an unsupported object param.
          return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
        });
        await client.query(
          `INSERT INTO workflow_governance.${table} (${colList}) VALUES (${placeholders})`,
          values
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  await cache.del('workflow:list');
  logWorkflowsRestored({ actorId: req.user?.id, exportedAt, counts });
  res.json({ restored: counts });
}));

// ── DELETE /workflows ───────────────────────────────────────────────────────
// Clears every imported workflow (cascades via ON DELETE CASCADE to nodes,
// PII/secret findings, risk history, lineage, assurance evidence, analyses —
// see db/migrations/workflow_governance/001_initial.sql and friends). For
// resetting stale data after switching to a different n8n/platform
// connection — see work/epics/e4-clear-workflows/. Deliberately not scoped
// by platform/connection: the user asked for a full reset, not a filtered
// one, and a filtered variant is easy to add later without touching this
// route's contract. Gated on workflow:manage, not workflow:read, since the
// latter is held by read-mostly roles (auditor, business-owner) too — see
// db/migrations/auth/009_workflow_manage_permission.sql.
//
// Back up first: GET /workflows/export downloads everything this deletes.
router.delete('/', requireAuth, requirePermission('workflow:manage'), wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM workflow_governance.workflows');
  await cache.del('workflow:list');
  // Fire-and-forget — logWorkflowsCleared already catches its own failures.
  logWorkflowsCleared({ actorId: req.user?.id, count: rowCount });
  res.json({ deleted: rowCount });
}));

// ── PATCH /workflows/secret-exposure/:id/confirm-rotation ─────────────────
// EP-101-S8/S9 — records that someone claims to have rotated this credential.
// Doesn't resolve the finding itself: the row stays until the next scan
// either drops it (fingerprint gone — genuinely rotated) or reinserts it with
// this same rotation_confirmed_at carried forward (fingerprint still present
// — the claim didn't hold). "secret-exposure" as a literal first segment, not
// "/:id", so this can't collide with the /:id routes below.
router.patch('/secret-exposure/:id/confirm-rotation', requireAuth, requirePermission('violation:resolve'), wrap(async (req, res) => {
  const { confirmed_by } = req.body;
  if (!confirmed_by) return res.status(400).json({ error: 'confirmed_by is required' });

  const { rows: [row] } = await pool.query(
    `UPDATE workflow_governance.workflow_secret_exposure
        SET rotation_confirmed_at = NOW(), rotation_confirmed_by = $1
      WHERE id = $2
      RETURNING *`,
    [confirmed_by, req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Secret exposure finding not found' });
  // GET /workflows/:id caches its response — without this, the SPA's detail
  // panel would keep showing the pre-confirmation state until the TTL lapses.
  await cache.del(`workflow:${row.workflow_id}`);
  res.json(row);
}));

// ── GET /workflows/n8n ────────────────────────────────────────────────────
// Lightweight list from n8n API enriched with project names. For the SPA picker.
router.get('/n8n', requireAuth, wrap(async (req, res) => {
  const n8nConfig = await getN8nConfig();
  // Fetch workflows and projects in parallel; projects may not be supported
  const [workflows, projects] = await Promise.all([
    n8nClient.listWorkflows(n8nConfig),
    n8nClient.listProjects(n8nConfig),
  ]);

  // Build a projectId → name lookup
  const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));

  const list = workflows.map(wf => ({
    id:          wf.id,
    name:        wf.name,
    active:      wf.active ?? true,
    tags:        (wf.tags || []).map(t => (typeof t === 'string' ? t : t?.name ?? '')).filter(Boolean),
    project_id:  wf.projectId   || wf.project_id   || null,
    project_name: wf.projectId  ? (projectMap[wf.projectId] ?? null)
                 : wf.project_id ? (projectMap[wf.project_id] ?? null)
                 : null,
    updatedAt:   wf.updatedAt,
  }));

  res.json(list);
}));

// ── GET /workflows/make?connection_id=<uuid> ──────────────────────────────
// List scenarios from a connected Make.com account for the SPA import picker.
router.get('/make', requireAuth, wrap(async (req, res) => {
  const { connection_id } = req.query;
  if (!connection_id) return res.status(400).json({ error: 'connection_id is required' });

  const { rows: [conn] } = await pool.query(
    `SELECT id, config_json, status
       FROM workflow_governance.platform_connections
      WHERE id = $1 AND platform = 'make'`,
    [connection_id]
  );
  if (!conn) return res.status(404).json({ error: 'Make.com connection not found' });
  if (conn.status !== 'connected') {
    return res.status(409).json({ error: 'Connection not active — test it first in Integrations' });
  }

  const adapter   = getAdapter('make');
  const workflows = await adapter.listWorkflows(conn.config_json);
  res.json(workflows);
}));

// ── GET /workflows/zapier?connection_id=<uuid> ────────────────────────────
// List Zaps from a connected Zapier account for the SPA import picker.
router.get('/zapier', requireAuth, wrap(async (req, res) => {
  const { connection_id } = req.query;
  if (!connection_id) return res.status(400).json({ error: 'connection_id is required' });

  const { rows: [conn] } = await pool.query(
    `SELECT id, config_json, status
       FROM workflow_governance.platform_connections
      WHERE id = $1 AND platform = 'zapier'`,
    [connection_id]
  );
  if (!conn) return res.status(404).json({ error: 'Zapier connection not found' });
  if (conn.status !== 'connected') {
    return res.status(409).json({ error: 'Connection not active — test it first in Integrations' });
  }

  const adapter   = getAdapter('zapier');
  const workflows = await adapter.listWorkflows(conn.config_json);
  res.json(workflows);
}));

// ── GET /workflows/camunda?connection_id=<uuid> ───────────────────────────
// List process definitions from a connected Camunda account for the SPA import picker.
router.get('/camunda', requireAuth, wrap(async (req, res) => {
  const { connection_id } = req.query;
  if (!connection_id) return res.status(400).json({ error: 'connection_id is required' });

  const { rows: [conn] } = await pool.query(
    `SELECT id, config_json, status
       FROM workflow_governance.platform_connections
      WHERE id = $1 AND platform = 'camunda'`,
    [connection_id]
  );
  if (!conn) return res.status(404).json({ error: 'Camunda connection not found' });
  if (conn.status !== 'connected') {
    return res.status(409).json({ error: 'Connection not active — test it first in Integrations' });
  }

  const adapter   = getAdapter('camunda');
  const workflows = await adapter.listWorkflows(conn.config_json);
  res.json(workflows);
}));

// ── GET /workflows/power-automate?connection_id=<uuid> ────────────────────
// List flows from a connected Power Automate account for the SPA import picker.
router.get('/power-automate', requireAuth, wrap(async (req, res) => {
  const { connection_id } = req.query;
  if (!connection_id) return res.status(400).json({ error: 'connection_id is required' });

  const { rows: [conn] } = await pool.query(
    `SELECT id, config_json, status
       FROM workflow_governance.platform_connections
      WHERE id = $1 AND platform = 'power_automate'`,
    [connection_id]
  );
  if (!conn) return res.status(404).json({ error: 'Power Automate connection not found' });
  if (conn.status !== 'connected') {
    return res.status(409).json({ error: 'Connection not active — test it first in Integrations' });
  }

  const adapter   = getAdapter('power_automate');
  const workflows = await adapter.listWorkflows(conn.config_json);
  res.json(workflows);
}));

// Resolves any platform connection by ID — returns { platform, config }.
// Used by the multi-platform discover route below.
async function getConnectionById(connectionId) {
  const { rows: [conn] } = await pool.query(
    `SELECT platform, config_json FROM workflow_governance.platform_connections
       WHERE id = $1 AND status = 'connected'`,
    [connectionId]
  );
  if (!conn) throw new Error('Connection not found or not connected');
  return { platform: conn.platform, config: conn.config_json };
}

// ── POST /workflows/discover ───────────────────────────────────────────────
// Pull all workflows from a connected platform, classify, score, and upsert.
// Requires connection_id so the route knows which platform adapter to use.
// Falls back to n8n env-var defaults when no connection_id is given (backward compat).
router.post('/discover', requireAuth, requirePermission('workflow:read'), wrap(async (req, res) => {
  const { connection_id } = req.body ?? {};

  let platform, config, adapter;
  if (connection_id) {
    ({ platform, config } = await getConnectionById(connection_id));
    adapter = getAdapter(platform);
  } else {
    platform = 'n8n';
    config   = await getN8nConfig();
    adapter  = getAdapter('n8n');
  }

  const isN8n = platform === 'n8n';

  // Adapter's listWorkflows returns normalized objects for non-n8n platforms;
  // n8n's legacy path still uses n8nClient directly for backward compatibility.
  const workflows = isN8n
    ? await (async () => {
        const [wfs, projects] = await Promise.all([
          n8nClient.listWorkflows(config),
          n8nClient.listProjects(config),
        ]);
        const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));
        return wfs.map(wf => ({
          sourceId:    String(wf.id),
          name:        wf.name,
          active:      wf.active,
          tags:        (wf.tags ?? []).map(t => (typeof t === 'string' ? t : t.name)),
          folderId:    wf.projectId ?? null,
          folderName:  wf.projectId ? (projectMap[wf.projectId] ?? null) : null,
          ownerId:     wf.ownerId || null,
          _raw:        wf,
        }));
      })()
    : await adapter.listWorkflows(config);

  const results = [];

  for (const wf of workflows) {
    const workflowId = isN8n ? wf._raw?.id ?? wf.sourceId : `${platform}:${wf.sourceId}`;
    try {
      const definition = isN8n
        ? await n8nClient.getWorkflow(wf.sourceId, config)
        : await adapter.getWorkflow(config, wf.sourceId);
      if (!definition) continue;

      const metadata = isN8n
        ? extractor.extract(definition)
        : {
            nodes: adapter.normalizeNodes(definition),
            credentials: [],
            piiExposure: { hasPII: false, piiFields: [], risks: [], exposedToExternal: false },
            secretExposure: { hasSecrets: false, risks: [] },
            mcpReferences: [],
            errorHandling: { hasTryCatch: false, hasErrorBranches: false, hasRetryLogic: false, retryConfiguration: null, saveDataOnError: false },
            flowLevelRisks: adapter.detectFlowLevelRisks(definition),
          };

      const { rows: [existingWf] } = await pool.query(
        `SELECT technical_owner, business_owner, ownership_source, ownership_verified_at, criticality
           FROM workflow_governance.workflows WHERE id = $1`,
        [workflowId]
      );
      const ownership   = tagAttributes.resolveForScoring(existingWf ?? {}, wf.tags ?? []);
      const criticality = tagAttributes.resolveCriticality(existingWf?.criticality, wf.tags ?? []);
      const violations  = await governancePostureClient.fetchViolations(workflowId);
      const evidence    = await fetchEvidence(workflowId);
      const telemetry   = await telemetryClient.fetchExecutionSummary(workflowId);
      const resolvedMcpRefs = await resolveMcpReferences(metadata.mcpReferences ?? [], wf.name ?? workflowId);
      const mcpCeilings     = await fetchMcpCeilings(resolvedMcpRefs);

      const riskScore = scorer.scoreWorkflow(metadata, wf.tags ?? [], { ownership, violations, evidence, telemetry });
      const ati       = computeAti(riskScore, criticality, mcpCeilings);

      const projectId   = wf.folderId ?? null;
      const projectName = wf.folderName ?? null;

      // n8n uses ON CONFLICT (n8n_id); other platforms use (platform, source_id)
      const { rows: [stored] } = isN8n
        ? await pool.query(
            `INSERT INTO workflow_governance.workflows
               (id, name, n8n_id, active, owner_id, tags, metadata_json,
                risk_score, risk_level, risk_breakdown_json,
                ati_score, ati_level, ati_breakdown_json,
                project_id, project_name, scored_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW(),NOW())
             ON CONFLICT (n8n_id) DO UPDATE
               SET name                = EXCLUDED.name,
                   active              = EXCLUDED.active,
                   metadata_json       = EXCLUDED.metadata_json,
                   risk_score          = EXCLUDED.risk_score,
                   risk_level          = EXCLUDED.risk_level,
                   risk_breakdown_json = EXCLUDED.risk_breakdown_json,
                   ati_score           = EXCLUDED.ati_score,
                   ati_level           = EXCLUDED.ati_level,
                   ati_breakdown_json  = EXCLUDED.ati_breakdown_json,
                   project_id          = EXCLUDED.project_id,
                   project_name        = EXCLUDED.project_name,
                   scored_at           = NOW(),
                   updated_at          = NOW()
             RETURNING *`,
            [
              workflowId, wf.name, wf.sourceId, wf.active ?? true,
              wf.ownerId || null, wf.tags || [],
              JSON.stringify(metadata),
              riskScore.risk_score, riskScore.risk_level, JSON.stringify(riskScore),
              ati.ati_score, ati.ati_level, JSON.stringify(ati),
              projectId, projectName,
            ]
          )
        : await pool.query(
            `INSERT INTO workflow_governance.workflows
               (id, name, n8n_id, platform, source_id, platform_connection_id,
                active, owner_id, tags, metadata_json,
                risk_score, risk_level, risk_breakdown_json,
                ati_score, ati_level, ati_breakdown_json,
                project_id, project_name, scored_at, updated_at)
             VALUES ($1,$2,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW(),NOW())
             ON CONFLICT (platform, source_id)
               WHERE platform != 'n8n' AND source_id IS NOT NULL
             DO UPDATE
               SET name                = EXCLUDED.name,
                   active              = EXCLUDED.active,
                   metadata_json       = EXCLUDED.metadata_json,
                   risk_score          = EXCLUDED.risk_score,
                   risk_level          = EXCLUDED.risk_level,
                   risk_breakdown_json = EXCLUDED.risk_breakdown_json,
                   ati_score           = EXCLUDED.ati_score,
                   ati_level           = EXCLUDED.ati_level,
                   ati_breakdown_json  = EXCLUDED.ati_breakdown_json,
                   project_id          = EXCLUDED.project_id,
                   project_name        = EXCLUDED.project_name,
                   scored_at           = NOW(),
                   updated_at          = NOW()
             RETURNING *`,
            [
              workflowId, wf.name, platform, wf.sourceId, connection_id,
              wf.active ?? true, null, wf.tags || [],
              JSON.stringify(metadata),
              riskScore.risk_score, riskScore.risk_level, JSON.stringify(riskScore),
              ati.ati_score, ati.ati_level, JSON.stringify(ati),
              projectId, projectName,
            ]
          );

      await riskHistory.snapshotRiskScore({ workflowId, platform, riskScore, metadata });
      if (wf.tags?.length) await tagAttributes.apply(workflowId, wf.tags);

      // Upsert nodes
      await pool.query('DELETE FROM workflow_governance.workflow_nodes WHERE workflow_id = $1', [workflowId]);
      const nodes = isN8n ? metadata.nodes : metadata.nodes;
      for (const node of nodes) {
        await pool.query(
          `INSERT INTO workflow_governance.workflow_nodes
             (id, workflow_id, node_id, node_name, n8n_type, governance_type,
              risk_factors, parameters_json, disabled)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            `${workflowId}:${node.node_id || node.stepId || node.stepName || node.node_name}`,
            workflowId,
            node.node_id || node.stepId || null,
            node.node_name || node.stepName,
            node.n8n_type || node.stepType || null,
            node.governance_type || node.governanceType,
            node.risk_factors || node.riskFactors || [],
            JSON.stringify(node.parameters_json || node.parametersJson || {}),
            node.disabled ?? false,
          ]
        );
      }

      // Upsert PII exposure
      await pool.query('DELETE FROM workflow_governance.workflow_pii_exposure WHERE workflow_id = $1', [workflowId]);
      for (const risk of (metadata.piiExposure?.risks ?? [])) {
        await pool.query(
          `INSERT INTO workflow_governance.workflow_pii_exposure
             (workflow_id, pii_type, node_name, field_location, masked, encrypted)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [workflowId, risk.pii_type, risk.node_name, risk.field_location, risk.masked, risk.encrypted]
        );
      }

      await persistSecretExposure(workflowId, metadata.secretExposure?.risks ?? []);
      await persistMcpReferences(workflowId, resolvedMcpRefs);

      await cache.del(`workflow:${workflowId}`);
      await cache.del('workflow:list');

      results.push({ id: workflowId, name: wf.name, risk_score: riskScore.risk_score, risk_level: riskScore.risk_level });
    } catch (err) {
      console.error(`[discover] Failed to process workflow ${workflowId}: ${err.message}`);
      results.push({ id: workflowId, name: wf.name, error: err.message });
    }
  }

  const platformLabel = { n8n: 'n8n', make: 'Make.com', zapier: 'Zapier', power_automate: 'Power Automate', camunda: 'Camunda' }[platform] ?? platform;
  res.status(202).json({ discovered: results.length, platform: platformLabel, workflows: results });
}));

// ── POST /workflows/import ────────────────────────────────────────────────
// Import a single workflow from n8n or a connected platform, score it, and upsert.
// n8n:  { n8n_id }
// Make: { platform: 'make', connection_id, source_id }
router.post('/import', requireAuth, requirePermission('workflow:read'), wrap(async (req, res) => {
  const { n8n_id, platform = 'n8n', connection_id, source_id } = req.body;

  // ── Connected-platform import path (make/zapier/camunda) ──────────────────
  // Each platform's fetch+normalize step lives in platform-importers.js; an
  // unrecognized platform value falls through to the n8n path below rather
  // than being rejected outright — pre-existing behavior, preserved here.
  const importer = platform !== 'n8n' ? getImporter(platform) : null;
  if (importer) {
    if (!connection_id) return res.status(400).json({ error: 'connection_id is required' });
    if (!source_id)     return res.status(400).json({ error: 'source_id is required' });

    const { rows: [conn] } = await pool.query(
      `SELECT * FROM workflow_governance.platform_connections WHERE id = $1 AND platform = $2`,
      [connection_id, platform]
    );
    if (!conn) return res.status(404).json({ error: `${importer.connectionLabel} not found` });

    const adapter    = getAdapter(platform);
    const normalized = await importer.normalize(adapter, conn.config_json, source_id);
    if (!normalized) return res.status(404).json({ error: importer.notFound(source_id) });

    const { name, active, projectId, projectName, metadata, flowRisks } = normalized;
    const riskScore = scorer.scoreWorkflow(metadata, flowRisks);
    const ati       = computeAti(riskScore, null);

    const { rows: [stored] } = await pool.query(
      `INSERT INTO workflow_governance.workflows
         (id, name, n8n_id, platform, source_id, platform_connection_id,
          active, tags, metadata_json, risk_score, risk_level, risk_breakdown_json,
          ati_score, ati_level, ati_breakdown_json,
          project_id, project_name, scored_at, updated_at)
       VALUES (gen_random_uuid(), $1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW())
       ON CONFLICT (platform, source_id) WHERE platform != 'n8n' AND source_id IS NOT NULL
       DO UPDATE SET
         name                = EXCLUDED.name,
         active              = EXCLUDED.active,
         metadata_json       = EXCLUDED.metadata_json,
         risk_score          = EXCLUDED.risk_score,
         risk_level          = EXCLUDED.risk_level,
         risk_breakdown_json = EXCLUDED.risk_breakdown_json,
         ati_score           = EXCLUDED.ati_score,
         ati_level           = EXCLUDED.ati_level,
         ati_breakdown_json  = EXCLUDED.ati_breakdown_json,
         project_id          = EXCLUDED.project_id,
         project_name        = EXCLUDED.project_name,
         scored_at           = NOW(),
         updated_at          = NOW()
       RETURNING *`,
      [
        name, platform, source_id, connection_id,
        active, [],
        JSON.stringify(metadata),
        riskScore.risk_score, riskScore.risk_level, JSON.stringify(riskScore),
        ati.ati_score, ati.ati_level, JSON.stringify(ati),
        projectId, projectName,
      ]
    );

    await riskHistory.snapshotRiskScore({ workflowId: stored.id, platform, riskScore, metadata });

    await pool.query(
      'DELETE FROM workflow_governance.workflow_nodes WHERE workflow_id = $1',
      [stored.id]
    );
    for (const node of metadata.nodes) {
      await pool.query(
        `INSERT INTO workflow_governance.workflow_nodes
           (id, workflow_id, node_id, node_name, n8n_type, governance_type,
            risk_factors, parameters_json, disabled)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO NOTHING`,
        [
          `${stored.id}:${node.node_id ?? node.node_name}`,
          stored.id, node.node_id, node.node_name, node.n8n_type,
          node.governance_type, node.risk_factors,
          JSON.stringify(node.parameters_json), node.disabled,
        ]
      );
    }

    await pool.query(
      'DELETE FROM workflow_governance.workflow_pii_exposure WHERE workflow_id = $1',
      [stored.id]
    );
    for (const risk of metadata.piiExposure.risks) {
      await pool.query(
        `INSERT INTO workflow_governance.workflow_pii_exposure
           (workflow_id, pii_type, node_name, field_location, masked, encrypted)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [stored.id, risk.pii_type, risk.node_name, risk.field_location, risk.masked, risk.encrypted]
      );
    }

    if (importer.persistSecretExposure) {
      await persistSecretExposure(stored.id, metadata.secretExposure?.risks ?? []);
    }

    await cache.del(`workflow:${stored.id}`);
    await cache.del('workflow:list');

    return res.status(201).json({
      id:               stored.id,
      name:             stored.name,
      risk_score:       stored.risk_score,
      risk_level:       stored.risk_level,
      ati_score:        stored.ati_score,
      ati_level:        stored.ati_level,
      tags:             [],
      top_risk_factors: riskScore.top_risk_factors,
      tag_dimension:    riskScore.dimensions?.governance_tags,
    });
  }

  // ── n8n import path (original) ────────────────────────────────────────────
  if (!n8n_id) return res.status(400).json({ error: 'n8n_id is required' });

  const n8nConfig = await getN8nConfig();
  const [definition, projects] = await Promise.all([
    n8nClient.getWorkflow(n8n_id, n8nConfig),
    n8nClient.listProjects(n8nConfig),
  ]);
  if (!definition) return res.status(404).json({ error: `Workflow ${n8n_id} not found in n8n` });

  // Normalize tags: n8n returns [{id,name,...}] — extract names for TEXT[] column
  const tagNames = (definition.tags || [])
    .map(t => (typeof t === 'string' ? t : t?.name ?? ''))
    .filter(Boolean);

  const projectMap  = Object.fromEntries(projects.map(p => [p.id, p.name]));
  const projectId   = definition.projectId || definition.project_id || null;
  const projectName = projectId ? (projectMap[projectId] ?? null) : null;

  const { rows: [existingWf] } = await pool.query(
    `SELECT technical_owner, business_owner, ownership_source, ownership_verified_at, criticality
       FROM workflow_governance.workflows WHERE id = $1 OR n8n_id = $1`,
    [definition.id]
  );
  const ownership   = tagAttributes.resolveForScoring(existingWf ?? {}, tagNames);
  const criticality = tagAttributes.resolveCriticality(existingWf?.criticality, tagNames);
  const violations  = await governancePostureClient.fetchViolations(definition.id);
  const evidence    = await fetchEvidence(definition.id);
  const telemetry   = await telemetryClient.fetchExecutionSummary(definition.id);

  const metadata  = extractor.extract(definition);
  const resolvedMcpRefs = await resolveMcpReferences(metadata.mcpReferences, definition.name ?? definition.id);
  const mcpCeilings     = await fetchMcpCeilings(resolvedMcpRefs);
  const riskScore = scorer.scoreWorkflow(metadata, tagNames, { ownership, violations, evidence, telemetry });
  const ati       = computeAti(riskScore, criticality, mcpCeilings);

  const { rows: [stored] } = await pool.query(
    `INSERT INTO workflow_governance.workflows
       (id, name, n8n_id, active, tags, metadata_json,
        risk_score, risk_level, risk_breakdown_json,
        ati_score, ati_level, ati_breakdown_json,
        project_id, project_name, scored_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
     ON CONFLICT (n8n_id) DO UPDATE
       SET name                = EXCLUDED.name,
           active              = EXCLUDED.active,
           tags                = EXCLUDED.tags,
           metadata_json       = EXCLUDED.metadata_json,
           risk_score          = EXCLUDED.risk_score,
           risk_level          = EXCLUDED.risk_level,
           risk_breakdown_json = EXCLUDED.risk_breakdown_json,
           ati_score           = EXCLUDED.ati_score,
           ati_level           = EXCLUDED.ati_level,
           ati_breakdown_json  = EXCLUDED.ati_breakdown_json,
           project_id          = EXCLUDED.project_id,
           project_name        = EXCLUDED.project_name,
           scored_at           = NOW(),
           updated_at          = NOW()
     RETURNING *`,
    [
      definition.id, definition.name, definition.id,
      definition.active ?? true,
      tagNames,
      JSON.stringify(metadata),
      riskScore.risk_score, riskScore.risk_level,
      JSON.stringify(riskScore),
      ati.ati_score, ati.ati_level, JSON.stringify(ati),
      projectId,
      projectName,
    ]
  );

  await riskHistory.snapshotRiskScore({ workflowId: definition.id, platform: 'n8n', riskScore, metadata });
  await tagAttributes.apply(stored.id, tagNames);

  // Upsert nodes
  await pool.query('DELETE FROM workflow_governance.workflow_nodes WHERE workflow_id = $1', [definition.id]);
  for (const node of metadata.nodes) {
    await pool.query(
      `INSERT INTO workflow_governance.workflow_nodes
         (id, workflow_id, node_id, node_name, n8n_type, governance_type,
          risk_factors, parameters_json, disabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO NOTHING`,
      [
        `${definition.id}:${node.node_id || node.node_name}`,
        definition.id, node.node_id, node.node_name, node.n8n_type,
        node.governance_type, node.risk_factors,
        JSON.stringify(node.parameters_json), node.disabled,
      ]
    );
  }

  // Upsert PII exposure
  await pool.query('DELETE FROM workflow_governance.workflow_pii_exposure WHERE workflow_id = $1', [definition.id]);
  for (const risk of metadata.piiExposure.risks) {
    await pool.query(
      `INSERT INTO workflow_governance.workflow_pii_exposure
         (workflow_id, pii_type, node_name, field_location, masked, encrypted)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [definition.id, risk.pii_type, risk.node_name, risk.field_location, risk.masked, risk.encrypted]
    );
  }

  // Upsert hardcoded-secret exposure (redacted preview + fingerprint only)
  await persistSecretExposure(definition.id, metadata.secretExposure?.risks ?? []);

  await persistMcpReferences(definition.id, resolvedMcpRefs);

  await cache.del(`workflow:${definition.id}`);
  await cache.del('workflow:list');

  res.status(201).json({
    id:               stored.id,
    name:             stored.name,
    risk_score:       stored.risk_score,
    risk_level:       stored.risk_level,
    ati_score:        stored.ati_score,
    ati_level:        stored.ati_level,
    tags:             tagNames,
    project_id:       stored.project_id,
    project_name:     stored.project_name,
    top_risk_factors: riskScore.top_risk_factors,
    tag_dimension:    riskScore.dimensions?.governance_tags,
  });
}));

// ── GET /workflows/:id/applied-policies ───────────────────────────────────
// Fetch policies that were inferred and pushed to governance-service for this workflow.
const GOVERNANCE_URL = process.env.GOVERNANCE_SERVICE_URL || 'http://localhost:3300';

router.get('/:id/applied-policies', requireAuth, wrap(async (req, res) => {
  const { id } = req.params;

  const { rows: [wf] } = await pool.query(
    'SELECT id, name, policies_applied FROM workflow_governance.workflows WHERE id = $1 OR n8n_id = $1',
    [id]
  );
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });
  if (!wf.policies_applied) return res.json([]);

  // AUTH-201 (extended) — governance-service now requires authentication;
  // this call carries no browser session, so it authenticates with the
  // shared internal service key instead.
  const govRes = await fetch(
    `${GOVERNANCE_URL}/policies?workflow_id=${encodeURIComponent(wf.id)}`,
    { headers: { 'Content-Type': 'application/json', 'X-Internal-Service-Key': process.env.INTERNAL_SERVICE_KEY || '' } }
  ).catch(() => null);

  if (!govRes?.ok) return res.json([]);

  const applied = await govRes.json().catch(() => []);
  if (!Array.isArray(applied)) return res.json([]);

  res.json(applied.map(p => ({
    id:                   p.id,
    name:                 p.name,
    description:          p.description,
    policy_type:          p.metadata_json?.policy_type,
    compliance_framework: p.metadata_json?.compliance_framework ?? null,
    inferred_from:        p.metadata_json?.inferred_from ?? {},
    rules:                p.metadata_json?.rules ?? [],
    created_at:           p.created_at,
  })));
}));

// ── GET /workflows/:id ─────────────────────────────────────────────────────
router.get('/:id', requireAuth, wrap(async (req, res) => {
  const { id } = req.params;

  const cached = await cache.get(`workflow:${id}`);
  if (cached) return res.json(cached);

  const { rows: [wf] } = await pool.query(
    'SELECT * FROM workflow_governance.workflows WHERE id = $1 OR n8n_id = $1',
    [id]
  );
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });

  const [{ rows: nodes }, { rows: pii }, { rows: secrets }, { rows: mcpRefs }, { rows: deps }] = await Promise.all([
    pool.query('SELECT * FROM workflow_governance.workflow_nodes WHERE workflow_id = $1 ORDER BY node_name', [wf.id]),
    pool.query('SELECT * FROM workflow_governance.workflow_pii_exposure WHERE workflow_id = $1', [wf.id]),
    pool.query('SELECT * FROM workflow_governance.workflow_secret_exposure WHERE workflow_id = $1', [wf.id]),
    pool.query('SELECT * FROM workflow_governance.workflow_mcp_references WHERE workflow_id = $1', [wf.id]),
    pool.query('SELECT * FROM workflow_governance.workflow_dependencies WHERE workflow_id = $1', [wf.id]),
  ]);

  const result = { ...wf, nodes, pii_exposure: pii, secret_exposure: secrets, mcp_references: mcpRefs, dependencies: deps };
  await cache.set(`workflow:${id}`, result, cache.TTL.RISK);
  res.json(result);
}));

// ── POST /workflows/:id/score ──────────────────────────────────────────────
// Re-score a single workflow by pulling fresh definition from n8n
router.post('/:id/score', requireAuth, requirePermission('workflow:read'), wrap(async (req, res) => {
  const { id } = req.params;

  const { rows: [existing] } = await pool.query(
    `SELECT id, n8n_id, platform, criticality, tags,
            technical_owner, business_owner, ownership_source, ownership_verified_at
       FROM workflow_governance.workflows WHERE id = $1 OR n8n_id = $1`,
    [id]
  );
  if (!existing) return res.status(404).json({ error: 'Workflow not found' });

  const definition = await n8nClient.getWorkflow(existing.n8n_id, await getN8nConfig());
  if (!definition) return res.status(502).json({ error: 'Could not fetch workflow from n8n' });

  const ownership  = tagAttributes.resolveForScoring(existing, existing.tags);
  const violations = await governancePostureClient.fetchViolations(existing.id);
  const evidence   = await fetchEvidence(existing.id);
  const telemetry  = await telemetryClient.fetchExecutionSummary(existing.id);

  const metadata = extractor.extract(definition);
  const resolvedMcpRefs = await resolveMcpReferences(metadata.mcpReferences, definition.name ?? definition.id);
  const mcpCeilings     = await fetchMcpCeilings(resolvedMcpRefs);
  const riskScore = scorer.scoreWorkflow(metadata, existing.tags ?? [], { ownership, violations, evidence, telemetry });
  const ati       = computeAti(riskScore, existing.criticality, mcpCeilings);

  await pool.query(
    `UPDATE workflow_governance.workflows
        SET metadata_json = $1, risk_score = $2, risk_level = $3,
            risk_breakdown_json = $4, ati_score = $5, ati_level = $6,
            ati_breakdown_json = $7, scored_at = NOW(), updated_at = NOW()
      WHERE id = $8 OR n8n_id = $8`,
    [
      JSON.stringify(metadata), riskScore.risk_score, riskScore.risk_level, JSON.stringify(riskScore),
      ati.ati_score, ati.ati_level, JSON.stringify(ati), id,
    ]
  );

  await riskHistory.snapshotRiskScore({ workflowId: existing.id, platform: existing.platform, riskScore, metadata });
  await persistMcpReferences(existing.id, resolvedMcpRefs);

  await cache.del(`workflow:${id}`);
  res.json({ ...riskScore, ati });
}));

// ── PATCH /workflows/:id/ownership ────────────────────────────────────────
// Manual ownership edit — marks ownership_source = 'manual' so future tag-driven
// discovery/import no longer overwrites these fields for this workflow.
router.patch('/:id/ownership', requireAuth, requirePermission('workflow:read'), wrap(async (req, res) => {
  const { id } = req.params;
  const { technical_owner, business_owner, backup_owner, owning_team, escalation_contact } = req.body;

  const { rows: [wf] } = await pool.query(
    `UPDATE workflow_governance.workflows
        SET technical_owner    = COALESCE($2, technical_owner),
            business_owner     = COALESCE($3, business_owner),
            backup_owner       = COALESCE($4, backup_owner),
            owning_team        = COALESCE($5, owning_team),
            escalation_contact = COALESCE($6, escalation_contact),
            ownership_source   = 'manual',
            ownership_verified_at = NOW(),
            updated_at         = NOW()
      WHERE id = $1 OR n8n_id = $1
      RETURNING *`,
    [id, technical_owner ?? null, business_owner ?? null, backup_owner ?? null, owning_team ?? null, escalation_contact ?? null]
  );
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });

  await cache.del(`workflow:${id}`);
  res.json(wf);
}));

// ── GET /workflows/:id/risk-history ───────────────────────────────────────
// Time series of past risk scores for the trend chart. Capped at 90 days / 500 points.
router.get('/:id/risk-history', requireAuth, wrap(async (req, res) => {
  const { id } = req.params;

  const { rows: [wf] } = await pool.query(
    'SELECT id FROM workflow_governance.workflows WHERE id = $1 OR n8n_id = $1',
    [id]
  );
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });

  const { rows } = await pool.query(
    `SELECT overall_score, risk_level, dimension_scores, finding_count, scoring_version, scored_at
       FROM workflow_governance.workflow_risk_score_history
      WHERE workflow_id = $1
        AND scored_at > NOW() - INTERVAL '90 days'
      ORDER BY scored_at ASC
      LIMIT 500`,
    [wf.id]
  );
  res.json(rows);
}));

// ── POST /workflows/:id/execution-event ───────────────────────────────────
// Called by an n8n workflow-execution webhook on every run (start/success/
// failure). Forwards into telemetry-service's execution_status metric —
// the source of the operational_visibility risk dimension. This is the one
// piece of Increment 3.2 that depends on external n8n webhook configuration
// (see CLAUDE.md's N8N_ANALYSIS_WEBHOOK_URL for the equivalent existing setup).
// AUTH-201/204 — deliberately NOT behind requireAuth, same reason as the
// analyze/callback route in analysis.js: n8n Cloud calls this directly and
// cannot be given the internal service key from this session. EP-310's
// verifyN8nCallback (HMAC + timestamp window, skipped when N8N_WEBHOOK_SECRET
// is unset) is applied here as of S2.1's 2026-10-08 widening — see
// work/epics/e2-iso42001-hardening and docs/baseline-assessment-2026-10.md's
// finding F-02, since this route previously had no protection at all.
router.post('/:id/execution-event', verifyN8nCallback, wrap(async (req, res) => {
  const { id } = req.params;
  const { status, duration_ms, correlation_id } = req.body;

  if (!['success', 'failure', 'start'].includes(status)) {
    return res.status(400).json({ error: "status must be one of: success, failure, start" });
  }

  const { rows: [wf] } = await pool.query(
    'SELECT id FROM workflow_governance.workflows WHERE id = $1 OR n8n_id = $1',
    [id]
  );
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });

  // EP-102-S3 — honors an explicit correlation_id in the webhook body (if
  // n8n's workflow was configured to forward one from the original
  // trigger), otherwise falls back to this request's own id (from
  // x-correlation-id, or freshly minted for this webhook call).
  await telemetryClient.recordExecutionEvent(wf.id, { status, duration_ms, correlationId: correlation_id ?? req.correlationId });
  res.status(202).json({ recorded: true });
}));

// ── POST /workflows/:id/enforcement-check ─────────────────────────────────
// EP-201-S7/S8 — the workflow-start governance gate. Add this as the first
// HTTP Request node in an n8n workflow; a non-2xx response (decision:
// 'block') is exactly what n8n's HTTP node treats as a node failure, so
// wiring this into an IF/error-trigger branch halts execution without any
// custom n8n logic beyond checking the response.
//
// EP-201-S9's "human approval gate response path" is deliberately NOT a new
// approval mechanism here (that's EP-202's job) — it's this: a block
// response carries policy_id + violation_id, and the existing EP-104 waiver
// flow (POST /violations/:id/waivers, PATCH /violations/waivers/:id/approve)
// is how a human signs off. Once a waiver is approved (or the violation is
// otherwise resolved), re-calling this same endpoint on retry naturally
// returns 'allow' — no separate resume mechanism needed.
//
// AUTH-201/204 — deliberately NOT behind requireAuth, same reason as
// execution-event above: n8n Cloud calls this directly at workflow start and
// cannot be given the internal service key from this session.
// EP-310/S2.1 — verifyN8nCallback applied here as of 2026-10-08 (baseline
// assessment finding F-02): this is the route that actually halts a running
// n8n workflow on 'block', which made it the single most consequential of
// the three unauthenticated n8n-facing routes to be left without even the
// optional HMAC protection the analyze/callback route already had.
router.post('/:id/enforcement-check', verifyN8nCallback, wrap(async (req, res) => {
  const { id } = req.params;
  const { correlation_id } = req.body ?? {};

  const { rows: [wf] } = await pool.query(
    'SELECT id FROM workflow_governance.workflows WHERE id = $1 OR n8n_id = $1',
    [id]
  );
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });

  const result = await enforcementClient.checkEnforcement({
    assetType: 'workflow', assetId: wf.id, correlationId: correlation_id ?? req.correlationId,
  });
  res.status(result.status).json(result.body);
}));

// ── POST /workflows/:id/containment ────────────────────────────────────────
// EP-203 — called by governance-service's kill switch (POST
// /assets/workflow/:id/suspend|quarantine|restore|read-only), authenticated
// via the shared internal service key like the analyze/callback and
// enforcement-check routes above — but unlike those, this one CAN require
// requireAuth's normal path (governance-service always carries the key), so
// no per-route exemption is needed. No Kong/routing side effect: workflows
// aren't proxied through Kong at all — see enforcement-check's containment
// check in governance-service, which is what actually stops a contained
// workflow from running.
router.post('/:id/containment', requireAuth, requirePermission('violation:resolve'), wrap(async (req, res) => {
  const { id } = req.params;
  const { containment_state } = req.body;
  const VALID = ['active', 'suspended', 'quarantined', 'read_only'];
  if (!VALID.includes(containment_state)) {
    return res.status(400).json({ error: `containment_state must be one of: ${VALID.join(', ')}` });
  }

  const { rows: [wf] } = await pool.query(
    `UPDATE workflow_governance.workflows SET containment_state = $1, updated_at = NOW()
      WHERE id = $2 OR n8n_id = $2 RETURNING *`,
    [containment_state, id]
  );
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });
  res.json(wf);
}));

// ── POST /workflows/:id/policies/apply ────────────────────────────────────
// Infer policies from risk score and push them to governance-service
router.post('/:id/policies/apply', requireAuth, requirePermission('workflow:read'), wrap(async (req, res) => {
  const { id } = req.params;

  const { rows: [wf] } = await pool.query(
    'SELECT * FROM workflow_governance.workflows WHERE id = $1 OR n8n_id = $1',
    [id]
  );
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });
  if (!wf.risk_breakdown_json) return res.status(409).json({ error: 'Workflow has not been scored yet — run /score first' });

  const policies = await policyInference.inferPolicies(wf.id, wf.name, wf.risk_breakdown_json);

  await pool.query(
    'UPDATE workflow_governance.workflows SET policies_applied = true, updated_at = NOW() WHERE id = $1',
    [wf.id]
  );
  await cache.del(`workflow:${id}`);

  res.json({ applied: policies.length, policies });
}));

// EP-311-P6 — controlled execution testing is a governed capability, not a
// CLI flag: a workflow can only be exercised with real synthetic input once
// a human has reviewed and approved specific test scenarios for it (same
// trust model as approval_chains/waivers), AND it has a Webhook trigger
// node — n8n's public API has no "run this workflow now" endpoint for any
// workflow; a Webhook node's own URL is the only thing that can trigger a
// real execution. N8N_WEBHOOK_BASE strips the /api/v1 suffix N8N_BASE_URL
// carries for the management API, since a Webhook node's callable URL
// lives at the platform root (…/webhook/<path>), not under /api/v1.
const N8N_WEBHOOK_BASE = (process.env.N8N_BASE_URL || '').replace(/\/api\/v1\/?$/, '');

// ── POST /workflows/:id/execution-profile ─────────────────────────────────
router.post('/:id/execution-profile', requireAuth, requirePermission('workflow:read'), wrap(async (req, res) => {
  const { id } = req.params;
  const { scenarios } = req.body;
  if (!Array.isArray(scenarios) || !scenarios.length) {
    return res.status(400).json({ error: 'scenarios (a non-empty array of {name, payload_json, expected_outcome}) is required' });
  }

  const { rows: [wf] } = await pool.query(
    'SELECT id FROM workflow_governance.workflows WHERE id = $1 OR n8n_id = $1',
    [id]
  );
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });

  const { rows: [webhookNode] } = await pool.query(
    `SELECT node_name FROM workflow_governance.workflow_nodes
      WHERE workflow_id = $1 AND governance_type = 'webhook' LIMIT 1`,
    [wf.id]
  );
  if (!webhookNode) {
    return res.status(422).json({ error: 'This workflow has no Webhook trigger node — controlled execution testing is only available for webhook-triggered workflows' });
  }

  const { rows: [profile] } = await pool.query(
    `INSERT INTO workflow_governance.test_execution_profiles
       (workflow_id, webhook_node_name, scenarios_json, requested_by)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [wf.id, webhookNode.node_name, JSON.stringify(scenarios), req.user.username]
  );
  res.status(201).json(profile);
}));

// ── PATCH /workflows/:id/execution-profile/:profileId/approval ───────────
router.patch('/:id/execution-profile/:profileId/approval', requireAuth, requirePermission('workflow:execution-approve'), wrap(async (req, res) => {
  const { decision, reason, expiration } = req.body;
  const VALID = ['approved', 'rejected'];
  if (!VALID.includes(decision)) return res.status(400).json({ error: `decision must be one of: ${VALID.join(', ')}` });

  const { rows: [profile] } = await pool.query(
    `UPDATE workflow_governance.test_execution_profiles
        SET status = $1, approved_by = $2, approved_at = NOW(),
            rejection_reason = $3, expiration = $4, updated_at = NOW()
      WHERE id = $5 AND workflow_id = $6
      RETURNING *`,
    [decision, req.user.username, decision === 'rejected' ? (reason ?? null) : null, expiration ?? null, req.params.profileId, req.params.id]
  );
  if (!profile) return res.status(404).json({ error: 'Execution profile not found for this workflow' });
  res.json(profile);
}));

// ── GET /workflows/:id/execution-profile ──────────────────────────────────
// Returns the current approved (unexpired) profile if one exists, complete
// with the callable webhook_url — else the latest pending_review/rejected
// one, so the caller can always see where a request stands.
router.get('/:id/execution-profile', requireAuth, wrap(async (req, res) => {
  const { rows: [approved] } = await pool.query(
    `SELECT * FROM workflow_governance.test_execution_profiles
      WHERE workflow_id = $1 AND status = 'approved' AND (expiration IS NULL OR expiration > NOW())
      ORDER BY approved_at DESC LIMIT 1`,
    [req.params.id]
  );
  if (approved) {
    const { rows: [node] } = await pool.query(
      `SELECT parameters_json FROM workflow_governance.workflow_nodes
        WHERE workflow_id = $1 AND node_name = $2`,
      [req.params.id, approved.webhook_node_name]
    );
    const path = node?.parameters_json?.path;
    return res.json({ ...approved, webhook_url: path ? `${N8N_WEBHOOK_BASE}/webhook/${path}` : null });
  }

  const { rows: [latest] } = await pool.query(
    `SELECT * FROM workflow_governance.test_execution_profiles
      WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [req.params.id]
  );
  if (!latest) return res.status(404).json({ error: 'No execution profile for this workflow' });
  res.json(latest);
}));

export default router;

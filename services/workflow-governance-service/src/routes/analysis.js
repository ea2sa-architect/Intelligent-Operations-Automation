import { Router } from 'express';
import pool from '../../db.js';
import requireAuth, { requirePermission } from '../lib/require-auth.js';
import extractor from '../lib/metadata-extractor.js';
import verifyN8nCallback from '../lib/verify-n8n-signature.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

const WEBHOOK_URL   = process.env.N8N_ANALYSIS_WEBHOOK_URL;
const CALLBACK_BASE = process.env.CALLBACK_BASE_URL || 'https://ioa.ea2sa.com';

// ── POST /workflows/:id/analyze ────────────────────────────────────────────
// Trigger an AI governance analysis for a scored workflow.
// Returns 202 immediately; n8n calls back when the AI agent completes.
// AUTH-201 (extended): SPA-triggered, requires auth.
router.post('/:id/analyze', requireAuth, requirePermission('workflow:read'), wrap(async (req, res) => {
  const { id } = req.params;

  // 1. Load the workflow — must exist and be scored
  const { rows: [wf] } = await pool.query(
    `SELECT id, name, tags, risk_score, risk_level, risk_breakdown_json
       FROM workflow_governance.workflows
      WHERE id = $1 OR n8n_id = $1`,
    [id]
  );
  if (!wf) return res.status(404).json({ error: 'Workflow not found' });
  if (!wf.risk_breakdown_json) {
    return res.status(409).json({ error: 'Workflow has not been scored — run /score first' });
  }

  // 2. Check for an already-pending job (idempotency guard)
  const { rows: [latest] } = await pool.query(
    `SELECT id, status, retry_count, max_retries
       FROM workflow_governance.workflow_analyses
      WHERE workflow_id = $1
      ORDER BY created_at DESC LIMIT 1`,
    [wf.id]
  );
  if (latest?.status === 'pending') {
    return res.status(409).json({ error: 'Analysis already in progress', job_id: latest.id });
  }

  // 3. Build the governance prompt payload from stored risk data
  const [{ rows: nodes }, { rows: pii }] = await Promise.all([
    pool.query(
      `SELECT governance_type, risk_factors
         FROM workflow_governance.workflow_nodes WHERE workflow_id = $1`,
      [wf.id]
    ),
    pool.query(
      `SELECT pii_type, node_name, masked, encrypted
         FROM workflow_governance.workflow_pii_exposure WHERE workflow_id = $1`,
      [wf.id]
    ),
  ]);

  const nodeTypeCounts = {};
  for (const n of nodes) {
    nodeTypeCounts[n.governance_type] = (nodeTypeCounts[n.governance_type] || 0) + 1;
  }

  const breakdown = wf.risk_breakdown_json;
  const promptPayload = {
    name:              wf.name,
    risk_score:        Number(wf.risk_score),
    risk_level:        wf.risk_level,
    tags:              wf.tags || [],
    top_risk_factors:  breakdown.top_risk_factors || [],
    node_count:        nodes.length,
    node_types:        nodeTypeCounts,
    has_approval_nodes: (nodeTypeCounts.approval || 0) > 0,
    has_error_handling: (breakdown.dimensions?.error_handling?.score ?? 0) > 0,
    has_logging:        (breakdown.dimensions?.notification?.score ?? 0) > 0,
    pii_exposure:       pii,
    risk_dimensions:    breakdown.dimensions || {},
  };

  const retryCount = 0;

  // 4. Persist the job row before firing the webhook
  const { rows: [job] } = await pool.query(
    `INSERT INTO workflow_governance.workflow_analyses
       (workflow_id, status, prompt_json, retry_count)
     VALUES ($1, 'pending', $2, $3)
     RETURNING id`,
    [wf.id, JSON.stringify(promptPayload), retryCount]
  );

  // 5. Verify webhook is configured
  if (!WEBHOOK_URL) {
    await pool.query(
      `UPDATE workflow_governance.workflow_analyses
          SET status = 'failed', error = 'N8N_ANALYSIS_WEBHOOK_URL not configured'
        WHERE id = $1`,
      [job.id]
    );
    return res.status(503).json({ error: 'Analysis webhook not configured on this server' });
  }

  // 6. Fire the n8n webhook — fail fast on any error
  const callbackUrl = `${CALLBACK_BASE}/api/workflow-governance/workflows/analyze/callback/${job.id}`;
  try {
    const webhookRes = await fetch(WEBHOOK_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ job_id: job.id, callback_url: callbackUrl, workflow: promptPayload }),
      signal:  AbortSignal.timeout(15_000),
    });
    if (!webhookRes.ok) {
      const body = await webhookRes.text().catch(() => '');
      throw new Error(`n8n returned ${webhookRes.status}: ${body}`);
    }
  } catch (err) {
    await pool.query(
      `UPDATE workflow_governance.workflow_analyses
          SET status = 'failed', error = $1
        WHERE id = $2`,
      [`n8n webhook unreachable: ${err.message}`, job.id]
    );
    return res.status(502).json({
      error: `Failed to reach analysis webhook: ${err.message}`,
      job_id: job.id,
    });
  }

  res.status(202).json({ job_id: job.id, status: 'pending' });
}));

// ── GET /workflows/analysis/:job_id ───────────────────────────────────────
// Poll for job status + result. Called by the SPA every 3 s.
// AUTH-201 (extended): SPA-triggered, requires auth.
router.get('/analysis/:job_id', requireAuth, wrap(async (req, res) => {
  const { rows: [job] } = await pool.query(
    `SELECT id, workflow_id, status, analysis, error,
            retry_count, max_retries, created_at, completed_at
       FROM workflow_governance.workflow_analyses
      WHERE id = $1`,
    [req.params.job_id]
  );
  if (!job) return res.status(404).json({ error: 'Analysis job not found' });
  res.json(job);
}));

// ── POST /workflows/analyze/callback/:job_id ──────────────────────────────
// n8n calls this when the AI agent finishes. Transactional write — returns
// 200 only after the commit so n8n's HTTP Request node logs a failure on
// any DB error (allowing the reaper to clean up the orphan instead).
// EP-310-S1: verifyN8nSignature checks X-IOA-Signature HMAC when
// N8N_WEBHOOK_SECRET is set. Without the env var the route remains open
// (existing behaviour); set the secret here and the matching header in the
// n8n HTTP Request node to fully close the gap.
router.post('/analyze/callback/:job_id', verifyN8nCallback, wrap(async (req, res) => {
  const { job_id } = req.params;
  const { analysis, error: analysisError } = req.body;

  if (!analysis && !analysisError) {
    return res.status(400).json({ error: 'Request body must include "analysis" or "error" field' });
  }

  // Verify job exists and is still actionable
  const { rows: [job] } = await pool.query(
    `SELECT id, workflow_id, status FROM workflow_governance.workflow_analyses WHERE id = $1`,
    [job_id]
  );
  if (!job)                    return res.status(404).json({ error: 'Analysis job not found' });
  if (job.status !== 'pending') return res.status(409).json({ error: `Job already in terminal state: ${job.status}` });

  // EP-101-S2 — this payload comes from the n8n AI agent over an
  // unauthenticated callback (see comment above); scan it for hardcoded
  // credentials the same way node parameters are scanned at import/discover,
  // and persist the redacted copy rather than the raw agent output.
  const { findings: secretFindings, redactedParameters: redactedAnalysis } =
    analysis ? extractor.scanForSecrets(analysis) : { findings: [], redactedParameters: null };

  // Transactional update — 200 only after commit; 500 lets reaper handle it
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    if (analysisError) {
      await client.query(
        `UPDATE workflow_governance.workflow_analyses
            SET status = 'failed', error = $1, completed_at = NOW()
          WHERE id = $2`,
        [analysisError, job_id]
      );
    } else {
      await client.query(
        `UPDATE workflow_governance.workflow_analyses
            SET status = 'completed', analysis = $1, completed_at = NOW()
          WHERE id = $2`,
        [redactedAnalysis, job_id]
      );
      for (const finding of secretFindings) {
        await client.query(
          `INSERT INTO workflow_governance.workflow_secret_exposure
             (workflow_id, secret_type, node_name, redacted_preview, fingerprint_sha256)
           VALUES ($1,$2,$3,$4,$5)`,
          [job.workflow_id, finding.secret_type, 'ai_analysis_callback', finding.redacted_preview, finding.fingerprint_sha256]
        );
      }
    }

    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err; // wrap() returns 500 → n8n logs the failure
  } finally {
    client.release();
  }
}));

// ── GET /workflows/:id/analyses ───────────────────────────────────────────
// List analysis history for a workflow (most recent first).
// AUTH-201 (extended): SPA-triggered, requires auth.
router.get('/:id/analyses', requireAuth, wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT id, status, retry_count, max_retries, error, created_at, completed_at
       FROM workflow_governance.workflow_analyses
      WHERE workflow_id = $1
      ORDER BY created_at DESC
      LIMIT 10`,
    [req.params.id]
  );
  res.json(rows);
}));

export default router;

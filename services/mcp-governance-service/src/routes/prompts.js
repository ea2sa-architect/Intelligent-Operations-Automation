import { Router } from 'express';
import pool from '../../db.js';
import credentialScanner from '../lib/credential-scanner.js';
import governanceClient from '../lib/governance-client.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

const APPROVAL_STATUSES = ['pending', 'allowed', 'denied'];

// EP-101-S4 — replaces this prompt's 'prompt_content' credential findings
// with a fresh scan result. Delete + reinsert, same pattern as servers.js's
// persistCredentialFindings.
// EP-101-S9 — carries forward rotation_confirmed_at/by across a rescan when
// the exact same fingerprint reappears (see servers.js's persistCredentialFindings).
async function persistPromptCredentialFindings(serverId, promptId, findings) {
  const { rows: existing } = await pool.query(
    `SELECT fingerprint_sha256, rotation_confirmed_at, rotation_confirmed_by
       FROM mcp_governance.mcp_credential_exposure WHERE prompt_id = $1 AND source_type = 'prompt_content'`,
    [promptId]
  );
  const priorByFingerprint = new Map(existing.map(e => [e.fingerprint_sha256, e]));

  await pool.query(
    `DELETE FROM mcp_governance.mcp_credential_exposure WHERE prompt_id = $1 AND source_type = 'prompt_content'`,
    [promptId]
  );
  for (const f of findings) {
    const carried = priorByFingerprint.get(f.fingerprint_sha256);
    await pool.query(
      `INSERT INTO mcp_governance.mcp_credential_exposure
         (server_id, prompt_id, source_type, field_name, secret_type, redacted_preview, fingerprint_sha256, rotation_confirmed_at, rotation_confirmed_by)
       VALUES ($1, $2, 'prompt_content', $3, $4, $5, $6, $7, $8)`,
      [serverId, promptId, f.field_name, f.secret_type, f.redacted_preview, f.fingerprint_sha256,
       carried?.rotation_confirmed_at ?? null, carried?.rotation_confirmed_by ?? null]
    );
  }
}

// GET /servers/:serverId/prompts
router.get('/servers/:serverId/prompts', wrap(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT * FROM mcp_governance.mcp_prompts WHERE server_id = $1 ORDER BY name',
    [req.params.serverId]
  );
  res.json(rows);
}));

// POST /servers/:serverId/prompts
router.post('/servers/:serverId/prompts', requirePermission('mcp:register'), wrap(async (req, res) => {
  const { name, content_hash, version, source, embedded_instructions, tool_references, privilege_implications } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });

  // EP-101-S4 — prompt templates/instructions are exactly the kind of free
  // text a hardcoded credential ends up pasted into; scan before persisting.
  const { redactedFields, findings } = credentialScanner.redactFields({ embedded_instructions, privilege_implications });

  const { rows: [prompt] } = await pool.query(
    `INSERT INTO mcp_governance.mcp_prompts
       (server_id, name, content_hash, version, source, embedded_instructions, tool_references, privilege_implications)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING *`,
    [req.params.serverId, name.trim(), content_hash ?? null, version ?? null, source ?? null,
     redactedFields.embedded_instructions ?? null, tool_references ?? null, redactedFields.privilege_implications ?? null]
  );

  if (findings.length > 0) {
    await persistPromptCredentialFindings(req.params.serverId, prompt.id, findings);
    await governanceClient.evaluateServer(req.params.serverId);
  }
  res.status(201).json({ ...prompt, credential_exposure_detected: findings.length > 0 });
}));

// PATCH /prompts/:id/approval.
// EP-103-S2/S3 — mcp_prompts has no local decision-history table (unlike
// tools/servers), so governance-service's approval_decision_history is the
// *only* place a prompt approval decision is preserved — closing a gap that
// predates this epic, not just mirroring an existing local record.
router.patch('/prompts/:id/approval', requirePermission('mcp:approve'), wrap(async (req, res) => {
  const { approval_status } = req.body;
  if (!APPROVAL_STATUSES.includes(approval_status)) {
    return res.status(400).json({ error: `approval_status must be one of: ${APPROVAL_STATUSES.join(', ')}` });
  }
  const { rows: [prompt] } = await pool.query(
    `UPDATE mcp_governance.mcp_prompts SET approval_status = $1, updated_at = NOW()
      WHERE id = $2 RETURNING *`,
    [approval_status, req.params.id]
  );
  if (!prompt) return res.status(404).json({ error: 'Prompt not found' });

  await governanceClient.recordApprovalDecision({
    assetType: 'mcp_prompt', assetId: req.params.id, decision: approval_status,
    actor: req.user?.username ?? 'unknown', role: req.user?.roles?.[0] ?? null,
  });

  res.json(prompt);
}));

// DELETE /prompts/:id
router.delete('/prompts/:id', requirePermission('mcp:register'), wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM mcp_governance.mcp_prompts WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Prompt not found' });
  res.status(204).end();
}));

export default router;

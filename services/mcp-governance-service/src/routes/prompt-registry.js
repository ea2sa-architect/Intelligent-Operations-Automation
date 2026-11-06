import { Router } from 'express'
import { createHash } from 'crypto'
import pool from '../../db.js'
import { requirePermission } from '../lib/require-auth.js'

const router = Router()

function hashContent(content) {
  return createHash('sha256').update(content).digest('hex')
}

// ── List all prompts ─────────────────────────────────────────────────────────
router.get('/prompt-registry', async (_req, res) => {
  const { rows } = await pool.query(`
    SELECT p.*,
      COUNT(v.id)::int AS version_count
    FROM prompt_registry p
    LEFT JOIN prompt_registry_versions v ON v.prompt_id = p.id
    GROUP BY p.id
    ORDER BY p.updated_at DESC
  `)
  res.json(rows)
})

// ── Create a prompt (seeds version 1 in version history) ─────────────────────
router.post('/prompt-registry', requirePermission('mcp:register'), async (req, res) => {
  const {
    name, type, content, owner, purpose,
    approved_models = [], permitted_data_classes = [],
  } = req.body

  if (!name || !type || !content) {
    return res.status(400).json({ error: 'name, type, and content are required' })
  }

  const content_hash = hashContent(content)
  const changedBy = req.user?.username ?? 'system'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: [prompt] } = await client.query(`
      INSERT INTO prompt_registry
        (name, type, content, content_hash, owner, purpose, approved_models, permitted_data_classes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [name, type, content, content_hash, owner ?? null, purpose ?? null,
        JSON.stringify(approved_models), JSON.stringify(permitted_data_classes)])

    await client.query(`
      INSERT INTO prompt_registry_versions
        (prompt_id, version, content, content_hash, changed_by)
      VALUES ($1, 1, $2, $3, $4)
    `, [prompt.id, content, content_hash, changedBy])

    await client.query('COMMIT')
    res.status(201).json(prompt)
  } catch (err) {
    await client.query('ROLLBACK')
    if (err.code === '23505') return res.status(409).json({ error: 'A prompt with this name already exists' })
    throw err
  } finally {
    client.release()
  }
})

// ── Drift check — MUST be before /:id to avoid wildcard match ────────────────
// Compares a submitted hash against the approved content hash.
// If drift is detected and the prompt is currently approved, resets it to
// pending and opens a governance violation.
router.post('/prompt-registry/check-drift', requirePermission('mcp:register'), async (req, res) => {
  const { prompt_id, name, content_hash } = req.body
  if (!content_hash) return res.status(400).json({ error: 'content_hash is required' })
  if (!prompt_id && !name) return res.status(400).json({ error: 'prompt_id or name is required' })

  const { rows } = await pool.query(
    `SELECT id, name, content_hash, approval_status, version
     FROM prompt_registry
     WHERE ${prompt_id ? 'id=$1' : 'name=$1'}`,
    [prompt_id ?? name]
  )

  if (!rows.length) return res.status(404).json({ error: 'Prompt not found' })
  const prompt = rows[0]

  const drifted = prompt.content_hash !== content_hash

  if (drifted && prompt.approval_status === 'approved') {
    await pool.query(`
      UPDATE prompt_registry
      SET approval_status = 'pending',
          approved_by     = NULL,
          approved_at     = NULL,
          updated_at      = NOW()
      WHERE id = $1
    `, [prompt.id])

    // Cross-schema insert: mcp_governance pool can still reference governance.*
    // using fully-qualified names since all schemas live in the same database
    // under the same ioa user.
    await pool.query(`
      WITH rule AS (
        SELECT pr.id AS rule_id, pr.policy_id
        FROM governance.policy_rules pr
        JOIN governance.policies p ON p.id = pr.policy_id
        WHERE p.name = 'Prompt Registry'
        LIMIT 1
      )
      INSERT INTO governance.violations
        (entity_type, entity_id, rule_id, policy_id, severity, message, status)
      SELECT 'prompt_registry', $1, rule.rule_id, rule.policy_id,
        'high',
        'Prompt drift detected: ' || $2 || ' — content hash does not match approved version ' || $3::text,
        'open'
      FROM rule
      WHERE NOT EXISTS (
        SELECT 1 FROM governance.violations v
        WHERE v.entity_type = 'prompt_registry'
          AND v.entity_id = $1
          AND v.status IN ('open', 'acknowledged', 'remediating', 'reopened')
      )
    `, [prompt.id, prompt.name, prompt.version])
  }

  res.json({
    prompt_id:       prompt.id,
    name:            prompt.name,
    version:         prompt.version,
    drifted,
    approval_status: drifted ? 'pending' : prompt.approval_status,
    message:         drifted
      ? 'Content hash mismatch — prompt marked pending re-approval'
      : 'Hash matches approved content — no drift detected',
  })
})

// ── Get one prompt with full version history ──────────────────────────────────
router.get('/prompt-registry/:id', async (req, res) => {
  const [promptRes, versionsRes] = await Promise.all([
    pool.query('SELECT * FROM prompt_registry WHERE id=$1', [req.params.id]),
    pool.query(
      'SELECT * FROM prompt_registry_versions WHERE prompt_id=$1 ORDER BY version DESC',
      [req.params.id]
    ),
  ])
  if (!promptRes.rows.length) return res.status(404).json({ error: 'Not found' })
  res.json({ ...promptRes.rows[0], versions: versionsRes.rows })
})

// ── Update content — archives current version, increments, resets to pending ─
router.put('/prompt-registry/:id', requirePermission('mcp:register'), async (req, res) => {
  const { content, owner, purpose, approved_models, permitted_data_classes } = req.body
  if (!content) return res.status(400).json({ error: 'content is required' })

  const changedBy = req.user?.username ?? 'system'
  const newHash   = hashContent(content)

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: [current] } = await client.query(
      'SELECT version, content, content_hash FROM prompt_registry WHERE id=$1 FOR UPDATE',
      [req.params.id]
    )
    if (!current) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }) }

    const newVersion = current.version + 1

    await client.query(`
      INSERT INTO prompt_registry_versions
        (prompt_id, version, content, content_hash, changed_by)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (prompt_id, version) DO NOTHING
    `, [req.params.id, newVersion, content, newHash, changedBy])

    const fields = ['content=$2', 'content_hash=$3', 'version=$4',
                    "approval_status='pending'", 'approved_by=NULL',
                    'approved_at=NULL', 'updated_at=NOW()']
    const vals   = [req.params.id, content, newHash, newVersion]
    let  idx     = 5

    if (owner !== undefined)                { fields.push(`owner=$${idx}`);                   vals.push(owner);                   idx++ }
    if (purpose !== undefined)              { fields.push(`purpose=$${idx}`);                 vals.push(purpose);                 idx++ }
    if (approved_models !== undefined)      { fields.push(`approved_models=$${idx}`);         vals.push(JSON.stringify(approved_models)); idx++ }
    if (permitted_data_classes !== undefined){ fields.push(`permitted_data_classes=$${idx}`); vals.push(JSON.stringify(permitted_data_classes)); idx++ }

    const { rows: [updated] } = await client.query(
      `UPDATE prompt_registry SET ${fields.join(', ')} WHERE id=$1 RETURNING *`,
      vals
    )

    await client.query('COMMIT')
    res.json(updated)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

// ── Approval — approve / deny / deprecate ─────────────────────────────────────
router.patch('/prompt-registry/:id/approval', requirePermission('mcp:approve'), async (req, res) => {
  const { approval_status, approved_by } = req.body
  const valid = ['approved', 'denied', 'deprecated']
  if (!valid.includes(approval_status)) {
    return res.status(400).json({ error: `approval_status must be one of: ${valid.join(', ')}` })
  }

  const byUser = approved_by ?? req.user?.username ?? 'system'
  const approvedAt = approval_status === 'approved' ? 'NOW()' : 'NULL'

  const { rows: [row] } = await pool.query(`
    UPDATE prompt_registry
    SET approval_status = $2,
        approved_by     = $3,
        approved_at     = ${approvedAt},
        updated_at      = NOW()
    WHERE id = $1
    RETURNING *
  `, [req.params.id, approval_status, byUser])

  if (!row) return res.status(404).json({ error: 'Not found' })
  res.json(row)
})

// ── Rollback to a prior version ───────────────────────────────────────────────
// Creates a NEW version (current+1) with the target version's content.
// Version numbers always increase; rollback never resets them backward.
router.post('/prompt-registry/:id/rollback/:version', requirePermission('mcp:register'), async (req, res) => {
  const targetVersion = parseInt(req.params.version, 10)
  const changedBy     = req.user?.username ?? 'system'

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: [current] } = await client.query(
      'SELECT version FROM prompt_registry WHERE id=$1 FOR UPDATE',
      [req.params.id]
    )
    if (!current) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Prompt not found' }) }

    const { rows: [target] } = await client.query(
      'SELECT content, content_hash FROM prompt_registry_versions WHERE prompt_id=$1 AND version=$2',
      [req.params.id, targetVersion]
    )
    if (!target) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Version not found' }) }

    const newVersion = current.version + 1

    await client.query(`
      INSERT INTO prompt_registry_versions
        (prompt_id, version, content, content_hash, changed_by)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (prompt_id, version) DO NOTHING
    `, [req.params.id, newVersion, target.content, target.content_hash,
        `rollback to v${targetVersion} by ${changedBy}`])

    const { rows: [updated] } = await client.query(`
      UPDATE prompt_registry
      SET content         = $2,
          content_hash    = $3,
          version         = $4,
          approval_status = 'pending',
          approved_by     = NULL,
          approved_at     = NULL,
          updated_at      = NOW()
      WHERE id = $1
      RETURNING *
    `, [req.params.id, target.content, target.content_hash, newVersion])

    await client.query('COMMIT')
    res.json(updated)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

export default router

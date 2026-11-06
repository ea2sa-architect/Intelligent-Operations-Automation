import { Router } from 'express';
import pool from '../../db.js';
import credentialScanner from '../lib/credential-scanner.js';
import { requirePermission } from '../lib/require-auth.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

// Epic 6, Feature 6.2 — administrator-configurable redaction patterns,
// applied alongside the built-in SECRET_PATTERNS when redacting MCP
// invocation telemetry (and config data). "Without changing application
// code" — a bad regex is rejected at creation time, not discovered at scan time.

router.get('/redaction-patterns', wrap(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM mcp_governance.redaction_patterns ORDER BY name');
  res.json(rows);
}));

// EP-101-S3 — `name`/`pattern` are meant to hold a detection *rule*, not a
// live secret, but nothing stops an admin from pasting one in by mistake
// (e.g. testing a pattern against a real key instead of writing a regex for
// its shape). Since this table's own GET response returns both fields
// unfiltered, catch that at write time — reject rather than redact, since a
// redacted `pattern` would silently stop matching anything.
function rejectIfSecretShaped(fields) {
  const { findings } = credentialScanner.redactFields(fields);
  if (findings.length === 0) return null;
  const { field_name, secret_type } = findings[0];
  return `${field_name} looks like it contains a real credential (${secret_type}), not a detection pattern — use a regex describing the credential's shape instead`;
}

router.post('/redaction-patterns', requirePermission('policy:edit'), wrap(async (req, res) => {
  const { name, pattern, enabled } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  if (!pattern) return res.status(400).json({ error: 'pattern is required' });
  if (!credentialScanner.compilePattern(pattern)) {
    return res.status(400).json({ error: 'pattern is not a valid regular expression' });
  }
  const secretError = rejectIfSecretShaped({ name, pattern });
  if (secretError) return res.status(400).json({ error: secretError });

  const { rows: [row] } = await pool.query(
    'INSERT INTO mcp_governance.redaction_patterns (name, pattern, enabled) VALUES ($1, $2, $3) RETURNING *',
    [name.trim(), pattern, enabled ?? true]
  );
  res.status(201).json(row);
}));

router.patch('/redaction-patterns/:id', requirePermission('policy:edit'), wrap(async (req, res) => {
  const { pattern, enabled } = req.body;
  if (pattern && !credentialScanner.compilePattern(pattern)) {
    return res.status(400).json({ error: 'pattern is not a valid regular expression' });
  }
  if (pattern) {
    const secretError = rejectIfSecretShaped({ pattern });
    if (secretError) return res.status(400).json({ error: secretError });
  }

  const { rows: [row] } = await pool.query(
    `UPDATE mcp_governance.redaction_patterns
        SET pattern = COALESCE($1, pattern),
            enabled = COALESCE($2, enabled)
      WHERE id = $3
      RETURNING *`,
    [pattern ?? null, enabled ?? null, req.params.id]
  );
  if (!row) return res.status(404).json({ error: 'Redaction pattern not found' });
  res.json(row);
}));

router.delete('/redaction-patterns/:id', requirePermission('policy:edit'), wrap(async (req, res) => {
  const { rowCount } = await pool.query('DELETE FROM mcp_governance.redaction_patterns WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Redaction pattern not found' });
  res.status(204).end();
}));

export default router;

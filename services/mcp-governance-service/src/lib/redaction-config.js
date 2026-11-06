// Epic 6, Feature 6.2 — loads administrator-configured redaction patterns
// from mcp_governance.redaction_patterns and compiles them for use alongside
// credential-scanner.js's built-in SECRET_PATTERNS. Kept separate from
// credential-scanner.js so that module stays a pure, DB-free function set.

import pool from '../../db.js';
import credentialScanner from './credential-scanner.js';

async function loadEnabledExtraPatterns() {
  const { rows } = await pool.query(
    'SELECT name, pattern FROM mcp_governance.redaction_patterns WHERE enabled = true'
  );
  const patterns = {};
  for (const row of rows) {
    const compiled = credentialScanner.compilePattern(row.pattern);
    if (compiled) patterns[row.name] = compiled;
  }
  return patterns;
}

export default { loadEnabledExtraPatterns };

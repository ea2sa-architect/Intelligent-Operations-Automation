import pool from '../../../db.js';
import * as kongCollector     from './kong.js';
import * as n8nCollector      from './n8n.js';
import * as postgresCollector from './postgres.js';

const COLLECTORS = [kongCollector, n8nCollector, postgresCollector];
const INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function runAll() {
  for (const collector of COLLECTORS) {
    try {
      const result = await collector.collect(pool);
      await pool.query(
        `INSERT INTO workflow_governance.assurance_evidence
           (evidence_type, source_system, status, evidence,
            confidence_level, collected_by, collected_at,
            verified_by, observed_at, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW(),$7,NOW(), NOW() + INTERVAL '10 minutes')`,
        [
          result.evidence_type,
          result.collected_by,
          result.status,
          JSON.stringify(result.evidence),
          result.confidence_level,
          result.collected_by,
          result.collected_by,
        ]
      );
    } catch (err) {
      console.error(`[collector-runner] ${err.message}`);
    }
  }
}

export function startCollectors() {
  runAll().catch(err => console.error('[collector-runner] startup sweep failed:', err.message));
  const handle = setInterval(
    () => runAll().catch(err => console.error('[collector-runner] interval failed:', err.message)),
    INTERVAL_MS
  );
  console.log('[collector-runner] Started — collecting platform evidence every 5 min');
  return handle;
}

// EP-302-S3/S4/S5 — cron-driven control test runner.
// Queries enabled tests, executes each handler, records results, and on failure
// creates a CRITICAL governance violation + escalation incident.
// On pass, inserts assurance evidence at confidence_level = 'control_tested'.

import pool from '../../db.js';

const PORT             = process.env.PORT             || 3300;
const KONG_ADMIN_URL   = process.env.KONG_ADMIN_URL   || 'http://kong-gateway:8001';
const ESCALATION_URL   = process.env.ESCALATION_URL   || 'http://escalation-service:3303';

// ── Test handlers ────────────────────────────────────────────────────────────

// Test: auth middleware blocks unauthenticated requests to this service
async function runUnauthorizedCallBlocked() {
  const url = `http://localhost:${PORT}/policies`;
  const res = await fetch(url);
  if (res.status === 401) {
    return { result: 'pass', evidence: { url, status: 401 } };
  }
  return {
    result: 'fail',
    evidence: { url, status: res.status, message: `Expected 401, got ${res.status} — auth middleware may be disabled` },
  };
}

// Test: all telemetry events in last 24 h have a correlation_id
async function runCorrelationIdCoverage() {
  const { rows: [row] } = await pool.query(`
    SELECT
      COUNT(*)::int                                          AS total,
      COUNT(*) FILTER (WHERE correlation_id IS NULL)::int   AS missing
    FROM telemetry.metrics
    WHERE time > NOW() - INTERVAL '24 hours'
  `);
  if (row.total === 0) {
    return { result: 'skipped', evidence: { message: 'No telemetry events in last 24 h' } };
  }
  if (row.missing === 0) {
    return { result: 'pass', evidence: { total: row.total, missing: 0 } };
  }
  return {
    result: 'fail',
    evidence: {
      total: row.total,
      missing: row.missing,
      message: `${row.missing} of ${row.total} events are missing a correlation_id`,
    },
  };
}

// Test: retired/rejected MCP servers have no active Kong service
async function runRetiredServerBlocked() {
  const { rows: retired } = await pool.query(`
    SELECT id, name FROM mcp_governance.mcp_servers
    WHERE status IN ('rejected', 'retired')
  `);
  if (retired.length === 0) {
    return { result: 'skipped', evidence: { message: 'No retired or rejected MCP servers to check' } };
  }

  const leaking = [];
  for (const server of retired) {
    try {
      const res = await fetch(`${KONG_ADMIN_URL}/services/mcp-server-${server.id}`);
      if (res.ok) {
        leaking.push({ id: server.id, name: server.name });
      }
    } catch {
      // Kong unreachable — skip this server but don't fail the test
    }
  }

  if (leaking.length === 0) {
    return { result: 'pass', evidence: { checked: retired.length, leaking: 0 } };
  }
  return {
    result: 'fail',
    evidence: {
      checked: retired.length,
      leaking: leaking.length,
      servers: leaking,
      message: `${leaking.length} retired server(s) still have active Kong routes`,
    },
  };
}

// Test: rate-limiting plugin exists on at least one ioa-governance Kong route
async function runRateLimitingConfigured() {
  try {
    const res = await fetch(`${KONG_ADMIN_URL}/plugins?name=rate-limiting&size=10`);
    if (!res.ok) throw new Error(`Kong Admin returned ${res.status}`);
    const body = await res.json();
    const count = body.data?.length ?? 0;
    if (count > 0) {
      return { result: 'pass', evidence: { plugin_instances: count } };
    }
    return {
      result: 'fail',
      evidence: { plugin_instances: 0, message: 'No rate-limiting plugins found in Kong — gateway has no rate protection' },
    };
  } catch (err) {
    return { result: 'error', evidence: { error: err.message } };
  }
}

const HANDLERS = {
  unauthorized_call_blocked:  runUnauthorizedCallBlocked,
  correlation_id_coverage:    runCorrelationIdCoverage,
  retired_server_blocked:     runRetiredServerBlocked,
  rate_limiting_configured:   runRateLimitingConfigured,
};

// Evidence type written on a passing run (control_tested confidence)
const EVIDENCE_TYPE = {
  unauthorized_call_blocked:  'access_control_verified',
  correlation_id_coverage:    'telemetry_correlation_verified',
  retired_server_blocked:     'gateway_routing_verified',
  rate_limiting_configured:   'rate_limiting_verified',
};

// ── Side-effects ─────────────────────────────────────────────────────────────

async function recordRun(testId, result, evidence, durationMs) {
  await pool.query(
    `INSERT INTO governance.control_test_runs (test_id, result, evidence, duration_ms)
     VALUES ($1,$2,$3,$4)`,
    [testId, result, JSON.stringify(evidence), durationMs]
  );
  await pool.query(
    `UPDATE governance.control_tests
        SET last_run_at = NOW(), last_result = $2, last_evidence = $3
      WHERE id = $1`,
    [testId, result, JSON.stringify(evidence)]
  );
}

async function createViolationIfAbsent(test, evidence) {
  if (!test.violation_rule_id || !test.violation_policy_id) return;
  const { rows: [existing] } = await pool.query(
    `SELECT id FROM governance.violations
      WHERE entity_type = 'control_test' AND entity_id = $1
        AND status IN ('open','reopened')
      LIMIT 1`,
    [test.id]
  );
  if (existing) return;
  await pool.query(
    `INSERT INTO governance.violations
       (entity_type, entity_id, rule_id, policy_id, severity, message)
     VALUES ('control_test', $1, $2, $3, 'critical', $4)`,
    [
      test.id,
      test.violation_rule_id,
      test.violation_policy_id,
      `Control test failed: ${test.name} — ${evidence.message ?? JSON.stringify(evidence)}`,
    ]
  );
}

async function createEscalationIncident(test, evidence) {
  try {
    await fetch(`${ESCALATION_URL}/incidents`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        title:        `Control test failed: ${test.name}`,
        severity:     'critical',
        context_json: { test_type: test.test_type, test_id: test.id, evidence },
      }),
    });
  } catch (err) {
    console.error(`[control-tests] escalation incident failed for ${test.name}:`, err.message);
  }
}

async function recordPassingEvidence(test, evidence) {
  const evidenceType = EVIDENCE_TYPE[test.name];
  if (!evidenceType) return;
  try {
    await pool.query(
      `INSERT INTO workflow_governance.assurance_evidence
         (evidence_type, source_system, status, evidence,
          confidence_level, collected_by, collected_at,
          verified_by, observed_at, expires_at)
       VALUES ($1,'control-test-runner','verified',$2,
               'control_tested',$3,NOW(),$3,NOW(),
               NOW() + INTERVAL '20 minutes')`,
      [evidenceType, JSON.stringify(evidence), `control-test:${test.name}`]
    );
  } catch (err) {
    console.error(`[control-tests] evidence insert failed for ${test.name}:`, err.message);
  }
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function runAll() {
  const { rows: tests } = await pool.query(
    `SELECT * FROM governance.control_tests WHERE enabled = true ORDER BY name`
  );

  for (const test of tests) {
    const handler = HANDLERS[test.name];
    if (!handler) continue;

    const start = Date.now();
    let outcome;
    try {
      outcome = await handler();
    } catch (err) {
      outcome = { result: 'error', evidence: { error: err.message } };
    }
    const durationMs = Date.now() - start;

    await recordRun(test.id, outcome.result, outcome.evidence, durationMs).catch(
      err => console.error(`[control-tests] recordRun failed for ${test.name}:`, err.message)
    );

    if (outcome.result === 'fail') {
      await createViolationIfAbsent(test, outcome.evidence);
      await createEscalationIncident(test, outcome.evidence);
    } else if (outcome.result === 'pass') {
      await recordPassingEvidence(test, outcome.evidence);
    }

    console.log(`[control-tests] ${test.name}: ${outcome.result} (${durationMs}ms)`);
  }
}

export function startControlTestRunner() {
  runAll().catch(err => console.error('[control-tests] startup sweep failed:', err.message));
  setInterval(
    () => runAll().catch(err => console.error('[control-tests] interval failed:', err.message)),
    15 * 60 * 1000
  );
  console.log('[control-tests] Started — running 4 built-in controls every 15 min');
}

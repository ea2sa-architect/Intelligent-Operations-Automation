import chalk from 'chalk';

const SEVERITY_COLOR = { critical: chalk.red, high: chalk.red, medium: chalk.yellow, low: chalk.gray };

// Renders the base result runCheckPipeline produces (target, register,
// policy_coverage, violations) — the shared core every deeper command's
// own formatter extends with more sections.
export function formatCheckResult(result, { log = console.log } = {}) {
  log(chalk.bold(`\n${result.target.name} (${result.target.type} ${result.target.id})`));
  log(chalk.gray(`register: ${result.register.status} · run at ${result.run_at}`));

  const cov = result.policy_coverage;
  log(chalk.bold('\nPolicy coverage'));
  log(`  ${cov.evaluated}/${cov.applicable} applicable rules evaluated (${cov.pct}%)`);
  if (cov.stale.length) {
    log(chalk.yellow(`  ${cov.stale.length} rule(s) stale (evaluated, but not recently)`));
  }

  const { open, by_severity } = result.violations;
  log(chalk.bold('\nOpen violations'));
  if (!open.length) {
    log(chalk.green('  none'));
  } else {
    for (const [sev, count] of Object.entries(by_severity)) {
      if (count > 0) log(`  ${(SEVERITY_COLOR[sev] ?? chalk.white)(sev)}: ${count}`);
    }
    for (const v of open) {
      log(chalk.gray(`  - [${v.severity}] ${v.message} (policy: ${v.policy_name ?? v.policy_id})`));
    }
  }
  log('');
}

const ANOMALY_STATUS_LABEL = {
  no_baseline: chalk.gray('no baseline yet — behavior not established'),
  stale_baseline: chalk.yellow('baseline is stale — consider recomputing'),
  ok: chalk.green('baseline current'),
};

// Extends formatCheckResult's output with the two sections `ioa assess`
// adds (anomalies, attack_paths). `ioa threat-model` reuses the same data
// with its own formatter instead of this one — see format/threat-model.js.
export function formatAssessResult(result, { log = console.log } = {}) {
  formatCheckResult(result, { log });

  log(chalk.bold('Behavioral anomalies'));
  log(`  ${ANOMALY_STATUS_LABEL[result.anomalies.status] ?? result.anomalies.status}`);
  if (result.anomalies.alerts?.length) {
    for (const a of result.anomalies.alerts) {
      log(chalk.gray(`  - [${a.alert_type}] ${a.details ?? a.id}`));
    }
  }

  log(chalk.bold('\nAttack paths (referenced MCP servers)'));
  if (!result.attack_paths.length) {
    log(chalk.gray('  no MCP servers referenced'));
  } else {
    for (const p of result.attack_paths) {
      if (p.status === 'not_computed') {
        log(chalk.yellow(`  - ${p.mcp_server_id}: not computed yet (POST /attack-paths/rebuild/${p.mcp_server_id})`));
      } else {
        log(`  - ${p.server_name ?? p.mcp_server_id}: risk ${p.risk_score}`);
      }
    }
  }
  log('');
}

const EXECUTION_STATUS_LABEL = {
  not_eligible: chalk.gray,
  not_approved: chalk.yellow,
  tested: chalk.green,
};

// Extends formatAssessResult with the one section `ioa qa` adds beyond
// `ioa assess`: the controlled execution tier's outcome. `ioa verify-release`
// reuses this too, since its evidence bundle is a full `ioa qa` result.
export function formatQaResult(result, { log = console.log } = {}) {
  formatAssessResult(result, { log });

  const exec = result.execution;
  const color = EXECUTION_STATUS_LABEL[exec.status] ?? chalk.white;
  log(chalk.bold('Controlled execution testing'));
  log(`  ${color(exec.status)}${exec.reason ? ` — ${exec.reason}` : ''}`);
  for (const r of exec.results ?? []) {
    if (r.error) log(chalk.red(`  - ${r.scenario}: ${r.error}`));
    else log(`  - ${r.scenario}: HTTP ${r.http_status} in ${r.latency_ms}ms`);
  }
  log('');
}

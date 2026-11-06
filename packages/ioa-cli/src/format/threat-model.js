import chalk from 'chalk';

// Reachability/blast-radius framing — deliberately does NOT lead with the
// violations list the way formatCheckResult/formatAssessResult do. A threat
// model answers "what can this workflow reach and touch," violations answer
// "what did we already flag" — related but distinct questions.
export function formatThreatModel(result, { log = console.log } = {}) {
  log(chalk.bold(`\n${result.target.name} (${result.target.type} ${result.target.id}) — threat model`));

  const exp = result.exposure;
  log(chalk.bold('\nData exposure'));
  if (!exp.pii_types.length && !exp.unrotated_secrets_count) {
    log(chalk.green('  no PII or unrotated secrets detected'));
  } else {
    if (exp.pii_types.length) {
      log(`  PII types: ${exp.pii_types.join(', ')} (${exp.unmasked_pii_count} unmasked/unencrypted occurrence(s))`);
    }
    if (exp.unrotated_secrets_count) {
      log(chalk.red(`  ${exp.unrotated_secrets_count} unrotated exposed secret(s)`));
    }
  }

  log(chalk.bold('\nReachable surface (MCP servers this workflow can call)'));
  if (!result.attack_paths.length) {
    log(chalk.gray('  none referenced'));
  } else {
    for (const p of result.attack_paths) {
      if (p.status === 'not_computed') {
        log(chalk.yellow(`  - ${p.mcp_server_id}: reachability not yet computed`));
        continue;
      }
      log(`  - ${p.server_name ?? p.mcp_server_id}: risk ${p.risk_score}, ${p.reachable_tools?.length ?? 0} tool(s), ${p.external_destinations?.length ?? 0} external destination(s)`);
      for (const f of p.risk_factors ?? []) {
        log(chalk.gray(`      ${f.factor}: ${f.detail}`));
      }
    }
  }

  if (exp.nodes_with_risk_factors.length) {
    log(chalk.bold('\nNodes with structural risk factors'));
    for (const n of exp.nodes_with_risk_factors) {
      log(chalk.gray(`  - ${n.node_name}: ${n.risk_factors.join(', ')}`));
    }
  }

  log(chalk.bold('\nBehavioral anomalies'));
  log(`  ${result.anomalies.status}${result.anomalies.alerts?.length ? ` — ${result.anomalies.alerts.length} open alert(s)` : ''}`);
  log('');
}

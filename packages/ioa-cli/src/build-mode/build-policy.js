import chalk from 'chalk';
import { apiGet, apiPost, apiPatch } from '../api-client.js';

// Prompts a value for one rule_schemas field, per its `type`. This mirrors
// the shape governance-service's rule_schemas.schema_json already defines
// (see e.g. migration 032_ai_model_governance_policy.sql) — we read that
// schema live rather than hardcoding a second copy of the rule-type catalog.
export async function promptForField(field, prompts) {
  switch (field.type) {
    case 'severity':
    case 'enum':
      return prompts.select({
        message: field.label,
        choices: (field.options ?? []).map(o => ({ name: o, value: o })),
      });
    case 'multi_enum':
      return prompts.checkbox({
        message: field.label,
        choices: (field.options ?? []).map(o => ({ name: o, value: o })),
      });
    case 'json_array': {
      const raw = await prompts.input({ message: `${field.label} (comma-separated, blank for none)` });
      return raw.split(',').map(s => s.trim()).filter(Boolean);
    }
    case 'string':
    default:
      return prompts.input({ message: field.label });
  }
}

// Walks every field in a rule_schemas.schema_json, prompting for each.
// `severity` is pulled out separately — policy_rules stores it in its own
// column, not inside config_json, matching how POST /policies/:id/rules
// already destructures the request body.
export async function collectRuleAnswers(schema, prompts) {
  const config_json = {};
  let severity = 'medium';
  for (const field of schema.fields ?? []) {
    const value = await promptForField(field, prompts);
    if (field.name === 'severity') severity = value;
    else config_json[field.name] = value;
  }
  return { config_json, severity };
}

// Pure — assembles the exact request bodies runBuildPolicy will send,
// separated out so tests can assert on payload shape without mocking any
// prompts at all.
export function assemblePayloads({ ruleType, config_json, severity, name, description, enforcementMode }) {
  return {
    policy: { name, description, status: 'active' },
    rule:   { rule_type: ruleType, config_json, severity, enabled: true },
    enforcementMode,
  };
}

export async function runBuildPolicy({ baseUrl, token, apply = false, prompts, log = console.log }) {
  const schemas = await apiGet(baseUrl, token, '/api/governance/rule-schemas');
  if (!schemas.length) throw new Error('No rule types available — has the governance-service seed migration run?');

  const ruleType = await prompts.select({
    message: 'Rule type',
    choices: schemas.map(s => ({ name: `${s.display_name} — ${s.description}`, value: s.type })),
  });
  const schema = schemas.find(s => s.type === ruleType);

  const { config_json, severity } = await collectRuleAnswers(schema.schema_json, prompts);

  const name = await prompts.input({ message: 'Policy name' });
  const description = await prompts.input({ message: 'Policy description (optional)' });
  // observe is the platform-wide safe default — evaluateAiModel/evaluateZap's
  // own auto-bind behavior follows the same convention.
  const enforcementMode = await prompts.select({
    message: 'Enforcement mode',
    choices: [
      { name: 'observe (default — record, never block)', value: 'observe' },
      { name: 'warn',    value: 'warn' },
      { name: 'enforce', value: 'enforce' },
    ],
    default: 'observe',
  });

  const payloads = assemblePayloads({ ruleType, config_json, severity, name, description, enforcementMode });

  if (!apply) {
    log(chalk.yellow('--dry-run (default) — no changes made. Payloads that would be sent:'));
    log(JSON.stringify(payloads, null, 2));
    log(chalk.gray('Re-run with --apply to actually create this policy.'));
    return { applied: false, payloads };
  }

  const policy = await apiPost(baseUrl, token, '/api/governance/policies', payloads.policy);
  const rule = await apiPost(baseUrl, token, `/api/governance/policies/${policy.id}/rules`, payloads.rule);
  if (enforcementMode !== 'observe') {
    await apiPatch(baseUrl, token, `/api/governance/policies/${policy.id}/enforcement-mode`, { enforcement_mode: enforcementMode });
  }

  log(chalk.green(`✔ Created policy "${policy.name}" (${policy.id}) with rule ${rule.id}`));
  log(chalk.gray('No binding was created — bind it to a specific entity separately (POST /policies/:id/bindings), or let a future `ioa qa` run register/bind it as part of its own pipeline.'));
  return { applied: true, policy, rule };
}

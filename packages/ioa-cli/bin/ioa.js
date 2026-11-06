#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { select, checkbox, input } from '@inquirer/prompts';
import { exchangeApiKey } from '../src/api-client.js';
import { runBuildPolicy } from '../src/build-mode/build-policy.js';
import { runCheckPipeline, exitCodeFor } from '../src/pipeline/run-check.js';
import { runAssess } from '../src/pipeline/run-assess.js';
import { runThreatModel } from '../src/pipeline/run-threat-model.js';
import { runQa } from '../src/pipeline/run-qa.js';
import { formatCheckResult, formatAssessResult, formatQaResult } from '../src/format/report.js';
import { formatThreatModel } from '../src/format/threat-model.js';
import { runVerifyRelease, exitCodeForDecision } from '../src/pipeline/run-verify-release.js';

const program = new Command();
program
  .name('ioa')
  .description('IOA developer CLI — governance in the dev lifecycle')
  .version('0.1.0');

// Exchanges IOA_API_KEY for a short-lived JWT once per invocation — every
// command shares this, rather than each re-implementing its own exchange
// (a first draft had build-policy do this internally, which meant every
// other command that skipped it silently sent the raw ioak_... key as a
// Bearer token instead of a real JWT — caught via live testing, not the
// mocked test suite, since the mocks matched that same wrong assumption).
async function getSession() {
  const baseUrl = process.env.IOA_API_URL;
  const apiKey = process.env.IOA_API_KEY;
  if (!baseUrl || !apiKey) {
    console.error(chalk.red('✘ requires both IOA_API_URL and IOA_API_KEY to be set'));
    process.exitCode = 1;
    return null;
  }
  try {
    const { token } = await exchangeApiKey(baseUrl, apiKey);
    return { baseUrl, token };
  } catch (err) {
    console.error(chalk.red(`✘ ${err.message}`));
    process.exitCode = 1;
    return null;
  }
}

program
  .command('build-policy')
  .description('Interactively build a governance policy from a live rule-type catalog')
  .option('--apply', 'actually create the policy (default is --dry-run)')
  .action(async (opts) => {
    const session = await getSession();
    if (!session) return;
    try {
      await runBuildPolicy({ ...session, apply: !!opts.apply, prompts: { select, checkbox, input } });
    } catch (err) {
      console.error(chalk.red(`✘ ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command('policy-check <target>')
  .description('Register/evaluate a workflow and report open violations + policy coverage — exits 1 on any open critical/high violation')
  .option('--json', 'print the raw result as JSON instead of a formatted report')
  .action(async (target, opts) => {
    const session = await getSession();
    if (!session) return;
    try {
      const result = await runCheckPipeline({ ...session, target });
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else formatCheckResult(result);
      process.exitCode = exitCodeFor(result);
    } catch (err) {
      console.error(chalk.red(`✘ ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command('assess <target>')
  .description('Full read-only governance snapshot: violations, policy coverage, behavioral anomalies, and attack-path findings')
  .option('--json', 'print the raw result as JSON instead of a formatted report')
  .action(async (target, opts) => {
    const session = await getSession();
    if (!session) return;
    try {
      const result = await runAssess({ ...session, target });
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else formatAssessResult(result);
      process.exitCode = exitCodeFor(result);
    } catch (err) {
      console.error(chalk.red(`✘ ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command('threat-model <target>')
  .description('Reachability/blast-radius report: data exposure, MCP server reachability, and behavioral anomalies')
  .option('--json', 'print the raw result as JSON instead of a formatted report')
  .action(async (target, opts) => {
    const session = await getSession();
    if (!session) return;
    try {
      const result = await runThreatModel({ ...session, target });
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else formatThreatModel(result);
      process.exitCode = exitCodeFor(result);
    } catch (err) {
      console.error(chalk.red(`✘ ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command('qa <target>')
  .description('The full pipeline: everything `assess` reports, plus controlled execution testing if an approved profile exists')
  .option('--json', 'print the raw result as JSON instead of a formatted report')
  .action(async (target, opts) => {
    const session = await getSession();
    if (!session) return;
    try {
      const result = await runQa({ ...session, target });
      if (opts.json) console.log(JSON.stringify(result, null, 2));
      else formatQaResult(result);
      process.exitCode = exitCodeFor(result);
    } catch (err) {
      console.error(chalk.red(`✘ ${err.message}`));
      process.exitCode = 1;
    }
  });

program
  .command('verify-release <target>')
  .description('Run the full governance QA pipeline and persist a release certification decision')
  .option('--release-ref <ref>', 'git sha / tag / CI build id to associate with this decision')
  .option('--decided-by <actor>', 'who/what is certifying this release', 'system:ioa-cli')
  .option('--json', 'print the raw result as JSON instead of a formatted report')
  .action(async (target, opts) => {
    const session = await getSession();
    if (!session) return;
    try {
      const { evidenceBundle, decision } = await runVerifyRelease({
        ...session, target, releaseRef: opts.releaseRef, decidedBy: opts.decidedBy,
      });
      if (opts.json) {
        console.log(JSON.stringify({ evidenceBundle, decision }, null, 2));
      } else {
        formatQaResult(evidenceBundle);
        const color = decision.decision === 'certified' ? chalk.green : decision.decision === 'rejected' ? chalk.red : chalk.yellow;
        console.log(color.bold(`\nDecision: ${decision.decision}`) + chalk.gray(` (${decision.id})`));
      }
      process.exitCode = exitCodeForDecision(decision);
    } catch (err) {
      console.error(chalk.red(`✘ ${err.message}`));
      process.exitCode = 1;
    }
  });

program.parseAsync();

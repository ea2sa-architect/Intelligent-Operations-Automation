#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync } from 'fs';
import { runScan } from '../src/scan.js';
import { exchangeApiKey, importDiscovered } from '../src/api-client.js';
import { parseDuration } from '../src/duration.js';

const program = new Command();

program
  .name('discovery-agent')
  .description('IOA MCP Discovery Engine — scans local config files for MCP server registrations')
  .version('0.1.0');

async function runImportCycle() {
  const baseUrl = process.env.IOA_API_URL;
  const apiKey = process.env.IOA_API_KEY;
  if (!baseUrl || !apiKey) {
    console.error(chalk.red('✘ --import requires both IOA_API_URL and IOA_API_KEY to be set'));
    process.exitCode = 1;
    return false;
  }
  const { discovered } = await runScan();
  try {
    const { token } = await exchangeApiKey(baseUrl, apiKey);
    const result = await importDiscovered(baseUrl, token, discovered);
    console.log(chalk.green(
      `[${new Date().toISOString()}] ✔ imported: ${result.created} created, ${result.refreshed} refreshed, ${result.already_tracked} already tracked` +
      (result.skipped.length ? `, ${result.skipped.length} skipped` : '')
    ));
    return true;
  } catch (err) {
    console.error(chalk.red(`[${new Date().toISOString()}] ✘ ${err.message}`));
    return false;
  }
}

program
  .command('scan')
  .description('Scan known config locations for registered MCP servers')
  .option('--json', 'print raw JSON to stdout instead of a human-readable summary')
  .option('-o, --output <file>', 'write JSON results to a file instead of stdout')
  .option('--import', 'send discovered servers to the IOA platform (requires IOA_API_URL and IOA_API_KEY env vars)')
  // EP-306-S9 — an OS-level scheduler (cron, systemd timer, a Kubernetes
  // CronJob — see deploy/cronjob.yaml) calling `scan --import` repeatedly is
  // the preferred way to run this on a schedule, matching the "does not
  // need to be always-running" design from S1. --watch is the alternative
  // the story's own notes floated ("cron inside discovery-agent") for
  // environments where standing up an external scheduler is overkill —
  // it's an opt-in loop inside this one process, not a new architecture.
  .option('--watch <duration>', 'repeat --import on an interval (e.g. "1h", "30m", "1d") instead of running once')
  .action(async (opts) => {
    if (opts.watch && !opts.import) {
      console.error(chalk.red('✘ --watch requires --import'));
      process.exitCode = 1;
      return;
    }

    if (opts.watch) {
      const intervalMs = parseDuration(opts.watch);
      console.log(chalk.dim(`Watching — running every ${opts.watch}. Press Ctrl+C to stop.`));
      await runImportCycle();
      setInterval(runImportCycle, intervalMs);
      return; // never resolves on its own — the interval keeps the process alive
    }

    if (opts.import) {
      await runImportCycle();
      return;
    }

    const { discovered, errors } = await runScan();

    if (opts.output) {
      writeFileSync(opts.output, JSON.stringify({ discovered, errors }, null, 2));
      console.log(chalk.green(`✔ wrote ${discovered.length} discovered server(s) to ${opts.output}`));
      return;
    }

    if (opts.json) {
      console.log(JSON.stringify({ discovered, errors }, null, 2));
      return;
    }

    if (discovered.length === 0 && errors.length === 0) {
      console.log(chalk.dim('No MCP servers found in any known config location.'));
      return;
    }

    for (const server of discovered) {
      console.log(chalk.bold(server.name) + chalk.dim(`  (${server.source})`));
      if (server.url) {
        console.log(chalk.dim(`  url: ${server.url}`));
      } else {
        console.log(chalk.dim(`  command: ${server.command} ${server.args.join(' ')}`));
      }
      if (server.env_hints.length) {
        console.log(chalk.dim(`  env: ${server.env_hints.join(', ')}`));
      }
      console.log(chalk.dim(`  source: ${server.source_path}`));
      console.log();
    }

    for (const err of errors) {
      console.log(chalk.red(`✘ ${err.source}: ${err.message}`));
    }

    console.log(chalk.bold(`${discovered.length} server(s) found across ${new Set(discovered.map(s => s.source)).size} source(s).`));
  });

program.parseAsync();

#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { load } from 'js-yaml';
import ServiceGenerator from './generators/service-generator.js';
import K8sGenerator from './generators/k8s-generator.js';
import ComposeGenerator from './generators/compose-generator.js';
import KongGenerator from './generators/kong-generator.js';
import migrate from '../db/migrate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const config = load(readFileSync(resolve(__dirname, 'platform.config.yaml'), 'utf8'));

const program = new Command();

program
  .name('bootstrap-platform')
  .description('IOA Governance Platform bootstrapper — generates all infrastructure files')
  .version('1.0.0');

program
  .command('bootstrap')
  .description('Generate all platform infrastructure files')
  .option('--services-only', 'Generate only service files (Dockerfile, package.json, db.js, index.js)')
  .option('--k8s-only', 'Generate only Kubernetes manifests')
  .option('--compose-only', 'Generate only docker-compose.yml')
  .option('--kong-only', 'Generate only Kong declarative config')
  .action(async (opts) => {
    const selective = opts.servicesOnly || opts.k8sOnly || opts.composeOnly || opts.kongOnly;
    const runAll = !selective;

    console.log(chalk.bold.blue('\n  IOA Governance Platform Bootstrap\n'));
    console.log(chalk.dim(`  Services: ${config.services.map(s => s.name).join(', ')}\n`));

    const tasks = [
      {
        run: runAll || opts.servicesOnly,
        label: 'Generating service files',
        done: `Service files written  (${config.services.length} services)`,
        gen: () => new ServiceGenerator(config, ROOT).generate(),
      },
      {
        run: runAll || opts.k8sOnly,
        label: 'Generating Kubernetes manifests',
        done: `k8s/  namespace + ${config.services.length} deployments + ${config.services.length} services`,
        gen: () => new K8sGenerator(config, ROOT).generate(),
      },
      {
        run: runAll || opts.composeOnly,
        label: 'Generating docker-compose.yml',
        done: 'docker-compose.yml written  (services + db + Kong gateway)',
        gen: () => new ComposeGenerator(config, ROOT).generate(),
      },
      {
        run: runAll || opts.kongOnly,
        label: 'Generating Kong declarative config',
        done: 'kong/kong.yaml written',
        gen: () => new KongGenerator(config, ROOT).generate(),
      },
    ];

    for (const task of tasks) {
      if (!task.run) continue;
      const spinner = ora(chalk.dim(task.label)).start();
      try {
        await task.gen();
        spinner.succeed(chalk.green(task.done));
      } catch (err) {
        spinner.fail(chalk.red(`${task.label} failed: ${err.message}`));
        process.exit(1);
      }
    }

    console.log(chalk.bold.green('\n  Bootstrap complete!\n'));
    console.log(chalk.dim('  Run:     docker compose up --build'));
    console.log(chalk.dim('  Migrate: npm run migrate'));
    console.log(chalk.dim('  K8s:     kubectl apply -f k8s/\n'));
  });

program
  .command('migrate')
  .description('Apply database migrations against a running Postgres instance')
  .option(
    '--url <url>',
    'PostgreSQL connection URL',
    `postgresql://${config.database.user}:${config.database.password}@localhost:${config.database.port}/${config.database.name}`
  )
  .action(async (opts) => {
    console.log(chalk.bold.blue('\n  IOA Governance — Database Migrations\n'));
    const spinner = ora(chalk.dim('Connecting to database')).start();
    try {
      spinner.text = chalk.dim('Applying migrations');
      await migrate(opts.url);
      spinner.succeed(chalk.green('All migrations applied'));
    } catch (err) {
      spinner.fail(chalk.red(`Migration failed: ${err.message}`));
      process.exit(1);
    }
    console.log();
  });

program.parse();

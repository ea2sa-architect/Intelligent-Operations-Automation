#!/usr/bin/env node
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import pg from 'pg';

const { Pool } = pg;
const __dirname = dirname(fileURLToPath(import.meta.url));

const SCHEMAS = ['governance', 'ai_inference', 'audit', 'escalation', 'telemetry', 'workflow_governance', 'mcp_governance', 'auth'];

export default async function migrate(connectionString) {
  const url = connectionString
    || process.env.DATABASE_URL
    || 'postgresql://ioa:ioa@localhost:5438/ioa_governance';

  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS public.migrations (
        id          SERIAL       PRIMARY KEY,
        schema_name VARCHAR(100) NOT NULL,
        filename    VARCHAR(255) NOT NULL,
        applied_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        UNIQUE (schema_name, filename)
      )
    `);

    for (const schema of SCHEMAS) {
      const migrationsDir = resolve(__dirname, 'migrations', schema);
      let files;
      try {
        files = readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
      } catch {
        console.warn(`  ⚠  No migrations found for schema: ${schema}`);
        continue;
      }

      for (const file of files) {
        const { rows } = await client.query(
          'SELECT 1 FROM public.migrations WHERE schema_name = $1 AND filename = $2',
          [schema, file]
        );
        if (rows.length > 0) continue;

        console.log(`  → ${schema}/${file}`);
        const sql = readFileSync(resolve(migrationsDir, file), 'utf8');

        await client.query('BEGIN');
        try {
          await client.query(sql);
          await client.query(
            'INSERT INTO public.migrations (schema_name, filename) VALUES ($1, $2)',
            [schema, file]
          );
          await client.query('COMMIT');
          console.log(`  ✔  ${schema}/${file}`);
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Migration failed [${schema}/${file}]: ${err.message}`);
        }
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

// Run directly: node db/migrate.js [connection-url]
const isMain = import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  migrate(process.argv[2]).catch(err => {
    console.error(err.message);
    process.exit(1);
  });
}

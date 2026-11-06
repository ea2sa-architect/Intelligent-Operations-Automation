import express from 'express';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import securityHeaders from './src/lib/require-security-headers.js';
import pool from './db.js';
import { swaggerSpec } from './swagger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3307;

app.use(securityHeaders);
app.use(express.json());
app.use(cookieParser());

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'auth-service', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'degraded', service: 'auth-service', db: 'disconnected' });
  }
});

app.get('/openapi.json', (_req, res) => res.json(swaggerSpec));

if (existsSync(resolve(__dirname, 'src/routes/index.js'))) {
  const { default: routes } = await import('./src/routes/index.js');
  app.use('/', routes);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { default: seedAdmin } = await import('./src/lib/seed-admin.js');
  app.listen(PORT, () => {
    console.log(`auth-service listening on port ${PORT}`);
    seedAdmin.ensureAdminSeeded().catch(err => console.error('[seed-admin]', err.message));
    seedAdmin.ensureGuestSeeded().catch(err => console.error('[seed-admin]', err.message));
    seedAdmin.ensureSecondaryAdminSeeded().catch(err => console.error('[seed-admin]', err.message));
  });
}

export default app;

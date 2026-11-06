import express from 'express';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import pool from './db.js';
import requireAuth from './src/lib/require-auth.js';
import securityHeaders from './src/lib/require-security-headers.js';
import { swaggerSpec } from './swagger.js';
import correlationId from './src/lib/correlation-id.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3304;

app.use(securityHeaders);
app.use(express.json());
app.use(cookieParser());

// AUTH-203 — health/readiness stays public by registration order: this
// route is mounted before requireAuth, everything below it is not.
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'telemetry-service', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'degraded', service: 'telemetry-service', db: 'disconnected' });
  }
});

app.use(correlationId);
app.get('/openapi.json', (_req, res) => res.json(swaggerSpec));

app.use(requireAuth);

if (existsSync(resolve(__dirname, 'src/routes/index.js'))) {
  const { default: routes } = await import('./src/routes/index.js');
  app.use('/', routes);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`telemetry-service listening on port ${PORT}`);
  });
}

export default app;

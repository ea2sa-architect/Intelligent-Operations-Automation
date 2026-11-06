import express from 'express';
import { fileURLToPath } from 'url';
import cookieParser from 'cookie-parser';
import securityHeaders from './src/lib/require-security-headers.js';
import pool from './db.js';
import analysisRouter             from './src/routes/analysis.js';
import workflowsRouter            from './src/routes/workflows.js';
import riskRouter                 from './src/routes/risk.js';
import trustRouter                 from './src/routes/trust.js';
import tagsRouter                 from './src/routes/tags.js';
import assuranceRouter            from './src/routes/assurance.js';
import platformConnectionsRouter  from './src/routes/platform-connections.js';
import lineageRouter              from './src/routes/lineage.js';
import anomalyRouter              from './src/routes/anomaly.js';
import attackPathsRouter          from './src/routes/attack-paths.js';
import correlationId              from './src/lib/correlation-id.js';
import { recoverOrphanedJobs, startReaper } from './src/lib/reaper.js';
import { startCollectors } from './src/lib/collectors/runner.js';
import { swaggerSpec } from './swagger.js';

const app  = express();
const PORT = process.env.PORT || 3305;

// verify callback captures raw body before JSON parsing so verify-n8n-signature
// can compute the HMAC against the original bytes (EP-310-S1).
app.use(securityHeaders);
app.use(express.json({ verify: (_req, _res, buf) => { _req.rawBody = buf; } }));
app.use(cookieParser());
app.use(correlationId);

app.get('/openapi.json', (_req, res) => res.json(swaggerSpec));

// analysisRouter must be mounted before workflowsRouter so that:
//   GET  /workflows/analysis/:job_id         → analysisRouter (not caught by /:id)
//   POST /workflows/analyze/callback/:job_id → analysisRouter (not caught by /:id)
// Express tries routers in registration order; first match wins.
app.use('/workflows', analysisRouter);
app.use('/workflows', workflowsRouter);
app.use('/risk',      riskRouter);
app.use('/trust',     trustRouter);
app.use('/tags',      tagsRouter);
app.use('/assurance', assuranceRouter);
app.use('/platforms', platformConnectionsRouter);
app.use('/lineage',       lineageRouter);
app.use('/anomaly',       anomalyRouter);
app.use('/attack-paths',  attackPathsRouter);

app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', service: 'workflow-governance-service', db: 'connected' });
  } catch {
    res.status(503).json({ status: 'degraded', service: 'workflow-governance-service', db: 'disconnected' });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, async () => {
    console.log(`workflow-governance-service listening on port ${PORT}`);
    await recoverOrphanedJobs();
    startReaper();
    startCollectors();
  });
}

export default app;

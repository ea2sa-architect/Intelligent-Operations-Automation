import express from 'express';
import swaggerUi from 'swagger-ui-express';
import securityHeaders from './src/lib/require-security-headers.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3399;

app.use(securityHeaders);

// Serve logo and banner script under /api/api-docs so the browser can fetch
// them through the same /api/* proxy path that nginx already forwards to Kong.
app.use('/api/api-docs', express.static(join(__dirname, 'public')));

const swaggerUiOptions = {
  explorer: true,
  customSiteTitle: 'Ea-2-Sa — IOA Governance API Hub',
  customJs: '/api/api-docs/banner.js',
  customCss: `
    .topbar {
      background: linear-gradient(135deg, #312e81 0%, #4338ca 100%);
      padding: 10px 24px;
      border-bottom: 2px solid #6366f1;
    }
    .topbar-wrapper img[alt="Swagger UI"] { display: none; }
    .topbar-wrapper .link { display: flex; align-items: center; text-decoration: none; }
    .swagger-ui .info .title { color: #3730a3; }
    .swagger-ui .opblock-tag { color: #4338ca; border-bottom-color: #e0e7ff; }
    .swagger-ui .opblock.opblock-post .opblock-summary-method { background: #4f46e5; }
    .swagger-ui .btn.authorize { border-color: #4f46e5; color: #4f46e5; }
    .swagger-ui .btn.authorize svg { fill: #4f46e5; }
    .swagger-ui section.models { border-color: #e0e7ff; }
    .swagger-ui section.models h4 { color: #4338ca; }
  `,
  swaggerOptions: {
    urls: [
      { url: '/api/governance/openapi.json',          name: 'Governance' },
      { url: '/api/inference/openapi.json',           name: 'AI Inference' },
      { url: '/api/audit/openapi.json',               name: 'Audit' },
      { url: '/api/escalation/openapi.json',          name: 'Escalation' },
      { url: '/api/telemetry/openapi.json',           name: 'Telemetry' },
      { url: '/api/workflow-governance/openapi.json', name: 'Workflow Governance' },
      { url: '/api/mcp-governance/openapi.json',      name: 'MCP Governance' },
      { url: '/api/auth/openapi.json',                name: 'Auth' },
    ],
    urls_primary_name: 'Governance',
  },
};

app.get('/health', (_req, res) => res.json({ status: 'ok', service: 'api-docs' }));

app.use('/api/api-docs', swaggerUi.serve, swaggerUi.setup(null, swaggerUiOptions));

app.get('/', (_req, res) => res.redirect('/api/api-docs'));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  app.listen(PORT, () => {
    console.log(`api-docs hub listening on port ${PORT}`);
    console.log(`  Local:   http://localhost:${PORT}/api/api-docs`);
  });
}
export default app;

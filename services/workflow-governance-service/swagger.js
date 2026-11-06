export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Workflow Governance Service API',
    version: '1.0.0',
    description: 'Workflow registry, risk scoring, trust policies, assurance evidence, and n8n/Make/Zapier platform connections',
  },
  servers: [
    { url: 'http://phoenix:3305', description: 'Direct' },
    { url: 'http://phoenix:8000/api/workflow-governance', description: 'Kong Gateway' },
  ],
  tags: [
    { name: 'Health', description: 'Service health' },
    { name: 'Workflows', description: 'Workflow registry and lifecycle' },
    { name: 'Analysis', description: 'AI-assisted workflow risk analysis' },
    { name: 'Risk', description: 'Risk scoring and exposure tracking' },
    { name: 'Trust', description: 'Trust policy management' },
    { name: 'Tags', description: 'Workflow tagging' },
    { name: 'Assurance', description: 'Assurance evidence' },
    { name: 'Platforms', description: 'External platform connections' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        responses: {
          200: { description: 'Service is healthy' },
          503: { description: 'Service degraded' },
        },
      },
    },
    '/workflows': {
      get: {
        tags: ['Workflows'],
        summary: 'List registered workflows',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          200: { description: 'Workflow list', content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkflowList' } } } },
        },
      },
      post: {
        tags: ['Workflows'],
        summary: 'Register a workflow',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkflowInput' } } },
        },
        responses: {
          201: { description: 'Workflow registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/Workflow' } } } },
        },
      },
    },
    '/workflows/summary': {
      get: {
        tags: ['Workflows'],
        summary: 'Aggregate workflow counts by status and risk',
        responses: {
          200: { description: 'Summary stats' },
        },
      },
    },
    '/workflows/by-domain': {
      get: {
        tags: ['Workflows'],
        summary: 'Group workflows by domain',
        responses: {
          200: { description: 'Workflows grouped by domain' },
        },
      },
    },
    '/workflows/discover': {
      post: {
        tags: ['Workflows'],
        summary: 'Auto-discover workflows from a connected platform',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { platform: { type: 'string' } } } } },
        },
        responses: {
          200: { description: 'Discovery results' },
        },
      },
    },
    '/workflows/import': {
      post: {
        tags: ['Workflows'],
        summary: 'Bulk import workflows',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { workflows: { type: 'array', items: { $ref: '#/components/schemas/WorkflowInput' } } } } } },
        },
        responses: {
          200: { description: 'Import result' },
        },
      },
    },
    '/workflows/{id}': {
      get: {
        tags: ['Workflows'],
        summary: 'Get a workflow',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Workflow', content: { 'application/json': { schema: { $ref: '#/components/schemas/Workflow' } } } },
          404: { description: 'Not found' },
        },
      },
      put: {
        tags: ['Workflows'],
        summary: 'Update a workflow',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/WorkflowInput' } } },
        },
        responses: {
          200: { description: 'Updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Workflow' } } } },
        },
      },
      delete: {
        tags: ['Workflows'],
        summary: 'Delete a workflow',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 204: { description: 'Deleted' } },
      },
    },
    '/workflows/{id}/analyze': {
      post: {
        tags: ['Analysis'],
        summary: 'Trigger AI risk analysis for a workflow',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          202: { description: 'Analysis job queued', content: { 'application/json': { schema: { $ref: '#/components/schemas/AnalysisJob' } } } },
        },
      },
    },
    '/workflows/{id}/analyses': {
      get: {
        tags: ['Analysis'],
        summary: 'List past analysis results for a workflow',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Analysis history' },
        },
      },
    },
    '/workflows/{id}/applied-policies': {
      get: {
        tags: ['Workflows'],
        summary: 'List governance policies applied to a workflow',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Applied policies' },
        },
      },
    },
    '/workflows/analysis/{job_id}': {
      get: {
        tags: ['Analysis'],
        summary: 'Poll the status of an analysis job',
        parameters: [{ name: 'job_id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Job status', content: { 'application/json': { schema: { $ref: '#/components/schemas/AnalysisJob' } } } },
          404: { description: 'Not found' },
        },
      },
    },
    '/workflows/analyze/callback/{job_id}': {
      post: {
        tags: ['Analysis'],
        summary: 'n8n callback endpoint for completed analysis jobs',
        parameters: [{ name: 'job_id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: {
          200: { description: 'Callback processed' },
        },
      },
    },
    '/risk': {
      get: {
        tags: ['Risk'],
        summary: 'List risk records',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          200: { description: 'Risk list' },
        },
      },
    },
    '/risk/secret-exposure/{id}/confirm-rotation': {
      patch: {
        tags: ['Risk'],
        summary: 'Confirm a secret exposure has been rotated',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Rotation confirmed' } },
      },
    },
    '/trust': {
      get: {
        tags: ['Trust'],
        summary: 'List trust policies',
        responses: { 200: { description: 'Trust policy list' } },
      },
      post: {
        tags: ['Trust'],
        summary: 'Create a trust policy',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { 201: { description: 'Policy created' } },
      },
    },
    '/tags': {
      get: {
        tags: ['Tags'],
        summary: 'List all tags',
        responses: { 200: { description: 'Tag list' } },
      },
      post: {
        tags: ['Tags'],
        summary: 'Create a tag',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { name: { type: 'string' } } } } },
        },
        responses: { 201: { description: 'Tag created' } },
      },
    },
    '/assurance': {
      get: {
        tags: ['Assurance'],
        summary: 'List assurance evidence',
        responses: { 200: { description: 'Evidence list' } },
      },
      post: {
        tags: ['Assurance'],
        summary: 'Submit assurance evidence',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        responses: { 201: { description: 'Evidence recorded' } },
      },
    },
    '/platforms/n8n': {
      get: {
        tags: ['Platforms'],
        summary: 'List n8n platform connections',
        responses: { 200: { description: 'n8n connections' } },
      },
    },
    '/platforms/make': {
      get: {
        tags: ['Platforms'],
        summary: 'List Make platform connections',
        responses: { 200: { description: 'Make connections' } },
      },
    },
    '/platforms/zapier': {
      get: {
        tags: ['Platforms'],
        summary: 'List Zapier platform connections',
        responses: { 200: { description: 'Zapier connections' } },
      },
    },
    '/platforms/camunda': {
      get: {
        tags: ['Platforms'],
        summary: 'List Camunda platform connections',
        responses: { 200: { description: 'Camunda connections' } },
      },
    },
  },
  components: {
    schemas: {
      Workflow: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          domain: { type: 'string' },
          platform: { type: 'string' },
          status: { type: 'string' },
          risk_score: { type: 'number', format: 'float', minimum: 0, maximum: 1 },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      WorkflowInput: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          domain: { type: 'string' },
          platform: { type: 'string' },
          description: { type: 'string' },
          metadata_json: { type: 'object' },
        },
      },
      WorkflowList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Workflow' } },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      AnalysisJob: {
        type: 'object',
        properties: {
          job_id: { type: 'string' },
          status: { type: 'string', enum: ['queued', 'running', 'completed', 'failed'] },
          result_json: { type: 'object', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
    },
  },
};

export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'AI Inference Service API',
    version: '1.0.0',
    description: 'Model registry, inference requests, and governance decisions',
  },
  servers: [
    { url: 'http://phoenix:3301', description: 'Direct' },
    { url: 'http://phoenix:8000/api/inference', description: 'Kong Gateway' },
  ],
  tags: [
    { name: 'Health', description: 'Service health' },
    { name: 'Models', description: 'AI model registry' },
    { name: 'Inference', description: 'Inference requests and decisions' },
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
    '/models': {
      get: {
        tags: ['Models'],
        summary: 'List models',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['inactive', 'active', 'deprecated'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          200: { description: 'Model list', content: { 'application/json': { schema: { $ref: '#/components/schemas/ModelList' } } } },
        },
      },
      post: {
        tags: ['Models'],
        summary: 'Register a model',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ModelInput' } } },
        },
        responses: {
          201: { description: 'Model registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/Model' } } } },
          400: { description: 'Validation error' },
          409: { description: 'Model name+version already exists' },
        },
      },
    },
    '/models/{id}': {
      get: {
        tags: ['Models'],
        summary: 'Get a model',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Model found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Model' } } } },
          404: { description: 'Not found' },
        },
      },
      put: {
        tags: ['Models'],
        summary: 'Update a model',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ModelInput' } } },
        },
        responses: {
          200: { description: 'Model updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Model' } } } },
          404: { description: 'Not found' },
        },
      },
    },
    '/inference': {
      get: {
        tags: ['Inference'],
        summary: 'List inference requests',
        parameters: [
          { name: 'model_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'completed', 'failed'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          200: { description: 'Inference request list', content: { 'application/json': { schema: { $ref: '#/components/schemas/InferenceList' } } } },
        },
      },
      post: {
        tags: ['Inference'],
        summary: 'Submit an inference request',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/InferenceInput' } } },
        },
        responses: {
          201: { description: 'Request created', content: { 'application/json': { schema: { $ref: '#/components/schemas/InferenceRequest' } } } },
          400: { description: 'Validation error' },
        },
      },
    },
    '/inference/{id}': {
      put: {
        tags: ['Inference'],
        summary: 'Update an inference request',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/InferenceUpdate' } } },
        },
        responses: {
          200: { description: 'Updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/InferenceRequest' } } } },
          404: { description: 'Not found' },
        },
      },
      get: {
        tags: ['Inference'],
        summary: 'Get an inference request with its decisions',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Request with decisions', content: { 'application/json': { schema: { $ref: '#/components/schemas/InferenceWithDecisions' } } } },
          404: { description: 'Not found' },
        },
      },
    },
    '/inference/{id}/decisions': {
      post: {
        tags: ['Inference'],
        summary: 'Record a governance decision',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/DecisionInput' } } },
        },
        responses: {
          201: { description: 'Decision recorded', content: { 'application/json': { schema: { $ref: '#/components/schemas/Decision' } } } },
          400: { description: 'Validation error' },
        },
      },
    },
  },
  components: {
    schemas: {
      Model: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          version: { type: 'string' },
          endpoint: { type: 'string', nullable: true },
          status: { type: 'string', enum: ['inactive', 'active', 'deprecated'] },
          metadata_json: { type: 'object', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      ModelInput: {
        type: 'object',
        required: ['name', 'version'],
        properties: {
          name: { type: 'string' },
          version: { type: 'string' },
          endpoint: { type: 'string' },
          status: { type: 'string', enum: ['inactive', 'active', 'deprecated'] },
          metadata_json: { type: 'object' },
        },
      },
      ModelList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Model' } },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      InferenceRequest: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          model_id: { type: 'string', format: 'uuid' },
          input_hash: { type: 'string' },
          output_json: { type: 'object', nullable: true },
          latency_ms: { type: 'integer', nullable: true },
          status: { type: 'string', enum: ['pending', 'completed', 'failed'] },
          error_message: { type: 'string', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      InferenceInput: {
        type: 'object',
        required: ['model_id', 'input_hash'],
        properties: {
          model_id: { type: 'string', format: 'uuid' },
          input_hash: { type: 'string' },
          output_json: { type: 'object' },
          latency_ms: { type: 'integer' },
          status: { type: 'string', enum: ['pending', 'completed', 'failed'] },
          error_message: { type: 'string' },
        },
      },
      Decision: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          inference_request_id: { type: 'string', format: 'uuid' },
          policy_id: { type: 'string', format: 'uuid', nullable: true },
          outcome: { type: 'string' },
          confidence: { type: 'number', format: 'float', minimum: 0, maximum: 1 },
          reasoning_json: { type: 'object', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      DecisionInput: {
        type: 'object',
        required: ['outcome'],
        properties: {
          policy_id: { type: 'string', format: 'uuid' },
          outcome: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reasoning_json: { type: 'object' },
        },
      },
      InferenceList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/InferenceRequest' } },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      InferenceUpdate: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['pending', 'completed', 'failed'] },
          output_json: { type: 'object' },
          latency_ms: { type: 'integer' },
          error_message: { type: 'string' },
        },
      },
      InferenceWithDecisions: {
        allOf: [
          { $ref: '#/components/schemas/InferenceRequest' },
          {
            type: 'object',
            properties: {
              decisions: { type: 'array', items: { $ref: '#/components/schemas/Decision' } },
            },
          },
        ],
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
    },
  },
};

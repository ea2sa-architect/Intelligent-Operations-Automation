export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Telemetry Service API',
    version: '1.0.0',
    description: 'Time-series metrics via TimescaleDB hypertable. Auto-compress at 7d, auto-drop at 90d.',
  },
  servers: [
    { url: 'http://phoenix:3304', description: 'Direct' },
    { url: 'http://phoenix:8000/api/telemetry', description: 'Kong Gateway' },
  ],
  tags: [
    { name: 'Health', description: 'Service health' },
    { name: 'Metrics', description: 'Metric ingestion and time-series query' },
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
    '/metrics': {
      post: {
        tags: ['Metrics'],
        summary: 'Ingest metrics (single or batch)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { $ref: '#/components/schemas/MetricInput' },
                  { type: 'array', items: { $ref: '#/components/schemas/MetricInput' }, minItems: 1, maxItems: 1000 },
                ],
              },
            },
          },
        },
        responses: {
          201: { description: 'Metrics ingested', content: { 'application/json': { schema: { $ref: '#/components/schemas/IngestResult' } } } },
          400: { description: 'Validation error' },
        },
      },
      get: {
        tags: ['Metrics'],
        summary: 'Query metrics time-series',
        parameters: [
          { name: 'service_name', in: 'query', schema: { type: 'string' } },
          { name: 'metric_name', in: 'query', schema: { type: 'string' } },
          { name: 'from', in: 'query', required: true, description: 'ISO 8601 start timestamp', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', description: 'ISO 8601 end timestamp (defaults to now)', schema: { type: 'string', format: 'date-time' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 500, maximum: 5000 } },
        ],
        responses: {
          200: { description: 'Metric data points', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetricList' } } } },
          400: { description: 'Missing required parameter: from' },
        },
      },
    },
  },
  components: {
    schemas: {
      MetricInput: {
        type: 'object',
        required: ['service_name', 'metric_name', 'value'],
        properties: {
          time: { type: 'string', format: 'date-time', description: 'Defaults to NOW() if omitted' },
          service_name: { type: 'string' },
          metric_name: { type: 'string' },
          value: { type: 'number' },
          labels_json: { type: 'object', default: {} },
        },
      },
      MetricPoint: {
        type: 'object',
        properties: {
          time: { type: 'string', format: 'date-time' },
          service_name: { type: 'string' },
          metric_name: { type: 'string' },
          value: { type: 'number' },
          labels_json: { type: 'object' },
        },
      },
      MetricList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/MetricPoint' } },
          count: { type: 'integer' },
        },
      },
      IngestResult: {
        type: 'object',
        properties: {
          inserted: { type: 'integer' },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
    },
  },
};

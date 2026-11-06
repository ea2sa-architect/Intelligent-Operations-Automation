export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Audit Service API',
    version: '1.0.0',
    description: 'Append-only compliance event log (range-partitioned by month)',
  },
  servers: [
    { url: 'http://phoenix:3302', description: 'Direct' },
    { url: 'http://phoenix:8000/api/audit', description: 'Kong Gateway' },
  ],
  tags: [
    { name: 'Health', description: 'Service health' },
    { name: 'Events', description: 'Audit event ingestion and query' },
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
    '/events': {
      get: {
        tags: ['Events'],
        summary: 'Query audit events',
        parameters: [
          { name: 'event_type', in: 'query', schema: { type: 'string' } },
          { name: 'actor_id', in: 'query', schema: { type: 'string' } },
          { name: 'actor_type', in: 'query', schema: { type: 'string' } },
          { name: 'resource_type', in: 'query', schema: { type: 'string' } },
          { name: 'resource_id', in: 'query', schema: { type: 'string' } },
          { name: 'outcome', in: 'query', schema: { type: 'string', enum: ['success', 'failure', 'partial'] } },
          { name: 'from', in: 'query', description: 'ISO 8601 start timestamp', schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', description: 'ISO 8601 end timestamp', schema: { type: 'string', format: 'date-time' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          200: { description: 'Events list', content: { 'application/json': { schema: { $ref: '#/components/schemas/EventList' } } } },
        },
      },
      post: {
        tags: ['Events'],
        summary: 'Append an audit event',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/EventInput' } } },
        },
        responses: {
          201: { description: 'Event recorded', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuditEvent' } } } },
          400: { description: 'Validation error' },
        },
      },
    },
  },
  components: {
    schemas: {
      AuditEvent: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          event_type: { type: 'string' },
          actor_id: { type: 'string' },
          actor_type: { type: 'string' },
          resource_type: { type: 'string' },
          resource_id: { type: 'string' },
          action: { type: 'string' },
          outcome: { type: 'string', enum: ['success', 'failure', 'partial'] },
          metadata_json: { type: 'object', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      EventInput: {
        type: 'object',
        required: ['event_type', 'actor_id', 'actor_type', 'resource_type', 'resource_id', 'action', 'outcome'],
        properties: {
          event_type: { type: 'string' },
          actor_id: { type: 'string' },
          actor_type: { type: 'string' },
          resource_type: { type: 'string' },
          resource_id: { type: 'string' },
          action: { type: 'string' },
          outcome: { type: 'string', enum: ['success', 'failure', 'partial'] },
          metadata_json: { type: 'object' },
        },
      },
      EventList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/AuditEvent' } },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
    },
  },
};

export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Escalation Service API',
    version: '1.0.0',
    description: 'Rules engine, incident lifecycle, and notification log',
  },
  servers: [
    { url: 'http://phoenix:3303', description: 'Direct' },
    { url: 'http://phoenix:8000/api/escalation', description: 'Kong Gateway' },
  ],
  tags: [
    { name: 'Health', description: 'Service health' },
    { name: 'Rules', description: 'Escalation rule management' },
    { name: 'Incidents', description: 'Incident lifecycle' },
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
    '/rules': {
      get: {
        tags: ['Rules'],
        summary: 'List escalation rules',
        parameters: [
          { name: 'enabled', in: 'query', schema: { type: 'boolean' } },
          { name: 'severity', in: 'query', schema: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          200: { description: 'Rules list', content: { 'application/json': { schema: { $ref: '#/components/schemas/RuleList' } } } },
        },
      },
      post: {
        tags: ['Rules'],
        summary: 'Create an escalation rule',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RuleInput' } } },
        },
        responses: {
          201: { description: 'Rule created', content: { 'application/json': { schema: { $ref: '#/components/schemas/EscalationRule' } } } },
          400: { description: 'Validation error' },
          409: { description: 'Rule name already exists' },
        },
      },
    },
    '/rules/{id}': {
      get: {
        tags: ['Rules'],
        summary: 'Get a rule',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Rule found', content: { 'application/json': { schema: { $ref: '#/components/schemas/EscalationRule' } } } },
          404: { description: 'Not found' },
        },
      },
      put: {
        tags: ['Rules'],
        summary: 'Update a rule',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RuleInput' } } },
        },
        responses: {
          200: { description: 'Rule updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/EscalationRule' } } } },
          404: { description: 'Not found' },
        },
      },
      delete: {
        tags: ['Rules'],
        summary: 'Delete a rule',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          204: { description: 'Deleted' },
          404: { description: 'Not found' },
        },
      },
    },
    '/incidents': {
      get: {
        tags: ['Incidents'],
        summary: 'List incidents',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['open', 'acknowledged', 'resolved', 'closed'] } },
          { name: 'severity', in: 'query', schema: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          200: { description: 'Incidents list', content: { 'application/json': { schema: { $ref: '#/components/schemas/IncidentList' } } } },
        },
      },
      post: {
        tags: ['Incidents'],
        summary: 'Create an incident',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/IncidentInput' } } },
        },
        responses: {
          201: { description: 'Incident created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Incident' } } } },
          400: { description: 'Validation error' },
        },
      },
    },
    '/incidents/{id}': {
      get: {
        tags: ['Incidents'],
        summary: 'Get an incident',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Incident found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Incident' } } } },
          404: { description: 'Not found' },
        },
      },
      put: {
        tags: ['Incidents'],
        summary: 'Update incident status',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/IncidentUpdate' } } },
        },
        responses: {
          200: { description: 'Incident updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Incident' } } } },
          404: { description: 'Not found' },
        },
      },
    },
  },
  components: {
    schemas: {
      EscalationRule: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          condition_json: { type: 'object' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          channels_json: { type: 'array', items: { type: 'object' } },
          enabled: { type: 'boolean' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      RuleInput: {
        type: 'object',
        required: ['name', 'condition_json', 'severity'],
        properties: {
          name: { type: 'string' },
          condition_json: { type: 'object' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          channels_json: { type: 'array', items: { type: 'object' } },
          enabled: { type: 'boolean', default: true },
        },
      },
      RuleList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/EscalationRule' } },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      Incident: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          rule_id: { type: 'string', format: 'uuid', nullable: true },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          status: { type: 'string', enum: ['open', 'acknowledged', 'resolved', 'closed'] },
          context_json: { type: 'object', nullable: true },
          triggered_at: { type: 'string', format: 'date-time' },
          acknowledged_at: { type: 'string', format: 'date-time', nullable: true },
          resolved_at: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      IncidentInput: {
        type: 'object',
        required: ['title', 'severity'],
        properties: {
          rule_id: { type: 'string', format: 'uuid' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          context_json: { type: 'object' },
        },
      },
      IncidentUpdate: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['open', 'acknowledged', 'resolved', 'closed'] },
          context_json: { type: 'object' },
        },
      },
      IncidentList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Incident' } },
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

export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'MCP Governance Service API',
    version: '1.0.0',
    description: 'Server registry, tool approval, redaction policies, and assurance evidence for MCP infrastructure',
  },
  servers: [
    { url: 'http://phoenix:3306', description: 'Direct' },
    { url: 'http://phoenix:8000/api/mcp-governance', description: 'Kong Gateway' },
  ],
  tags: [
    { name: 'Health', description: 'Service health' },
    { name: 'Servers', description: 'MCP server registry' },
    { name: 'Clients', description: 'MCP client registry' },
    { name: 'Tools', description: 'Tool approval and invocation events' },
    { name: 'Redaction', description: 'Redaction pattern management' },
    { name: 'Assurance', description: 'Assurance evidence per server' },
    { name: 'Telemetry', description: 'MCP invocation metrics' },
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
    '/servers': {
      get: {
        tags: ['Servers'],
        summary: 'List MCP servers',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['pending', 'approved', 'suspended'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          200: { description: 'Server list', content: { 'application/json': { schema: { $ref: '#/components/schemas/McpServerList' } } } },
        },
      },
      post: {
        tags: ['Servers'],
        summary: 'Register an MCP server',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/McpServerInput' } } },
        },
        responses: {
          201: { description: 'Server registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/McpServer' } } } },
          409: { description: 'Server already exists' },
        },
      },
    },
    '/servers/{id}': {
      get: {
        tags: ['Servers'],
        summary: 'Get an MCP server',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Server found', content: { 'application/json': { schema: { $ref: '#/components/schemas/McpServer' } } } },
          404: { description: 'Not found' },
        },
      },
      put: {
        tags: ['Servers'],
        summary: 'Update an MCP server',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/McpServerInput' } } },
        },
        responses: {
          200: { description: 'Updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/McpServer' } } } },
          404: { description: 'Not found' },
        },
      },
      delete: {
        tags: ['Servers'],
        summary: 'Delete an MCP server',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          204: { description: 'Deleted' },
          404: { description: 'Not found' },
        },
      },
    },
    '/servers/{serverId}/tools': {
      get: {
        tags: ['Tools'],
        summary: 'List tools registered under a server',
        parameters: [{ name: 'serverId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Tool list', content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolList' } } } },
        },
      },
      post: {
        tags: ['Tools'],
        summary: 'Register a tool under a server',
        parameters: [{ name: 'serverId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ToolInput' } } },
        },
        responses: {
          201: { description: 'Tool registered', content: { 'application/json': { schema: { $ref: '#/components/schemas/Tool' } } } },
        },
      },
    },
    '/servers/{serverId}/assurance-evidence': {
      get: {
        tags: ['Assurance'],
        summary: 'List assurance evidence for a server',
        parameters: [{ name: 'serverId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Evidence list', content: { 'application/json': { schema: { $ref: '#/components/schemas/AssuranceList' } } } },
        },
      },
      post: {
        tags: ['Assurance'],
        summary: 'Submit assurance evidence for a server',
        parameters: [{ name: 'serverId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/AssuranceInput' } } },
        },
        responses: {
          201: { description: 'Evidence recorded' },
        },
      },
    },
    '/tools/{id}/approval': {
      patch: {
        tags: ['Tools'],
        summary: 'Approve or reject a tool',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApprovalInput' } } },
        },
        responses: {
          200: { description: 'Approval decision recorded' },
          404: { description: 'Not found' },
        },
      },
    },
    '/tools/{id}/decision-history': {
      get: {
        tags: ['Tools'],
        summary: 'Get approval decision history for a tool',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Decision history' },
        },
      },
    },
    '/tools/{id}/invocation-event': {
      post: {
        tags: ['Tools'],
        summary: 'Record a tool invocation event',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/InvocationEvent' } } },
        },
        responses: {
          201: { description: 'Event recorded' },
        },
      },
    },
    '/clients': {
      get: {
        tags: ['Clients'],
        summary: 'List MCP clients',
        responses: {
          200: { description: 'Client list' },
        },
      },
      post: {
        tags: ['Clients'],
        summary: 'Register an MCP client',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ClientInput' } } },
        },
        responses: {
          201: { description: 'Client registered' },
        },
      },
    },
    '/clients/{id}': {
      get: {
        tags: ['Clients'],
        summary: 'Get an MCP client',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Client found' },
          404: { description: 'Not found' },
        },
      },
      delete: {
        tags: ['Clients'],
        summary: 'Delete an MCP client',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          204: { description: 'Deleted' },
        },
      },
    },
    '/clients/{id}/servers/{serverId}': {
      put: {
        tags: ['Clients'],
        summary: 'Associate a server with a client',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'serverId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { 200: { description: 'Associated' } },
      },
      delete: {
        tags: ['Clients'],
        summary: 'Remove a server association from a client',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'serverId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { 204: { description: 'Removed' } },
      },
    },
    '/redaction-patterns': {
      get: {
        tags: ['Redaction'],
        summary: 'List redaction patterns',
        responses: {
          200: { description: 'Pattern list' },
        },
      },
      post: {
        tags: ['Redaction'],
        summary: 'Create a redaction pattern',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RedactionPatternInput' } } },
        },
        responses: {
          201: { description: 'Pattern created' },
        },
      },
    },
    '/redaction-patterns/{id}': {
      patch: {
        tags: ['Redaction'],
        summary: 'Update a redaction pattern',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RedactionPatternInput' } } },
        },
        responses: { 200: { description: 'Updated' } },
      },
      delete: {
        tags: ['Redaction'],
        summary: 'Delete a redaction pattern',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 204: { description: 'Deleted' } },
      },
    },
    '/telemetry/mcp-invocations': {
      get: {
        tags: ['Telemetry'],
        summary: 'Query MCP invocation metrics',
        parameters: [
          { name: 'server_id', in: 'query', schema: { type: 'string', format: 'uuid' } },
          { name: 'from', in: 'query', required: true, schema: { type: 'string', format: 'date-time' } },
          { name: 'to', in: 'query', schema: { type: 'string', format: 'date-time' } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 500 } },
        ],
        responses: {
          200: { description: 'Invocation metrics' },
        },
      },
    },
    '/assurance-evidence/{id}/status': {
      patch: {
        tags: ['Assurance'],
        summary: 'Update the status of an assurance evidence record',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' } } } } },
        },
        responses: { 200: { description: 'Status updated' } },
      },
    },
    '/credential-exposure/{id}/confirm-rotation': {
      patch: {
        tags: ['Servers'],
        summary: 'Confirm that a credential exposure has been rotated',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: { description: 'Rotation confirmed' } },
      },
    },
  },
  components: {
    schemas: {
      McpServer: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          url: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'approved', 'suspended'] },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      McpServerInput: {
        type: 'object',
        required: ['name', 'url'],
        properties: {
          name: { type: 'string' },
          url: { type: 'string' },
          description: { type: 'string' },
          metadata_json: { type: 'object' },
        },
      },
      McpServerList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/McpServer' } },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      Tool: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          server_id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          approval_status: { type: 'string', enum: ['pending', 'approved', 'rejected'] },
        },
      },
      ToolInput: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          input_schema_json: { type: 'object' },
        },
      },
      ToolList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Tool' } },
        },
      },
      ApprovalInput: {
        type: 'object',
        required: ['decision'],
        properties: {
          decision: { type: 'string', enum: ['approved', 'rejected'] },
          reason: { type: 'string' },
        },
      },
      InvocationEvent: {
        type: 'object',
        required: ['invoked_at'],
        properties: {
          invoked_at: { type: 'string', format: 'date-time' },
          latency_ms: { type: 'integer' },
          success: { type: 'boolean' },
          error_message: { type: 'string' },
        },
      },
      ClientInput: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
      },
      RedactionPatternInput: {
        type: 'object',
        required: ['pattern'],
        properties: {
          pattern: { type: 'string' },
          description: { type: 'string' },
          enabled: { type: 'boolean', default: true },
        },
      },
      AssuranceInput: {
        type: 'object',
        required: ['evidence_type'],
        properties: {
          evidence_type: { type: 'string' },
          evidence_json: { type: 'object' },
        },
      },
      AssuranceList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { type: 'object' } },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
    },
  },
};

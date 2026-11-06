export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Governance Service API',
    version: '1.0.0',
    description: 'Policy definitions, rules, bindings, and version history',
  },
  servers: [
    { url: 'http://phoenix:3300', description: 'Direct' },
    { url: 'http://phoenix:8000/api/governance', description: 'Kong Gateway' },
  ],
  tags: [
    { name: 'Health', description: 'Service health' },
    { name: 'Policies', description: 'Policy lifecycle management' },
    { name: 'Rules', description: 'Policy rule management' },
    { name: 'Bindings', description: 'Policy-entity bindings' },
    { name: 'Policy Bundles', description: 'Export, validate and import policies as portable JSON (policy-as-code)' },
  ],
  paths: {
    '/health': {
      get: {
        tags: ['Health'],
        summary: 'Health check',
        responses: {
          200: { description: 'Service is healthy' },
          503: { description: 'Service degraded (DB unreachable)' },
        },
      },
    },
    '/policies': {
      get: {
        tags: ['Policies'],
        summary: 'List policies',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'active', 'inactive', 'archived'] } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: {
          200: {
            description: 'List of policies',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/PolicyList' } } },
          },
        },
      },
      post: {
        tags: ['Policies'],
        summary: 'Create a policy',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/PolicyInput' } } },
        },
        responses: {
          201: { description: 'Policy created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Policy' } } } },
          400: { description: 'Validation error' },
          409: { description: 'Policy name already exists' },
        },
      },
    },
    '/policies/{id}': {
      get: {
        tags: ['Policies'],
        summary: 'Get a policy',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Policy found', content: { 'application/json': { schema: { $ref: '#/components/schemas/Policy' } } } },
          404: { description: 'Not found' },
        },
      },
      put: {
        tags: ['Policies'],
        summary: 'Update a policy',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/PolicyInput' } } },
        },
        responses: {
          200: { description: 'Policy updated', content: { 'application/json': { schema: { $ref: '#/components/schemas/Policy' } } } },
          404: { description: 'Not found' },
        },
      },
      delete: {
        tags: ['Policies'],
        summary: 'Delete a policy',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          204: { description: 'Deleted' },
          404: { description: 'Not found' },
        },
      },
    },
    '/policies/{id}/rules': {
      get: {
        tags: ['Rules'],
        summary: 'List rules for a policy',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Rules list', content: { 'application/json': { schema: { $ref: '#/components/schemas/RuleList' } } } },
        },
      },
      post: {
        tags: ['Rules'],
        summary: 'Add a rule to a policy',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/RuleInput' } } },
        },
        responses: {
          201: { description: 'Rule created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Rule' } } } },
          400: { description: 'Validation error' },
        },
      },
    },
    '/policies/{id}/rules/{ruleId}': {
      delete: {
        tags: ['Rules'],
        summary: 'Delete a rule',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'ruleId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          204: { description: 'Deleted' },
          404: { description: 'Not found' },
        },
      },
    },
    '/policies/{id}/bindings': {
      get: {
        tags: ['Bindings'],
        summary: 'List bindings for a policy',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: {
          200: { description: 'Bindings list', content: { 'application/json': { schema: { $ref: '#/components/schemas/BindingList' } } } },
        },
      },
      post: {
        tags: ['Bindings'],
        summary: 'Bind a policy to an entity',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/BindingInput' } } },
        },
        responses: {
          201: { description: 'Binding created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Binding' } } } },
          400: { description: 'Validation error' },
          409: { description: 'Binding already exists' },
        },
      },
    },
    '/policies/{id}/bindings/{bindingId}': {
      delete: {
        tags: ['Bindings'],
        summary: 'Delete a binding',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
          { name: 'bindingId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          204: { description: 'Deleted' },
          404: { description: 'Not found' },
        },
      },
    },
    '/policy-bundles/export': {
      get: {
        tags: ['Policy Bundles'],
        summary: 'Export policies as a bundle',
        description: 'Returns an ioa.policy-bundle/v1 JSON document (deterministic, Git-friendly) as an attachment. Requires policy:read. Policies holding legacy condition_json rules are refused with 422 unless skip_legacy=true, because a bundle cannot represent them.',
        parameters: [
          { name: 'ids', in: 'query', schema: { type: 'string' }, description: 'Comma-separated policy ids (max 100); default all' },
          { name: 'status', in: 'query', schema: { type: 'string', enum: ['draft', 'active', 'inactive', 'archived'] } },
          { name: 'skip_legacy', in: 'query', schema: { type: 'string', enum: ['true'] } },
        ],
        responses: {
          200: { description: 'Policy bundle', content: { 'application/json': { schema: { $ref: '#/components/schemas/PolicyBundle' } } } },
          400: { description: 'Invalid ids or status' },
          404: { description: 'No policies match' },
          422: { description: 'Selected policies contain legacy rules a bundle cannot represent' },
        },
      },
    },
    '/policy-bundles/validate': {
      post: {
        tags: ['Policy Bundles'],
        summary: 'Dry-run an import',
        description: 'Validates a bundle and returns the plan (create / replace / conflict per policy), errors and warnings. Writes nothing. Requires policy:read.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PolicyBundleImportRequest' } } } },
        responses: {
          200: { description: 'Validation result (valid=false is reported in the body)', content: { 'application/json': { schema: { $ref: '#/components/schemas/PolicyBundleValidation' } } } },
          400: { description: 'Invalid on_conflict' },
        },
      },
    },
    '/policy-bundles/import': {
      post: {
        tags: ['Policy Bundles'],
        summary: 'Import a bundle',
        description: 'Re-validates server-side, then applies every policy in one transaction. Imported policies always land as status=draft, enforcement_mode=observe regardless of requested_mode; activating is a separate step. A name collision is rejected unless on_conflict is "replace", which additionally requires policy:edit and resets that policy to Draft / Observe. Requires policy:import.',
        requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/PolicyBundleImportRequest' } } } },
        responses: {
          201: { description: 'Imported' },
          403: { description: 'Missing policy:import (or policy:edit for replace)' },
          409: { description: 'A policy or rule with the same name appeared during the import, or a replaced rule has violations attached; nothing was imported' },
          422: { description: 'Validation failed; nothing was imported', content: { 'application/json': { schema: { $ref: '#/components/schemas/PolicyBundleValidation' } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      Policy: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['draft', 'active', 'inactive', 'archived'] },
          version: { type: 'integer' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
      },
      PolicyInput: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          status: { type: 'string', enum: ['draft', 'active', 'inactive', 'archived'] },
        },
      },
      PolicyList: {
        type: 'object',
        properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/Policy' } },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      Rule: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          policy_id: { type: 'string', format: 'uuid' },
          condition_json: { type: 'object' },
          action: { type: 'string' },
          priority: { type: 'integer' },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      RuleInput: {
        type: 'object',
        required: ['condition_json', 'action'],
        properties: {
          condition_json: { type: 'object' },
          action: { type: 'string' },
          priority: { type: 'integer', default: 0 },
        },
      },
      RuleList: {
        type: 'object',
        properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Rule' } } },
      },
      Binding: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          policy_id: { type: 'string', format: 'uuid' },
          entity_type: { type: 'string' },
          entity_id: { type: 'string' },
          effective_from: { type: 'string', format: 'date-time' },
          effective_to: { type: 'string', format: 'date-time', nullable: true },
          created_at: { type: 'string', format: 'date-time' },
        },
      },
      BindingInput: {
        type: 'object',
        required: ['entity_type', 'entity_id'],
        properties: {
          entity_type: { type: 'string' },
          entity_id: { type: 'string' },
          effective_from: { type: 'string', format: 'date-time' },
          effective_to: { type: 'string', format: 'date-time' },
        },
      },
      BindingList: {
        type: 'object',
        properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Binding' } } },
      },
      PolicyBundle: {
        type: 'object',
        required: ['schema', 'policies'],
        properties: {
          schema: { type: 'string', enum: ['ioa.policy-bundle/v1'] },
          exported_at: { type: 'string', format: 'date-time' },
          policies: { type: 'array', items: { $ref: '#/components/schemas/BundlePolicy' } },
        },
      },
      BundlePolicy: {
        type: 'object',
        required: ['name', 'requested_mode', 'rules', 'bindings'],
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
          bundle_version: { type: 'string', description: 'Free-text label; the integer policy version is server-managed' },
          requested_mode: { type: 'string', enum: ['observe', 'warn', 'enforce'], description: 'What the author wants. Never applied on import: imports are always Observe.' },
          rules: {
            type: 'array',
            items: {
              type: 'object',
              required: ['name', 'rule_type'],
              properties: {
                name: { type: 'string' },
                rule_type: { type: 'string', description: 'A type from GET /rule-schemas' },
                severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
                enabled: { type: 'boolean' },
                priority: { type: 'integer' },
                config: { type: 'object', description: 'Validated against the rule type schema' },
              },
            },
          },
          bindings: {
            type: 'array',
            items: {
              type: 'object',
              required: ['entity_type', 'entity_id'],
              properties: {
                entity_type: { type: 'string', enum: ['workflow', 'mcp_server', 'ai_model', 'zap'] },
                entity_id: { type: 'string', description: 'Environment-specific id; must exist in this environment' },
              },
            },
          },
        },
      },
      PolicyBundleImportRequest: {
        type: 'object',
        required: ['bundle'],
        properties: {
          bundle: { $ref: '#/components/schemas/PolicyBundle' },
          on_conflict: { type: 'string', enum: ['reject', 'replace'], default: 'reject' },
        },
      },
      PolicyBundleValidation: {
        type: 'object',
        properties: {
          valid: { type: 'boolean' },
          errors: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, message: { type: 'string' } } } },
          warnings: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, message: { type: 'string' } } } },
          plan: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                action: { type: 'string', enum: ['create', 'replace', 'conflict'] },
                requested_mode: { type: 'string' },
                effective_mode: { type: 'string', enum: ['observe'] },
                rules: { type: 'integer' },
                bindings: { type: 'integer' },
                unevaluated_rule_types: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
    },
  },
};

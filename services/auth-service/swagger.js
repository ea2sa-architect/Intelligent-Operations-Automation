export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Auth Service API',
    version: '1.0.0',
    description: 'JWT-based authentication — login, logout, and session introspection',
  },
  servers: [
    { url: 'http://phoenix:3307', description: 'Direct' },
    { url: 'http://phoenix:8000/api/auth', description: 'Kong Gateway' },
  ],
  tags: [
    { name: 'Health', description: 'Service health' },
    { name: 'Session', description: 'Authentication and session management' },
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
    '/login': {
      post: {
        tags: ['Session'],
        summary: 'Authenticate and receive a JWT session cookie',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/LoginInput' },
            },
          },
        },
        responses: {
          200: {
            description: 'Authenticated — sets HttpOnly session cookie',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginResult' } } },
          },
          401: { description: 'Invalid credentials' },
        },
      },
    },
    '/logout': {
      post: {
        tags: ['Session'],
        summary: 'Clear the session cookie',
        responses: {
          200: { description: 'Logged out' },
        },
      },
    },
    '/me': {
      get: {
        tags: ['Session'],
        summary: 'Return the currently authenticated user',
        security: [{ cookieAuth: [] }],
        responses: {
          200: {
            description: 'Current user',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
          },
          401: { description: 'Not authenticated' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'session',
      },
    },
    schemas: {
      LoginInput: {
        type: 'object',
        required: ['username', 'password'],
        properties: {
          username: { type: 'string' },
          password: { type: 'string', format: 'password' },
        },
      },
      LoginResult: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          user: { $ref: '#/components/schemas/User' },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          username: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'guest'] },
        },
      },
      Error: {
        type: 'object',
        properties: { error: { type: 'string' } },
      },
    },
  },
};

import { Router } from 'express';
import authRouter from './auth.js';
import usersRouter from './users.js';
import apiKeysRouter from './api-keys.js';
import agentsRouter, { delegationsRouter } from './agents.js';

const router = Router();

// Mounted at root, not '/auth' — Kong's auth-service-route already has
// strip_path: true on paths: ['/api/auth'], so a browser request to
// /api/auth/login arrives here as just /login. Every other IOA service
// follows this same convention (mount at the resource path, not the
// service name) — this file originally didn't, which only broke through
// Kong (direct-port testing during development never goes through Kong's
// path-stripping, so it never caught this).
router.use('/', authRouter);
router.use('/users', usersRouter);
router.use('/api-keys', apiKeysRouter);
router.use('/agents', agentsRouter);
router.use('/delegations', delegationsRouter);

export default router;

import { Router } from 'express';
import serversRouter   from './servers.js';
import clientsRouter   from './clients.js';
import toolsRouter     from './tools.js';
import resourcesRouter from './resources.js';
import promptsRouter   from './prompts.js';
import redactionPatternsRouter from './redaction-patterns.js';
import telemetryRouter from './telemetry.js';
import assuranceRouter from './assurance.js';
import credentialExposureRouter from './credential-exposure.js';
import promptRegistryRouter from './prompt-registry.js';

const router = Router();

// serversRouter is mounted first at /servers, but only handles single-segment
// paths under that prefix (/, /:id, /:id/status). Multi-segment paths like
// /servers/:serverId/tools fall through it untouched and are matched by
// tools/resources/promptsRouter (mounted at root, full paths of their own) —
// same fallthrough-by-specificity pattern workflow-governance-service uses
// for analysisRouter vs workflowsRouter.
router.use('/servers', serversRouter);
router.use('/clients', clientsRouter);
router.use('/', toolsRouter);
router.use('/', resourcesRouter);
router.use('/', promptsRouter);
router.use('/', redactionPatternsRouter);
router.use('/', telemetryRouter);
router.use('/', assuranceRouter);
router.use('/', credentialExposureRouter);
router.use('/', promptRegistryRouter);

export default router;

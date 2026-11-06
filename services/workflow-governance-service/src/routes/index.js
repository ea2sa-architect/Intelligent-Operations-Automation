import { Router } from 'express';
import workflows from './workflows.js';
import risk from './risk.js';

const router = Router();
router.use('/workflows', workflows);
router.use('/risk', risk);

export default router;

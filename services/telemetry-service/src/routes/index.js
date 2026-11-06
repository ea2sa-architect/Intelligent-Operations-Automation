import { Router } from 'express';
import metrics from './metrics.js';

const router = Router();

router.use('/metrics', metrics);

export default router;

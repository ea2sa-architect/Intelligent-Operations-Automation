import { Router } from 'express';
import models from './models.js';
import inference from './inference.js';
import budgets from './budgets.js';

const router = Router();

router.use('/models', models);
router.use('/inference', inference);
router.use('/budgets', budgets);

export default router;

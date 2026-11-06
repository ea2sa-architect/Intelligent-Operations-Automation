import { Router } from 'express';
import rules from './rules.js';
import incidents from './incidents.js';

const router = Router();

router.use('/rules', rules);
router.use('/incidents', incidents);

export default router;

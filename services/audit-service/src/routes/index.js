import { Router } from 'express';
import events from './events.js';

const router = Router();

router.use('/events', events);

export default router;

import { Router } from 'express';
import policies    from './policies.js';
import ruleSchemas from './rule-schemas.js';
import violations  from './violations.js';
import approvalDecisions from './approval-decisions.js';
import enforcement from './enforcement.js';
import approvalChains from './approval-chains.js';
import containment from './containment.js';
import controlTests from './control-tests.js';
import policyBindings from './policy-bindings.js';
import releaseDecisions from './release-decisions.js';
import policyBundles from './policy-bundles.js';

const router = Router();

// Specific paths first — prevents /:id wildcards in policies from swallowing them
router.use('/rule-schemas',   ruleSchemas);
router.use('/violations',     violations);
router.use('/approval-decisions', approvalDecisions);
router.use('/approval-chains', approvalChains);
router.use('/enforce',        enforcement);
router.use('/assets',         containment);
router.use('/control-tests',  controlTests);
router.use('/policy-bindings', policyBindings);
router.use('/release-decisions', releaseDecisions);
router.use('/policy-bundles', policyBundles);
router.use('/policies',       policies);

export default router;

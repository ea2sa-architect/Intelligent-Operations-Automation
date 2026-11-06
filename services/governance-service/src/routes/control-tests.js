import { Router } from 'express';
import pool from '../../db.js';

const router = Router();
const wrap = fn => (req, res) => fn(req, res).catch(err => res.status(500).json({ error: err.message }));

// GET /control-tests — list all tests with last result summary
router.get('/', wrap(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT
       ct.*,
       (SELECT COUNT(*)::int FROM governance.control_test_runs r WHERE r.test_id = ct.id)           AS total_runs,
       (SELECT COUNT(*)::int FROM governance.control_test_runs r WHERE r.test_id = ct.id AND r.result = 'pass') AS pass_count,
       (SELECT COUNT(*)::int FROM governance.control_test_runs r WHERE r.test_id = ct.id AND r.result = 'fail') AS fail_count
     FROM governance.control_tests ct
     ORDER BY ct.name`
  );
  res.json(rows);
}));

// GET /control-tests/:id/runs — run history for one test, latest first
router.get('/:id/runs', wrap(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT * FROM governance.control_test_runs
      WHERE test_id = $1
      ORDER BY ran_at DESC
      LIMIT 50`,
    [req.params.id]
  );
  res.json(rows);
}));

export default router;

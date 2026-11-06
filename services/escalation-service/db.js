import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('connect', client => {
  client.query('SET search_path TO escalation, public');
});

export default pool;

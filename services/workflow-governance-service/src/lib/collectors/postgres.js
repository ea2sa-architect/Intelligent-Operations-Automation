export async function collect(pool) {
  try {
    await pool.query('SELECT 1');
    const { rows: [row] } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM public.migrations`
    );
    return {
      evidence_type:    'database_health',
      status:           'verified',
      confidence_level: 'system_collected',
      collected_by:     'collector:postgres',
      evidence: {
        connected:       true,
        migration_count: row.count,
      },
    };
  } catch (err) {
    return {
      evidence_type:    'database_health',
      status:           'failed',
      confidence_level: 'system_collected',
      collected_by:     'collector:postgres',
      evidence:         { error: err.message },
    };
  }
}

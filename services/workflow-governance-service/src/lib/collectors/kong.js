const KONG_ADMIN_URL = process.env.KONG_ADMIN_URL || 'http://kong-gateway:8001';

export async function collect() {
  try {
    const [statusRes, servicesRes] = await Promise.all([
      fetch(`${KONG_ADMIN_URL}/status`),
      fetch(`${KONG_ADMIN_URL}/services?size=100`),
    ]);
    if (!statusRes.ok) throw new Error(`Kong Admin returned ${statusRes.status}`);
    const [status, services] = await Promise.all([statusRes.json(), servicesRes.json()]);
    return {
      evidence_type:    'api_gateway_health',
      status:           'verified',
      confidence_level: 'system_collected',
      collected_by:     'collector:kong',
      evidence: {
        database_reachable: status.database?.reachable ?? true,
        service_count:      services.data?.length ?? 0,
        version:            status.version,
        node_id:            status.server?.node_id,
      },
    };
  } catch (err) {
    return {
      evidence_type:    'api_gateway_health',
      status:           'failed',
      confidence_level: 'system_collected',
      collected_by:     'collector:kong',
      evidence:         { error: err.message },
    };
  }
}

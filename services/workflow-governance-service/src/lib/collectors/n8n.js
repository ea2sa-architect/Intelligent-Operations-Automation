import n8nClient from '../n8n-client.js';

export async function collect() {
  try {
    const workflows = await n8nClient.listWorkflows();
    const active = workflows.filter(w => w.active);
    return {
      evidence_type:    'n8n_platform_health',
      status:           workflows.length > 0 ? 'verified' : 'stale',
      confidence_level: 'system_collected',
      collected_by:     'collector:n8n',
      evidence: {
        total_workflows:  workflows.length,
        active_workflows: active.length,
      },
    };
  } catch (err) {
    return {
      evidence_type:    'n8n_platform_health',
      status:           'failed',
      confidence_level: 'system_collected',
      collected_by:     'collector:n8n',
      evidence:         { error: err.message },
    };
  }
}

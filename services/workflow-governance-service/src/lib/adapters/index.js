// Adapter factory — returns the correct platform adapter by name.
// Each adapter implements: testConnection(config), listWorkflows(config),
// getWorkflow(config, sourceId), normalizeNodes(raw), detectFlowLevelRisks(raw)

import n8nAdapter           from './n8n.js';
import makeAdapter          from './make.js';
import zapierAdapter        from './zapier.js';
import powerAutomateAdapter from './power-automate.js';
import camundaAdapter       from './camunda.js';

const ADAPTERS = {
  n8n:             n8nAdapter,
  make:            makeAdapter,
  zapier:          zapierAdapter,
  power_automate:  powerAutomateAdapter,
  camunda:         camundaAdapter,
};

export function getAdapter(platform) {
  const adapter = ADAPTERS[platform];
  if (!adapter) throw new Error(`No adapter registered for platform: ${platform}`);
  return adapter;
}

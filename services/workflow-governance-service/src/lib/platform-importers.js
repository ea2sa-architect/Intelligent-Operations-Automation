// Registry of connected-platform import steps for POST /workflows/import
// (make/zapier/camunda — n8n keeps its own branch in workflows.js since its
// upsert target, ownership/violations/telemetry inputs, and MCP-reference
// resolution have no equivalent here).
//
// Each entry only knows how to fetch + normalize that platform's raw
// workflow object into a common shape: { name, active, projectId,
// projectName, metadata, flowRisks }. Persistence (scoring, upsert,
// nodes/pii/secret-exposure rows, history, cache invalidation) is shared in
// the route — adding a platform here (e.g. power_automate, which already
// has an adapter under lib/adapters/) means one more entry in this object,
// not another copied ~90-line branch in the route.
import makeExtractor    from './make-extractor.js';
import zapierExtractor  from './zapier-extractor.js';
import camundaExtractor from './camunda-extractor.js';

export const importers = {
  make: {
    connectionLabel: 'Make.com connection',
    notFound: sourceId => `Scenario ${sourceId} not found in Make.com`,
    persistSecretExposure: true,
    async normalize(adapter, config, sourceId) {
      const scenario = await adapter.getWorkflow(config, sourceId);
      if (!scenario) return null;
      return {
        name:        scenario.name,
        active:      scenario.isActive ?? false,
        projectId:   scenario.folderId ? String(scenario.folderId) : null,
        projectName: scenario.folderName ?? null,
        metadata:    makeExtractor.extract(scenario),
        // Original make branch never called detectFlowLevelRisks — preserved as-is.
        flowRisks:   [],
      };
    },
  },

  zapier: {
    connectionLabel: 'Zapier connection',
    notFound: sourceId => `Zap ${sourceId} not found in Zapier`,
    persistSecretExposure: false,
    async normalize(adapter, config, sourceId) {
      const zap = await adapter.getWorkflow(config, sourceId);
      if (!zap) return null;
      return {
        name:        zap.title ?? `Zap ${sourceId}`,
        active:      zap.status === 'on',
        projectId:   null,
        projectName: null,
        metadata:    zapierExtractor.extract(zap),
        flowRisks:   adapter.detectFlowLevelRisks(zap),
      };
    },
  },

  camunda: {
    connectionLabel: 'Camunda connection',
    notFound: sourceId => `Process definition ${sourceId} not found in Camunda`,
    persistSecretExposure: false,
    async normalize(adapter, config, sourceId) {
      const process = await adapter.getWorkflow(config, sourceId);
      if (!process) return null;
      return {
        name:        process.name,
        active:      process.active ?? true,
        projectId:   null,
        projectName: process.tenantId ?? null,
        metadata:    camundaExtractor.extract(process),
        flowRisks:   adapter.detectFlowLevelRisks(process),
      };
    },
  },
};

export function getImporter(platform) {
  return importers[platform] ?? null;
}

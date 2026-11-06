// Pure — summarizes a resolved workflow's already-computed exposure data
// (pii_exposure, secret_exposure, per-node risk_factors — all produced at
// import time by metadata-extractor.js, not re-derived here) into the
// shape `ioa threat-model`'s reachability report needs.
export function summarizeExposure(workflow) {
  const pii = workflow.pii_exposure ?? [];
  const secrets = workflow.secret_exposure ?? [];
  const riskyNodes = (workflow.nodes ?? []).filter(n => (n.risk_factors ?? []).length > 0);

  return {
    pii_types: [...new Set(pii.map(p => p.pii_type))],
    unmasked_pii_count: pii.filter(p => !p.masked && !p.encrypted).length,
    unrotated_secrets_count: secrets.filter(s => !s.rotation_confirmed_at).length,
    nodes_with_risk_factors: riskyNodes.map(n => ({ node_name: n.node_name, risk_factors: n.risk_factors })),
  };
}

// Automation Trust Index (ATI) — executive-facing composite score.
// Deliberately separate from risk-scorer.js: risk_score stays a pure engineering
// metric, ATI blends it with governance/assurance/operational trust signals.
//
// All four score inputs are raw *risk*-direction dimension scores (higher =
// worse) — the same direction as risk_score itself. This is the one place
// that inverts each into a trust-direction value; callers must NOT pre-invert.
//
// Inputs that haven't been wired up yet (governance posture before the
// governance_posture dimension exists, assurance before assurance evidence is
// tracked, operational visibility before execution telemetry is ingested)
// default to a neutral 50 and are flagged `provisional` — callers just start
// passing real values as those signals come online; no logic here changes.

const WEIGHTS = { risk: 0.30, governance: 0.25, assurance: 0.25, operational: 0.20 };

function invert(score) {
  return 100 - Math.min(100, Math.max(0, score ?? 50));
}

function determineAtiLevel(score) {
  if (score < 40) return 'LOW';
  if (score < 65) return 'MODERATE';
  if (score < 85) return 'HIGH';
  return 'VERIFIED';
}

function computeTrustIndex({
  riskScore,
  governancePostureScore,
  recoverabilityRiskScore,
  operationalRiskScore,
  criticality,
  mcpCeilings = [],
} = {}) {
  const inputs = {
    risk: {
      value: invert(riskScore),
      provisional: riskScore == null,
    },
    governance: {
      value: invert(governancePostureScore ?? 50),
      provisional: governancePostureScore == null,
    },
    assurance: {
      value: invert(recoverabilityRiskScore ?? 50),
      provisional: recoverabilityRiskScore == null,
    },
    operational: {
      value: invert(operationalRiskScore ?? 50),
      provisional: operationalRiskScore == null,
    },
  };

  const rawAti = Object.entries(WEIGHTS).reduce((sum, [dim, weight]) => sum + weight * inputs[dim].value, 0);

  // Every ceiling condition — mission-critical assurance/governance gaps, and
  // (Epic 5, Feature 5.2) MCP-specific conditions passed in by the caller —
  // is collected here and the lowest cap wins. Workflows with no MCP
  // references pass an empty mcpCeilings array, so this is a strict
  // superset of the pre-Feature-5.2 behavior: nothing changes for them.
  const ceilings = [...mcpCeilings];
  if (criticality === 'mission_critical' && (inputs.assurance.provisional || inputs.governance.provisional)) {
    ceilings.push({ cap: 70, reason: 'Mission-critical workflow with unverified assurance/governance signal' });
  }

  // Only ceilings that actually constrain the raw score are reported as
  // "applied" — this is what the reviewer-facing rationale (WBS Feature 5.2)
  // displays, so a ceiling that wouldn't have changed anything isn't listed.
  const applicableCeilings = ceilings.filter(c => c.cap < rawAti);
  const ati = applicableCeilings.length > 0
    ? Math.min(rawAti, ...applicableCeilings.map(c => c.cap))
    : rawAti;

  const provisional = Object.values(inputs).some(i => i.provisional);

  return {
    ati_score: Math.round(ati * 100) / 100,
    ati_level: determineAtiLevel(ati),
    inputs,
    provisional,
    ceilings_applied: applicableCeilings.map(c => ({ cap: c.cap, reason: c.reason })),
  };
}

export default { computeTrustIndex, WEIGHTS };

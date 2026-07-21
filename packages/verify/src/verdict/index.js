// Verdict taxonomy + aggregation (spec §5.1, §5.2). Mirrors the persona
// programme's PASS/BROKEN/DEGRADED/COSMETIC, plus the structural verdicts
// NOT-DEPLOYED (§4 refusal), BLOCKED (§6 unprovisionable), and LAUNCH-FAILURE
// (the verifier agent could not run or its output could not be ingested — a
// refusal to issue a verdict on the app, never a soft pass; see engine catch).
//
// Split verdicts are held split, NEVER averaged (§5.1): a run is BROKEN if
// ANY finding is BROKEN, regardless of how many ACs passed.

import { rcfError } from '@stravica-ai/rcf-lite-core/errors';

/** Finding severities, low → high. */
export const FINDING_SEVERITIES = Object.freeze(['PASS', 'COSMETIC', 'DEGRADED', 'BROKEN']);

/** Severity rank for the split-not-averaged max and the severity gate. */
export const SEVERITY_ORDER = Object.freeze({ PASS: 0, COSMETIC: 1, DEGRADED: 2, BROKEN: 3 });

/** All overall-verdict classes (findings severities + the three structural verdicts). */
export const VERDICTS = Object.freeze([...FINDING_SEVERITIES, 'NOT-DEPLOYED', 'BLOCKED', 'LAUNCH-FAILURE']);

/**
 * Required fields on every finding (spec §5.2): the RCF payoff is that every
 * defect maps to a contract line (acId / chain node), never a free-floating
 * bug.
 *
 * @param {object} finding
 * @returns {import('@stravica-ai/rcf-lite-core/errors').RcfError | null} error as data, or null if valid
 */
export function validateFinding(finding) {
  if (!finding || typeof finding !== 'object') {
    return rcfError({ kind: 'validation', message: 'finding must be an object' });
  }
  if (!FINDING_SEVERITIES.includes(finding.severity)) {
    return rcfError({ kind: 'validation', message: `finding.severity must be one of ${FINDING_SEVERITIES.join('/')}`, field: 'severity' });
  }
  if (typeof finding.acId !== 'string' || finding.acId.length === 0) {
    return rcfError({ kind: 'validation', message: 'finding.acId (chain-node reference) is required', field: 'acId' });
  }
  if (typeof finding.journey !== 'string' || finding.journey.length === 0) {
    return rcfError({ kind: 'validation', message: 'finding.journey is required', field: 'journey' });
  }
  if (!Array.isArray(finding.reproSteps)) {
    return rcfError({ kind: 'validation', message: 'finding.reproSteps must be an array', field: 'reproSteps' });
  }
  if (!finding.evidence || typeof finding.evidence !== 'object') {
    return rcfError({ kind: 'validation', message: 'finding.evidence must be an object', field: 'evidence' });
  }
  return null;
}

/**
 * The worst (max) severity across findings. Empty → PASS. This is the
 * split-not-averaged rule: the single worst finding drives the class.
 *
 * @param {Array<{severity: string}>} findings
 * @returns {'PASS'|'COSMETIC'|'DEGRADED'|'BROKEN'}
 */
export function aggregateSeverity(findings = []) {
  let worst = 'PASS';
  for (const f of findings) {
    if ((SEVERITY_ORDER[f.severity] ?? -1) > SEVERITY_ORDER[worst]) worst = f.severity;
  }
  return worst;
}

/**
 * The overall run verdict (spec §5.1). NOT-DEPLOYED and a fully-blocked run
 * are structural verdicts; otherwise the worst finding severity wins
 * (split-not-averaged). A run with SOME findings and SOME blocked ACs is a
 * partial verification: the verdict reflects what WAS exercised, and the
 * blocked ACs are named separately in the report.
 *
 * @param {object} opts
 * @param {Array<{severity: string}>} [opts.findings]
 * @param {Array<object>} [opts.blockedAcs]
 * @param {boolean} [opts.notDeployed]
 * @returns {string}
 */
export function aggregateVerdict({ findings = [], blockedAcs = [], notDeployed = false } = {}) {
  if (notDeployed) return 'NOT-DEPLOYED';
  if (findings.length === 0 && blockedAcs.length > 0) return 'BLOCKED';
  return aggregateSeverity(findings);
}

/**
 * Whether the severity gate is tripped → the process exits non-zero
 * (spec §3 rule 5, §8.2). NOT-DEPLOYED, BLOCKED and LAUNCH-FAILURE always trip
 * (ship cannot be confirmed); otherwise the worst finding severity is compared
 * against the gate. With no gate configured, nothing trips — the report is
 * still written.
 *
 * @param {object} opts
 * @param {string} opts.verdict
 * @param {Array<{severity: string}>} [opts.findings]
 * @param {string|null} [opts.gate] - one of FINDING_SEVERITIES, or null/undefined
 * @returns {boolean}
 */
export function gateTripped({ verdict, findings = [], gate }) {
  if (verdict === 'NOT-DEPLOYED' || verdict === 'BLOCKED' || verdict === 'LAUNCH-FAILURE') return true;
  if (!gate) return false;
  const worst = aggregateSeverity(findings);
  return SEVERITY_ORDER[worst] >= SEVERITY_ORDER[gate];
}

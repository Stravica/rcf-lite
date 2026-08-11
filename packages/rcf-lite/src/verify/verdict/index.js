// Verdict taxonomy + aggregation (spec §5.1, §5.2). Mirrors the persona
// programme's PASS/BROKEN/DEGRADED/COSMETIC, plus the structural verdicts
// NOT-DEPLOYED (§4 refusal), BLOCKED (§6 unprovisionable), and LAUNCH-FAILURE
// (the verifier agent could not run or its output could not be ingested — a
// refusal to issue a verdict on the app, never a soft pass; see engine catch).
//
// Split verdicts are held split, NEVER averaged (§5.1): a run is BROKEN if
// ANY finding is BROKEN, regardless of how many ACs passed.
//
// 0.7.0 additions:
//   - MOCK-ONLY-DECLARED (verification-integrity-cluster-spec §5.2): an AC
//     whose aggregated service attestation resolves to `mocked` for at
//     least one service. Verify has no live path to make it real-hit; the
//     verdict is the honest alternative to a false PASS.
//   - BLOCKED-BY-DECLARATION (verification-integrity-cluster-spec §5.2):
//     an AC whose aggregated service attestation contains `declaredMockOnly`
//     for at least one service. The operator declared mock-only at pre-flight;
//     verify refuses to issue a live verdict and the chain records the
//     decision.
//   - UI-BASELINE-UNMET (ui-design-gate §8.7): a UI-bearing AC whose
//     browser-verification record for a bound FBS came back `block`.
//   - BROWSER-VERIFICATION-MISSING (ui-design-gate §8.7): a UI-bearing AC
//     bound to an FBS with no browserVerification[] entry on the manifest.
//
// The four new classes are PER-AC verdicts emitted on the report's
// `perAcVerdicts[]` array. They do NOT replace the top-level `verdict`
// (which stays BROKEN/DEGRADED/… by finding severity + provisioning
// blocked); they run alongside so a finalise-gate consumer can refuse
// `verified` on an AC-level basis even when the run's aggregate is PASS.

import { rcfError } from '#core/errors';

/** Finding severities, low → high. */
export const FINDING_SEVERITIES = Object.freeze(['PASS', 'COSMETIC', 'DEGRADED', 'BROKEN']);

/** Severity rank for the split-not-averaged max and the severity gate. */
export const SEVERITY_ORDER = Object.freeze({ PASS: 0, COSMETIC: 1, DEGRADED: 2, BROKEN: 3 });

/**
 * All overall-verdict classes: findings severities + the three structural
 * verdicts. The 0.7.0 per-AC verdict classes are NOT in this set — they
 * ride on `perAcVerdicts[]`, not the run-level `verdict` field. Keeping
 * them out preserves backward compatibility on `validateReportShape`
 * (§5.3) for existing consumers that only knew the pre-0.7.0 classes.
 */
export const VERDICTS = Object.freeze([...FINDING_SEVERITIES, 'NOT-DEPLOYED', 'BLOCKED', 'LAUNCH-FAILURE']);

/**
 * Per-AC verdict classes emitted alongside the top-level verdict on
 * `report.perAcVerdicts[]`. Consumed by `rcf finalise` to refuse promotion
 * to `verified` on any of these AC-level verdicts (see
 * `packages/build/src/finalise/ingest.js:findMockOnlyDeclaredAcs`).
 */
export const PER_AC_VERDICTS = Object.freeze([
  'MOCK-ONLY-DECLARED',
  'BLOCKED-BY-DECLARATION',
  'UI-BASELINE-UNMET',
  'BROWSER-VERIFICATION-MISSING',
]);

/**
 * Required fields on every finding (spec §5.2): the RCF payoff is that every
 * defect maps to a contract line (acId / chain node), never a free-floating
 * bug.
 *
 * @param {object} finding
 * @returns {import('#core/errors').RcfError | null} error as data, or null if valid
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

/**
 * Resolve the Track A per-AC verdict from an AC's aggregated service
 * attestations. Priority: `declaredMockOnly` wins over `mocked`, because
 * a chain that explicitly declared mock-only overrides an implicit mock.
 * `live` / `sandboxed` / `notShipped` never emit a per-AC verdict here —
 * they either mean a live path exists (verify's normal findings pipeline
 * handles them) or the AC does not gate ship at all.
 *
 * @param {Array<{serviceId: string, attestationMode: string}>} attestations
 * @returns {{ verdict: 'MOCK-ONLY-DECLARED'|'BLOCKED-BY-DECLARATION', reason: string } | null}
 */
export function attestationPerAcVerdict(attestations = []) {
  if (!Array.isArray(attestations) || attestations.length === 0) return null;
  const declared = attestations.find((a) => a && a.attestationMode === 'declaredMockOnly');
  if (declared) {
    return {
      verdict: 'BLOCKED-BY-DECLARATION',
      reason: `operator declared mock-only at pre-flight for service ${declared.serviceId}; verify refused to issue a live verdict rather than fabricate a PASS.`,
    };
  }
  const mocked = attestations.find((a) => a && a.attestationMode === 'mocked');
  if (mocked) {
    return {
      verdict: 'MOCK-ONLY-DECLARED',
      reason: `service ${mocked.serviceId} is chain-attested \`mocked\`; verify has no live path to the third party and no observable delivery record on the running app.`,
    };
  }
  return null;
}

/**
 * Resolve the Track B per-AC UI verdict for an AC. UI verdicts fire only
 * for `fbsUiBearing: true` ACs (the chain-derived flag from
 * `packages/verify/src/chain/index.js`). Priority:
 *   1. Any bound FBS has NO browserVerification entry → BROWSER-VERIFICATION-MISSING.
 *   2. Any bound FBS's browserVerification.verdict is `block` → UI-BASELINE-UNMET.
 *   3. Otherwise no per-AC UI verdict is emitted.
 *
 * @param {object} ac - a flattened AC with `fbsUiBearing` and `fbsIds`
 * @param {object[]} [browserVerification] - manifest.browserVerification[]
 * @returns {{ verdict: 'UI-BASELINE-UNMET'|'BROWSER-VERIFICATION-MISSING', reason: string } | null}
 */
export function uiPerAcVerdict(ac, browserVerification = []) {
  if (!ac || ac.fbsUiBearing !== true) return null;
  const fbsIds = Array.isArray(ac.fbsIds) ? ac.fbsIds : [];
  if (fbsIds.length === 0) return null;
  const bv = Array.isArray(browserVerification) ? browserVerification : [];
  const missing = [];
  const blocked = [];
  for (const fbsId of fbsIds) {
    const records = bv.filter((r) => r && r.fbsId === fbsId);
    if (records.length === 0) {
      missing.push(fbsId);
      continue;
    }
    // Take the freshest record — records land per-run and the latest verdict
    // is the one that gates ship. `createdAt` sorts lexicographically for ISO
    // timestamps; when it is missing fall back to array order (the last
    // written entry wins).
    const latest = [...records].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')).pop();
    if (latest && latest.verdict === 'block') blocked.push({ fbsId, id: latest.id ?? null });
  }
  if (missing.length > 0) {
    return {
      verdict: 'BROWSER-VERIFICATION-MISSING',
      reason: `UI-bearing FBS(es) ${missing.join(', ')} have no browserVerification record on the manifest; verify has nothing to read for the baseline check.`,
    };
  }
  if (blocked.length > 0) {
    const detail = blocked.map((b) => `${b.fbsId}${b.id ? ` (${b.id})` : ''}`).join(', ');
    return {
      verdict: 'UI-BASELINE-UNMET',
      reason: `browserVerification recorded verdict \`block\` for ${detail}; the deployed UI failed at least one baseline invariant.`,
    };
  }
  return null;
}

/**
 * Emit per-AC verdicts across the whole chain. Combines Track A's service
 * attestation verdicts with Track B's UI-baseline verdicts. An AC can carry
 * BOTH a service-attestation verdict AND a UI verdict (a UI-bearing FBS
 * that also depends on a mocked service produces two per-AC entries — one
 * per class). This matches the finalise gate contract in
 * `packages/build/src/finalise/ingest.js:findMockOnlyDeclaredAcs`, which
 * filters on verdict class and does not deduplicate by acId.
 *
 * @param {object} opts
 * @param {Array<object>} opts.acs - flattened ACs from `readChain`
 * @param {object[]} [opts.browserVerification] - manifest.browserVerification[]
 * @returns {Array<{ acId: string, verdict: string, reason: string }>}
 */
export function derivePerAcVerdicts({ acs = [], browserVerification = [] } = {}) {
  const out = [];
  for (const ac of acs) {
    const attest = attestationPerAcVerdict(ac.serviceAttestations);
    if (attest) out.push({ acId: ac.acId, verdict: attest.verdict, reason: attest.reason });
    const ui = uiPerAcVerdict(ac, browserVerification);
    if (ui) out.push({ acId: ac.acId, verdict: ui.verdict, reason: ui.reason });
  }
  return out;
}

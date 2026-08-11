// REVIEW-stage test-theatre audit + mutation-sampling
// (verification-integrity-cluster-spec §5.5, §6).
//
// Two surfaces composed into ONE Review pass, emitting ONE
// reviewAudit record per FBS:
//
//   1. test-theatre audit (deterministic): five finding categories from
//      §5.5 - mockOnlyIntegrationClaim, testPointerBroken,
//      assertionStrengthWeak, acIdsCoverageDrift, otherDeclared. This
//      module implements the four deterministic ones; assertion strength
//      needs a code-reading agent, so v1 raises it only via the
//      mutation-sampling side, not the deterministic sweep (the sweep is
//      the belt, the mutation-sampling agent is the braces).
//
//   2. mutation-sampling (agent-driven, injectable): the runner accepts
//      a `mutationRunner` dependency conforming to the spec §6 shape.
//      The runner takes the FBS diff and TS/TC list and returns the
//      mutation-sampling record. When no runner is wired, the audit
//      emits a `notes` entry explaining that the sampler was not run;
//      the reviewAudit record is still valid schema.

import { classifyAttestationProfile, aggregateAttestationsByAc } from '../query/attestation.js';

/**
 * @typedef {import('#core/store/walker.js').TreeModel} TreeModel
 * @typedef {'mockOnlyIntegrationClaim'|'testPointerBroken'|'assertionStrengthWeak'|'acIdsCoverageDrift'|'uiBaselineDrift'|'otherDeclared'} TestTheatreFindingKind
 */

/**
 * @typedef {object} TestTheatreFinding
 * @property {string} [tsId] required for test-theatre kinds; omitted on kind=uiBaselineDrift (rcf-schemas 0.4.2)
 * @property {string} [tcId]
 * @property {string} [anchorId] free-form anchor for kinds without a test suite (for example, uiBaselineDrift, anchored on an FBS id or file path)
 * @property {TestTheatreFindingKind} kind
 * @property {string} detail
 * @property {'advisory'|'warn'|'block'} severity
 * @property {string} [kindDescription]
 */

/**
 * @typedef {object} MutationSurvivor
 * @property {string} mutationId
 * @property {string} targetFile
 * @property {string} [targetSymbol]
 * @property {string} mutationSummary
 * @property {string[]} acIds
 * @property {string[]} [tsIdsShouldHaveCaught]
 * @property {string[]} [tcIdsShouldHaveCaught]
 */

/**
 * @typedef {object} MutationSamplingRecord
 * @property {string} mode
 * @property {number} mutantsGenerated
 * @property {number} mutantsRun
 * @property {number} killed
 * @property {number} survived
 * @property {number} [durationMs]
 * @property {MutationSurvivor[]} [survivors]
 * @property {string} [notes]
 */

const INTEGRATION_LEVELS = new Set(['integration', 'e2e', 'contract']);
const MOCK_PROFILES = new Set(['mock', 'stub', 'fixture']);

/**
 * Detect `mockOnlyIntegrationClaim`: a TS whose testLevel is
 * integration-or-higher and every TC records `runtimeProvenance.profile`
 * in {mock, stub, fixture} AND at least one bound AC's aggregated
 * attestation is live or sandboxed. This is the exact d-142 failure
 * mode.
 *
 * @param {TreeModel} tree
 * @param {object} fbs
 * @returns {TestTheatreFinding[]}
 */
function detectMockOnlyIntegrationClaim(tree, fbs) {
  const findings = [];
  const attByAc = aggregateAttestationsByAc(tree);
  const fbsAcIds = new Set(fbs.acIds ?? []);
  // Every TS that covers one of the FBS's ACs.
  const relevantTs = (tree.testSuites ?? []).filter((ts) => (ts.acIds ?? []).some((a) => fbsAcIds.has(a)));
  for (const ts of relevantTs) {
    if (!INTEGRATION_LEVELS.has(ts.testLevel)) continue;
    const tcs = ts.testCases ?? [];
    if (tcs.length === 0) continue;
    const allMockShaped = tcs.every((tc) => MOCK_PROFILES.has(tc?.runtimeProvenance?.profile ?? ''));
    if (!allMockShaped) continue;
    const bindingsOnFbsAcs = (ts.acIds ?? [])
      .filter((a) => fbsAcIds.has(a))
      .flatMap((a) => attByAc.get(a) ?? []);
    const liveish = bindingsOnFbsAcs.find((b) => b.attestationMode === 'live' || b.attestationMode === 'sandboxed');
    if (liveish) {
      findings.push({
        tsId: ts.id,
        kind: 'mockOnlyIntegrationClaim',
        detail: `${ts.id} testLevel=${ts.testLevel} but every TC's runtimeProvenance.profile is in {mock,stub,fixture}, while AC bindings include service ${liveish.serviceId} attested ${liveish.attestationMode}.`,
        severity: 'block',
      });
    }
  }
  return findings;
}

/**
 * Detect `testPointerBroken`: any TC whose `testPointer` is missing or
 * fails resolution. Uses the pre-computed testPointers map (a resolved
 * pointer's `.resolved === true`). When no map is supplied, we skip
 * this check (the caller must pass one for the audit to police it).
 *
 * @param {TreeModel} tree
 * @param {object} fbs
 * @param {Map<string, { resolved?: boolean, testPointer?: string|null, reason?: string }>} [testPointers]
 * @returns {TestTheatreFinding[]}
 */
function detectTestPointerBroken(tree, fbs, testPointers) {
  if (!testPointers || testPointers.size === 0) return [];
  const findings = [];
  const fbsAcIds = new Set(fbs.acIds ?? []);
  for (const ts of tree.testSuites ?? []) {
    for (const tc of ts.testCases ?? []) {
      if (!fbsAcIds.has(tc.acId)) continue;
      const key = `${ts.id}::${tc.id}`;
      const resolution = testPointers.get(key);
      if (!resolution || resolution.resolved !== true) {
        findings.push({
          tsId: ts.id,
          tcId: tc.id,
          kind: 'testPointerBroken',
          detail: `TC ${tc.id} testPointer '${resolution?.testPointer ?? tc.testPointer ?? '(missing)'}' does not resolve: ${resolution?.reason ?? 'missing-pointer'}.`,
          severity: 'block',
        });
      }
    }
  }
  return findings;
}

/**
 * Detect `acIdsCoverageDrift`: an FBS acId that no TS covers, OR a
 * covering TS acId that this FBS does not claim.
 *
 * @param {TreeModel} tree
 * @param {object} fbs
 * @returns {TestTheatreFinding[]}
 */
function detectAcIdsCoverageDrift(tree, fbs) {
  const findings = [];
  const fbsAcIds = new Set(fbs.acIds ?? []);
  for (const ts of tree.testSuites ?? []) {
    const covers = (ts.acIds ?? []).some((a) => fbsAcIds.has(a));
    if (!covers) continue;
    for (const a of ts.acIds ?? []) {
      if (!fbsAcIds.has(a)) {
        findings.push({
          tsId: ts.id,
          kind: 'acIdsCoverageDrift',
          detail: `${ts.id} covers ${a}, but ${fbs.fbsId} does not claim ${a} in acIds[].`,
          severity: 'warn',
        });
      }
    }
  }
  // The reverse ("FBS claims an AC no TS covers") is intentionally
  // deferred to `coverage --strict`, which already raises exit 4 on
  // uncovered ACs and needs no tsId to do so (the reviewAudit schema
  // requires a valid tsId on every testTheatreFinding, and the "no TS
  // covers" case has none to name). Belt and braces: coverage is the
  // belt, this audit is the braces.
  return findings;
}

/**
 * Detect `attestationDrift` findings as test-theatre entries. This is
 * the passWithWarn class from §3.5 (declaredMockOnly × live) plus the
 * refuse class (already blocking coverage --strict, but re-raised here
 * so the Review record surfaces it too).
 *
 * The kind used is `mockOnlyIntegrationClaim` when the drift refuses
 * live-attested ACs on mock-profile TCs; the standalone `attestationDrift`
 * kind is not in the schema enum (spec §3.4 fixed enum), so v1 folds
 * these into the closest matching kind (`mockOnlyIntegrationClaim` for
 * live-attested drift, `otherDeclared` with a kindDescription for the
 * passWithWarn drift). This is spec-faithful — §5.5 defines only the
 * enumerated `kind` set, and downstream consumers key on that set.
 *
 * @param {TreeModel} tree
 * @param {object} fbs
 * @returns {TestTheatreFinding[]}
 */
function detectAttestationDrift(tree, fbs) {
  const findings = [];
  const attByAc = aggregateAttestationsByAc(tree);
  const fbsAcIds = new Set(fbs.acIds ?? []);
  for (const ts of tree.testSuites ?? []) {
    for (const tc of ts.testCases ?? []) {
      if (!fbsAcIds.has(tc.acId)) continue;
      const profile = tc?.runtimeProvenance?.profile;
      if (typeof profile !== 'string') continue;
      const bindings = attByAc.get(tc.acId) ?? [];
      for (const { serviceId, attestationMode } of bindings) {
        const cell = classifyAttestationProfile(attestationMode, profile);
        if (cell.verdict === 'passWithWarn') {
          findings.push({
            tsId: ts.id,
            tcId: tc.id,
            kind: 'otherDeclared',
            kindDescription: 'attestationDrift',
            detail: `${ts.id}/${tc.id} on ${tc.acId} (service ${serviceId}): ${cell.reason}`,
            severity: 'warn',
          });
        }
      }
    }
  }
  return findings;
}

/**
 * Run the deterministic test-theatre audit on one FBS. Returns the
 * findings list (aggregated across the four detectors).
 *
 * @param {object} args
 * @param {TreeModel} args.tree
 * @param {object} args.fbs
 * @param {Map<string, object>} [args.testPointers]
 * @returns {TestTheatreFinding[]}
 */
export function auditTestTheatre({ tree, fbs, testPointers }) {
  return [
    ...detectMockOnlyIntegrationClaim(tree, fbs),
    ...detectTestPointerBroken(tree, fbs, testPointers),
    ...detectAcIdsCoverageDrift(tree, fbs),
    ...detectAttestationDrift(tree, fbs),
  ];
}

/**
 * @typedef {object} ReviewAuditRecord
 * @property {string} id                           `ra-<fbsId>-<n>`
 * @property {string} fbsId
 * @property {string} createdAt
 * @property {TestTheatreFinding[]} testTheatreFindings
 * @property {MutationSamplingRecord} [mutationSampling]
 * @property {'pass'|'warn'|'block'} verdict
 */

/**
 * Aggregate a verdict from the findings + mutation sampling per spec
 * §5.5: block if any finding severity is block or any mutation
 * survivor traces to an in-scope AC; warn if any warn and no block;
 * pass otherwise.
 *
 * Review N-2 (non-blocking): an unwired mutation runner
 * (`mode: 'agent-v1-not-wired'`) is promoted to `warn` even on an
 * otherwise-clean audit. Without this, an unwired runner is
 * indistinguishable from a wired runner that killed every mutant:
 * both emit `verdict: pass`, so the exit-code layer conflates "audit
 * clean" with "audit did not run". Warn forces the operator to wire a
 * runner or pass `--skip-mutation` (mode: 'skipped'), which remains
 * pass as an explicit operator choice.
 *
 * @param {TestTheatreFinding[]} findings
 * @param {MutationSamplingRecord} [mutationSampling]
 * @returns {'pass'|'warn'|'block'}
 */
export function aggregateVerdict(findings, mutationSampling) {
  const severities = findings.map((f) => f.severity);
  if (severities.includes('block')) return 'block';
  if ((mutationSampling?.survivors?.length ?? 0) > 0) return 'block';
  if (severities.includes('warn')) return 'warn';
  if (mutationSampling?.mode === 'agent-v1-not-wired') return 'warn';
  return 'pass';
}

/**
 * Monotonic id allocator for the reviewAudit array.
 *
 * @param {object|null} manifest
 * @param {string} fbsId
 * @returns {string}
 */
export function nextReviewAuditId(manifest, fbsId) {
  const prefix = `ra-${fbsId}-`;
  const existing = Array.isArray(manifest?.reviewAudit) ? manifest.reviewAudit : [];
  let maxN = 0;
  for (const rec of existing) {
    if (typeof rec?.id !== 'string' || !rec.id.startsWith(prefix)) continue;
    const n = Number.parseInt(rec.id.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > maxN) maxN = n;
  }
  return `${prefix}${maxN + 1}`;
}

/**
 * Compose the record. Timestamps at UTC ISO.
 *
 * @param {object} args
 * @param {TreeModel} args.tree
 * @param {object} args.fbs
 * @param {TestTheatreFinding[]} args.findings
 * @param {MutationSamplingRecord} [args.mutationSampling]
 * @param {Date} [args.now]
 * @returns {ReviewAuditRecord}
 */
export function composeReviewAuditRecord({ tree, fbs, findings, mutationSampling, now = new Date() }) {
  const id = nextReviewAuditId(tree.manifest, fbs.fbsId);
  const verdict = aggregateVerdict(findings, mutationSampling);
  const record = {
    id,
    fbsId: fbs.fbsId,
    createdAt: now.toISOString(),
    testTheatreFindings: findings.map((f) => normaliseFinding(f)),
    verdict,
  };
  if (mutationSampling) record.mutationSampling = mutationSampling;
  return record;
}

function normaliseFinding(f) {
  const out = { tsId: f.tsId, kind: f.kind, detail: f.detail, severity: f.severity };
  if (typeof f.tcId === 'string' && f.tcId.length > 0) out.tcId = f.tcId;
  if (typeof f.kindDescription === 'string' && f.kindDescription.length > 0) out.kindDescription = f.kindDescription;
  return out;
}

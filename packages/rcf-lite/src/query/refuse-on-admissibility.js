// Traceability / query tool refuse-first wrapper (NV-BL-SR-03
// addendum on ruling-sheet item 1, ratified 2026-08-11).
//
// The ruleset's `toolScope` block declares:
//   { chainAdmissibility: true, traceabilityAndQueryTools: true }
//
// meaning the same refusal semantics that gate `rcf build` also gate
// the traceability and query tools. A tool that hides an admissibility
// failure is the same class of defect as a build that hides one.
//
// This module wraps a query result so a REFUSE verdict from
// `enforceAdmissibility` short-circuits the tool's output. Callers
// pass the walker tree and the chain's declared ruleset version; on
// REFUSE the wrapper returns a refusal envelope naming the unresolved
// findings. On PASS or PASS-WITH-OVERRIDES the query's own result flows
// through unchanged.
//
// 0.30.0 PR 9 (REQ-179 enforcement locus, spec section 17): the wrap
// also cites the three DEFINE-stage NV-DL rules the review found
// enforced only by the gates themselves (ADM-02 for D4 stories floor,
// ADM-03 for D3 shapes bite, ADM-04 for the `rcf define validate`
// finding set). Callers pass the computed readiness result (or the
// stage envelopes they already carry) and the validate-errors array;
// the wrap evaluates each rule against the current tree hash and the
// freeze.gates acknowledgement map, cites the rule ids in the refusal
// envelope, and leaves the enforcement posture of each caller intact
// (readiness stays informational; freeze still exits 4 on an unfrozen
// tree via its own freezeableAfterAck check). A stage that is
// 'passed', 'acknowledged' or 'notApplicable' at the current hash
// never cites a rule; the `--ack <gate>=<reason>` channel on
// readiness / freeze is the recordedInChain override channel for
// ADM-02 and ADM-03. ADM-04 has no gate ack: the override is a chain
// correction committed to git (NV-DL-ADM-04's recordedInChain shape).

import { enforceAdmissibility, getRulesetToolScope } from '#admissibility';
// 0.30.0 PR 8 (REQ-179 / TAC-4125): NV-DL admissibility.
import { loadFreezeRecord } from '../define/freeze-record.js';

/**
 * @typedef {import('../admissibility/enforce.js').AdmissibilityVerdict} AdmissibilityVerdict
 * @typedef {import('../admissibility/enforce.js').AdmissibilityOverride} AdmissibilityOverride
 */

/**
 * @typedef {object} QueryResult
 * @property {'ok' | 'refused-admissibility'} status
 * @property {AdmissibilityVerdict} [admissibility] - always present so callers can log.
 * @property {*} [payload] - the underlying query result on status 'ok'.
 * @property {string} [refusal] - human-readable summary on 'refused-admissibility'.
 */

/**
 * 0.30.0 PR 9 (REQ-179 enforcement locus): evaluate the three
 * DEFINE-stage NV-DL rules against a readiness result plus a
 * validate-errors array. Returns the set of refuseByDefault rule ids
 * that bite at the current tree hash, after `--ack` reasons on
 * freeze.gates are honoured. The caller composes this with the
 * NV-BL admissibility verdict in `runWithAdmissibilityGate`.
 *
 * A stage counts as biting when:
 *   - ADM-02: the D4 `stage.state` is `'failing'` (not `'passed'` /
 *     `'acknowledged'` / `'notApplicable'`).
 *   - ADM-03: the D3 `stage.state` is `'failing'`.
 *   - ADM-04: `validateErrors.length > 0`.
 *
 * The ack channel for ADM-02 and ADM-03 is `--ack <gate>=<reason>` on
 * `rcf define readiness` / `rcf define freeze`, which the readiness
 * compose already folds into `state: 'acknowledged'` at the current
 * hash; `foldState` applies the ack only when the recorded hash
 * matches `currentTreeHash`, so a stale ack never masks a current
 * failure. ADM-04's override is a chain correction committed to git
 * (per the ruleset note), not a gate ack.
 *
 * @param {object} args
 * @param {Array<{ stage: string, gate: string, state: string }>} [args.stages]
 * @param {Array<unknown>} [args.validateErrors]
 * @returns {{ bitingRules: string[], d3State: string|null, d4State: string|null, validateCount: number }}
 */
export function evaluateDefineStageAdmissibility({ stages = [], validateErrors = [] } = {}) {
  const stageByName = new Map();
  for (const s of stages) {
    if (s && typeof s.stage === 'string') stageByName.set(s.stage, s);
  }
  const d3 = stageByName.get('D3');
  const d4 = stageByName.get('D4');
  const bitingRules = [];
  if (d4 && d4.state === 'failing') bitingRules.push('NV-DL-ADM-02');
  if (d3 && d3.state === 'failing') bitingRules.push('NV-DL-ADM-03');
  const validateCount = Array.isArray(validateErrors) ? validateErrors.length : 0;
  if (validateCount > 0) bitingRules.push('NV-DL-ADM-04');
  return {
    bitingRules,
    d3State: d3?.state ?? null,
    d4State: d4?.state ?? null,
    validateCount,
  };
}

/**
 * Wrap a query producer with the refuse-first posture. The producer is
 * only called when admissibility passes (or passes-with-overrides);
 * on refusal, its produce function does NOT run and the wrapper
 * returns a refusal envelope naming the unresolved rules.
 *
 * 0.30.0 PR 9: callers may also pass `defineStages` (the computed
 * readiness `stages[]`) and `defineValidateErrors` so the wrap can
 * cite NV-DL-ADM-02/03/04 alongside the NV-BL rules. The producer
 * STILL runs when the NV-BL verdict is pass or passWithOverrides,
 * even when the NV-DL rules bite: the wrap's refusal shape is reserved
 * for the hard NV-BL refusal (readiness is informational per
 * AC-17902-4; freeze keeps its own freezeableAfterAck check). The
 * biting NV-DL rule ids appear on the returned envelope so callers can
 * log them in a single consistent line.
 *
 * @param {object} args
 * @param {object} args.tree
 * @param {string|null} [args.chainRulesetVersion]
 * @param {AdmissibilityOverride[]} [args.overrides]
 * @param {() => (Promise<*> | *)} args.produce - the underlying query
 * @param {object} [args.opts] - passed through to enforceAdmissibility
 * @param {Array<{ stage: string, gate: string, state: string }>} [args.defineStages]
 * @param {Array<unknown>} [args.defineValidateErrors]
 * @returns {Promise<QueryResult & { defineRules?: string[] }>}
 */
export async function runWithAdmissibilityGate({
  tree,
  chainRulesetVersion = null,
  overrides = [],
  produce,
  opts = {},
  defineStages = [],
  defineValidateErrors = [],
} = {}) {
  const toolScope = await getRulesetToolScope();
  if (!toolScope.traceabilityAndQueryTools) {
    // Ruleset opted out of tool-scope gating (currently the artefact
    // ships with this on -- item 1 addendum -- but the switch is
    // read at runtime so a future ruleset revision can amend it).
    const payload = await Promise.resolve(produce());
    return { status: 'ok', payload };
  }
  const verdict = await enforceAdmissibility({ tree, chainRulesetVersion, overrides, opts });
  const defineEval = evaluateDefineStageAdmissibility({
    stages: defineStages,
    validateErrors: defineValidateErrors,
  });
  if (verdict.verdict === 'refuse') {
    const nvBlRuleIds = [...new Set(verdict.unresolved.map((f) => f.rule).filter(Boolean))].sort();
    const combinedRuleIds = [...new Set([...nvBlRuleIds, ...defineEval.bitingRules])].sort();
    return {
      status: 'refused-admissibility',
      admissibility: verdict,
      defineRules: defineEval.bitingRules,
      refusal: `traceability/query tool refused (NV-BL-SR-03 addendum): unresolved admissibility rules [${combinedRuleIds.join(', ')}]. Fix or record a NV-BL-ADM-05 override (or an --ack reason for NV-DL-ADM-02/03) before re-querying.`,
    };
  }
  const payload = await Promise.resolve(produce());
  return {
    status: 'ok',
    admissibility: verdict,
    defineRules: defineEval.bitingRules,
    payload,
  };
}

/**
 * 0.30.0 PR 8 (REQ-179, TAC-4125; AC-17902-2 / AC-17902-3). Evaluate
 * NV-DL-ADM-01 against the project's freeze record: an unfrozen tree
 * without `freeze.override` set is a refusal; `freeze.override`
 * present satisfies the recordedInChain channel so the caller may
 * proceed and name the override.
 *
 * Pure of walker I/O: it reads the freeze record only. Callers wrap
 * their own tool / verb refusal path around the returned verdict.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @returns {Promise<{ verdict: 'ok' | 'refuse-nv-dl-adm-01', rule?: 'NV-DL-ADM-01', override?: {reason:string, by:string, at:string}|null, message?: string }>}
 */
export async function evaluateDefineAdmissibility({ projectRoot }) {
  const freeze = await loadFreezeRecord({ projectRoot });
  if (freeze && typeof freeze === 'object' && freeze.override) {
    const o = freeze.override;
    return { verdict: 'ok', override: { reason: o.reason, by: o.by, at: o.at } };
  }
  if (freeze && typeof freeze === 'object' && freeze.docHashes) {
    return { verdict: 'ok', override: null };
  }
  return {
    verdict: 'refuse-nv-dl-adm-01',
    rule: 'NV-DL-ADM-01',
    message:
      'NV-DL-ADM-01: refused on an unfrozen tree. Close the change with `rcf define readiness` and `rcf define freeze`, '
      + 'or record `freeze.override { reason, by, at }` via `rcf build bundle --next --override "<reason>"`.',
  };
}

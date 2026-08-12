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

import { enforceAdmissibility, getRulesetToolScope } from '#admissibility';

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
 * Wrap a query producer with the refuse-first posture. The producer is
 * only called when admissibility passes (or passes-with-overrides);
 * on refusal, its produce function does NOT run and the wrapper
 * returns a refusal envelope naming the unresolved rules.
 *
 * @param {object} args
 * @param {object} args.tree
 * @param {string|null} [args.chainRulesetVersion]
 * @param {AdmissibilityOverride[]} [args.overrides]
 * @param {() => (Promise<*> | *)} args.produce - the underlying query
 * @param {object} [args.opts] - passed through to enforceAdmissibility
 * @returns {Promise<QueryResult>}
 */
export async function runWithAdmissibilityGate({
  tree,
  chainRulesetVersion = null,
  overrides = [],
  produce,
  opts = {},
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
  if (verdict.verdict === 'refuse') {
    const ruleIds = [...new Set(verdict.unresolved.map((f) => f.rule).filter(Boolean))].sort();
    return {
      status: 'refused-admissibility',
      admissibility: verdict,
      refusal: `traceability/query tool refused (NV-BL-SR-03 addendum): unresolved admissibility rules [${ruleIds.join(', ')}]. Fix or record a NV-BL-ADM-05 override before re-querying.`,
    };
  }
  const payload = await Promise.resolve(produce());
  return { status: 'ok', admissibility: verdict, payload };
}

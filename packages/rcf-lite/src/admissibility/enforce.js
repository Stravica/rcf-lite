// Chain-admissibility gate (NV-BL-ADM-05, NV-BL-ADM-06).
//
// Refuse-first per ratified ruling-sheet item 1 (2026-08-11): a chain
// that fails any admissibility check is refused before build starts.
// Explicit overrides are permitted for non-source-marker checks,
// recorded in the chain with rule id, reason, and authoring identity,
// and surfaced in the finalise summary. Source-comment markers
// (NV-BL-ADM-04) fall outside this generic override channel and are
// governed by the narrower ADR-only mechanism per ruling-sheet
// item 16 -- callers apply that check separately.
//
// NV-BL-ADM-06 (build-stage refusal on ruleset-version drift):
// composes with the scope-tag scans below so a build-time entry point
// gets one call that returns a single verdict.

import { detectRulesetDrift, getRuleset } from '#ruleset';

import { scanAcScopeCoverage, scanTcScopeVsAc } from './scope-lint.js';

/**
 * @typedef {object} AdmissibilityOverride
 * @property {string} rule - rule id being overridden (e.g. "NV-BL-ADM-02").
 * @property {string} reason - operator-provided reason recorded on the chain.
 * @property {string} [authoredBy] - author identity string.
 * @property {string} [documentId] - optional pin to a specific doc id.
 */

/**
 * @typedef {object} AdmissibilityVerdict
 * @property {'pass' | 'refuse' | 'passWithOverrides'} verdict
 * @property {import('#core/errors').RcfError[]} findings - all findings before override application.
 * @property {import('#core/errors').RcfError[]} unresolved - findings not covered by a supplied override.
 * @property {AdmissibilityOverride[]} appliedOverrides
 * @property {object} drift - shape from detectRulesetDrift.
 */

/**
 * Should this finding be masked by the given override? Match on rule id
 * and, when the override pins a documentId, on documentId too.
 */
function overrideCovers(finding, override) {
  if (finding.rule !== override.rule) return false;
  if (override.documentId && finding.documentId !== override.documentId) return false;
  return true;
}

/**
 * Enforce admissibility across the whole chain (NV-BL-ADM-05 gate) plus
 * ruleset-version drift (NV-BL-ADM-06). Callers pass the walker tree,
 * the chain's declared ruleset version (per DL-REQ-VALIDATE-03), and an
 * optional list of recorded overrides.
 *
 * A pure function on top of the ruleset + tree. Callers decide what to
 * do with a `refuse` verdict (`rcf build` refuses with exit 4; a query
 * or traceability tool refuses to surface the chain per the item 1
 * addendum -- see `#query/refuse-on-admissibility`).
 *
 * @param {object} args
 * @param {object} args.tree - walker output
 * @param {string|null} [args.chainRulesetVersion]
 * @param {AdmissibilityOverride[]} [args.overrides]
 * @param {object} [args.opts]
 * @param {boolean} [args.opts.tolerateUnclassified] - default true.
 * @returns {Promise<AdmissibilityVerdict>}
 */
export async function enforceAdmissibility({
  tree,
  chainRulesetVersion = null,
  overrides = [],
  opts = {},
} = {}) {
  const ruleset = await getRuleset();
  const drift = await detectRulesetDrift({ chainRulesetVersion, ruleset });

  const findings = [];

  // NV-BL-ADM-06: build-stage refusal on behavioural drift. Missing
  // chain-ruleset-version is a separate class -- the chain never
  // declared a version, so we cannot classify drift; the finding
  // asks the operator to run the define-stage warning path
  // (DL-REQ-VALIDATE-03) or acknowledge the omission via override.
  if (drift.drift === 'behavioural') {
    findings.push({
      kind: 'validation',
      message: `NV-BL-ADM-06: chain was authored against ruleset version ${drift.chainVersion}; shipping version is ${drift.shippingVersion}. Behaviour-changing drift refuses at build stage.`,
      rule: 'NV-BL-ADM-06',
    });
  } else if (drift.drift === 'missing') {
    findings.push({
      kind: 'validation',
      message: `NV-BL-ADM-06: chain does not declare a ruleset version. Run the define-stage adequacy check against ruleset ${drift.shippingVersion} (DL-REQ-VALIDATE-03) or record an override.`,
      rule: 'NV-BL-ADM-06',
    });
  }

  // NV-BL-ADM-02 / -03: scope-tag coverage + TC-scope-vs-AC-scope.
  findings.push(...scanAcScopeCoverage(tree, opts));
  findings.push(...scanTcScopeVsAc(tree, opts));

  // NV-BL-ADM-05: refuse-first, override-recorded. Overrides are
  // recorded on the chain; we apply them here to produce the
  // unresolved-findings set. Source-comment markers (NV-BL-ADM-04) do
  // NOT flow through this override channel; callers running that scan
  // filter its findings only through the ADR-only channel per
  // ruling-sheet item 16.
  const appliedOverrides = [];
  const unresolved = [];
  for (const finding of findings) {
    if (finding.rule === 'NV-BL-ADM-04') {
      // Guardrail: source-marker findings must never be masked through
      // the generic override channel. If a caller mistakenly threaded
      // them into this function, leave them unresolved.
      unresolved.push(finding);
      continue;
    }
    const hit = overrides.find((o) => overrideCovers(finding, o));
    if (hit) {
      appliedOverrides.push(hit);
      continue;
    }
    unresolved.push(finding);
  }

  let verdict;
  if (unresolved.length === 0 && appliedOverrides.length === 0) verdict = 'pass';
  else if (unresolved.length === 0) verdict = 'passWithOverrides';
  else verdict = 'refuse';

  return { verdict, findings, unresolved, appliedOverrides, drift };
}

/**
 * Convenience: the ruleset's toolScope block. Query / traceability tools
 * read this to decide whether to apply the refuse-first posture when
 * surfacing chain data (NV-BL-SR-03 addendum on ruling-sheet item 1).
 *
 * @returns {Promise<{ chainAdmissibility: boolean, traceabilityAndQueryTools: boolean }>}
 */
export async function getRulesetToolScope() {
  const ruleset = await getRuleset();
  return ruleset.toolScope;
}

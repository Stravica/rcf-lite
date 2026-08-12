// Chain-admissibility scope checks (NV-BL-ADM-02, NV-BL-ADM-03).
//
// The scope-tag vocabulary itself lives on rcf-schemas 0.4.3
// (`common.$defs.scopeTag`). This module consumes the tags off ACs
// and TCs and enforces the admissibility rules the shared standards
// ruleset references (`NV-BL-ADM-02` for AC scope classification and
// `NV-BL-ADM-03` for TC scope >= AC scope).
//
// Refuse-first, override-recorded per NV-BL-ADM-05; source-comment
// markers are governed separately by NV-BL-ADM-04 and its ADR-only
// override channel.

import { rcfError } from '#core/errors';

/**
 * Rank each scope so we can compare "TC scope >= AC scope" numerically.
 * `unclassified` is the migration state; ranked -1 so a TC-scoped
 * unclassified against a runtime-scope AC surfaces as a mismatch.
 * @type {Record<string, number>}
 */
const SCOPE_RANK = Object.freeze({
  library: 1,
  runtime: 2,
  deployed: 3,
  unclassified: -1,
});

/**
 * True when the tag is a known scope value per the shared vocabulary.
 * @param {unknown} tag
 * @returns {boolean}
 */
function isKnownScope(tag) {
  return typeof tag === 'string' && Object.prototype.hasOwnProperty.call(SCOPE_RANK, tag);
}

/**
 * NV-BL-ADM-02: every AC must carry a known scope tag. An AC without a
 * scope, or with a non-vocabulary value, produces an admissibility
 * finding. Per the ruleset's `unclassifiedMigrationTolerance` block,
 * an AC scoped `unclassified` is currently tolerated (findings not
 * emitted); callers who want to enforce full migration pass
 * `tolerateUnclassified: false`.
 *
 * @param {object} tree - walkTree output
 * @param {object} [opts]
 * @param {boolean} [opts.tolerateUnclassified] - default true (migration state)
 * @returns {import('#core/errors').RcfError[]}
 */
export function scanAcScopeCoverage(tree, { tolerateUnclassified = true } = {}) {
  const findings = [];
  for (const us of tree.userStories ?? []) {
    for (const ac of us.acceptanceCriteria ?? []) {
      const scope = ac?.scope;
      if (scope === undefined) {
        findings.push(rcfError({
          kind: 'validation',
          message: `NV-BL-ADM-02: AC ${ac.id} on US ${us.usId} carries no scope tag`,
          documentId: ac.id,
          field: 'scope',
          rule: 'NV-BL-ADM-02',
        }));
        continue;
      }
      if (!isKnownScope(scope)) {
        findings.push(rcfError({
          kind: 'validation',
          message: `NV-BL-ADM-02: AC ${ac.id} on US ${us.usId} carries an unknown scope tag "${scope}"`,
          documentId: ac.id,
          field: 'scope',
          rule: 'NV-BL-ADM-02',
        }));
        continue;
      }
      if (scope === 'unclassified' && !tolerateUnclassified) {
        findings.push(rcfError({
          kind: 'validation',
          message: `NV-BL-ADM-02: AC ${ac.id} on US ${us.usId} still scoped "unclassified" after the migration window`,
          documentId: ac.id,
          field: 'scope',
          rule: 'NV-BL-ADM-02',
        }));
      }
    }
  }
  return findings;
}

/**
 * NV-BL-ADM-03: for each AC, every bound TC's scope must be equal to
 * or wider than the AC's scope. A library-scope TC bound to a
 * runtime-scope AC surfaces as a mismatch. TCs with no scope tag are
 * flagged the same way ACs are in NV-BL-ADM-02: absent = finding
 * (bootstrap: unclassified tolerated).
 *
 * @param {object} tree - walkTree output
 * @param {object} [opts]
 * @param {boolean} [opts.tolerateUnclassified] - default true
 * @returns {import('#core/errors').RcfError[]}
 */
export function scanTcScopeVsAc(tree, { tolerateUnclassified = true } = {}) {
  const findings = [];
  const acScope = new Map();
  for (const us of tree.userStories ?? []) {
    for (const ac of us.acceptanceCriteria ?? []) {
      if (ac?.id) acScope.set(ac.id, ac.scope);
    }
  }
  for (const ts of tree.testSuites ?? []) {
    for (const tc of ts.testCases ?? []) {
      if (!tc?.id || !tc?.acId) continue;
      const tcScope = tc?.scope;
      const acTag = acScope.get(tc.acId);
      if (acTag === undefined || !isKnownScope(acTag) || acTag === 'unclassified') {
        // The AC's own scope problem surfaces via scanAcScopeCoverage;
        // this scan is silent for ACs the classifier could not read.
        continue;
      }
      if (tcScope === undefined) {
        findings.push(rcfError({
          kind: 'validation',
          message: `NV-BL-ADM-03: TC ${tc.id} on TS ${ts.id} carries no scope tag (bound AC ${tc.acId} is scope=${acTag})`,
          documentId: tc.id,
          field: 'scope',
          rule: 'NV-BL-ADM-03',
        }));
        continue;
      }
      if (!isKnownScope(tcScope)) {
        findings.push(rcfError({
          kind: 'validation',
          message: `NV-BL-ADM-03: TC ${tc.id} on TS ${ts.id} carries an unknown scope tag "${tcScope}"`,
          documentId: tc.id,
          field: 'scope',
          rule: 'NV-BL-ADM-03',
        }));
        continue;
      }
      if (tcScope === 'unclassified') {
        if (!tolerateUnclassified) {
          findings.push(rcfError({
            kind: 'validation',
            message: `NV-BL-ADM-03: TC ${tc.id} on TS ${ts.id} still scoped "unclassified" after the migration window`,
            documentId: tc.id,
            field: 'scope',
            rule: 'NV-BL-ADM-03',
          }));
        }
        continue;
      }
      if (SCOPE_RANK[tcScope] < SCOPE_RANK[acTag]) {
        findings.push(rcfError({
          kind: 'validation',
          message: `NV-BL-ADM-03: TC ${tc.id} scope "${tcScope}" is narrower than the AC ${tc.acId} scope "${acTag}"; a bound TC must be equal to or wider than the AC scope`,
          documentId: tc.id,
          field: 'scope',
          rule: 'NV-BL-ADM-03',
        }));
      }
    }
  }
  return findings;
}

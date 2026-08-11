// Pure coverage compute. Given a walker-produced TreeModel, walk the
// REQ chain (PRD -> REQ -> US -> AC -> TS -> TC) and report whether at
// least one full chain reaches a TC leaf per REQ.
//
// w-2026-07-28-005: the TC leaf test is RESOLUTION-GATED. A TC counts as
// covering its AC only when its `testPointer` resolves to a real test in
// the working tree (see core's tp-resolve.js). Callers resolve pointers
// first (async, fs-touching) and pass the result in via
// `opts.testPointers`; this function stays pure. When no resolution map
// is supplied the compute FAILS CLOSED - every TC is treated as
// unresolved - because an unverified pointer must never count as
// coverage. A TC row whose pointer does not resolve is reported as its
// own class (`covered-unresolved`), never silently folded into either
// covered or uncovered.
//
// Phase 5 §D2: shallow-any default (any AC covered by any TC = REQ
// covered); `--strict` flips to per-AC-strict (every AC has TC coverage).
// Phase-boundary note (§1.4, §D2): this is a MECHANICAL / DETERMINISTIC
// structural check. It does NOT answer "does the AC set adequately
// capture the REQ's intent?" - that non-deterministic question belongs
// to a later prompting + MCP resources phase (Phase 7+).
//
// Phase 5 §D10 scoping: no positional -> tree-wide; positional PRD id
// -> scope to REQs whose prdId matches; positional REQ id -> scope to
// that REQ; positional US id -> scope to the REQ that owns that US.
// Below-AC / cross-chain positionals (AC / TS / TC / FBS / TAC / ADR /
// BS / TAD) are refused at the handler layer (exit 2).

import { testCaseKey } from '#core/store';

/**
 * @typedef {import('#core/store/walker.js').TreeModel} TreeModel
 */

/**
 * @typedef {object} AcCoverage
 * @property {string} id
 * @property {boolean} covered - at least one TC whose pointer RESOLVES
 * @property {string[]} testCases - all TC ids that cross-reference this AC
 * @property {string[]} unresolvedTestCases - the subset whose pointer does not resolve
 */

/**
 * @typedef {object} ReqCoverage
 * @property {string} id
 * @property {boolean} covered - true only for coverageClass 'covered'
 * @property {'covered'|'covered-unresolved'|'uncovered'} coverageClass -
 *   'covered-unresolved' = the TC rows exist to claim coverage, but the
 *   claim rests on at least one pointer that does not resolve
 * @property {AcCoverage[]} acs
 */

/**
 * @typedef {object} CoverageResult
 * @property {boolean} ok - true when every requirement in scope is covered
 *   by RESOLVING test cases (covered-unresolved is a gap, not a pass)
 * @property {boolean} strict - the --strict flag echoed in the envelope
 * @property {{requirements: number, covered: number, coveredUnresolved: number, uncovered: number}} totals
 * @property {ReqCoverage[]} requirements
 * @property {Array<{tsId: string, tcId: string, testPointer: string|null, reason: string}>} unresolvedTestPointers -
 *   every in-scope TC whose pointer failed to resolve, with why
 */

/**
 * Compute coverage over the tree. Returns a stable CoverageResult
 * envelope suitable for the JSON / table / mermaid emitters.
 *
 * Phase 10 (X2 CodeNode bridge, D11): `opts.withCode` layers an
 * INFORMATIONAL code axis onto every AC - `codeClass` is one of
 * `implemented-and-covered` / `implemented-uncovered` / `unimplemented`
 * (deterministic edge counting via `tree.cnByAcId` / `tree.tcsByAcId`,
 * with the covered leg gated on pointer resolution per w-2026-07-28-005),
 * plus a tree-wide `codeNodeOrphans` list (CN docs with empty
 * `implementsAcIds`). None of this blocks - `ok` / exit code are
 * unaffected by the code axis (spec D11: the mark-complete gate, not
 * coverage, is where CN completeness is enforced).
 *
 * @param {TreeModel} tree
 * @param {object} [opts]
 * @param {boolean} [opts.strict] - per-AC-strict mode
 * @param {string} [opts.scopeId] - optional PRD / REQ / US id to scope
 * @param {boolean} [opts.withCode] - layer the code-axis classification
 * @param {Map<string, import('#core/store/tp-resolve.js').TestPointerResolution>} [opts.testPointers] -
 *   per-TC pointer resolution keyed by `testCaseKey(tsId, tcId)` (from
 *   core's `resolveTestPointers`). Absent entries / an absent map fail
 *   closed: the TC counts as unresolved.
 * @returns {CoverageResult}
 */
export function computeCoverage(tree, opts = {}) {
  const strict = Boolean(opts.strict);
  const scopeId = opts.scopeId ?? null;
  const withCode = Boolean(opts.withCode);
  const testPointers = opts.testPointers ?? new Map();
  const reqs = selectRequirements(tree, scopeId);

  /** @type {ReqCoverage[]} */
  const requirements = [];
  /** @type {Map<string, {tsId: string, tcId: string, testPointer: string|null, reason: string}>} */
  const unresolvedByKey = new Map();
  let covered = 0;
  let coveredUnresolved = 0;
  let uncovered = 0;

  for (const req of reqs) {
    const acs = collectAcs(tree, req.reqId, { withCode, testPointers, unresolvedByKey });
    // The real verdict counts only resolving TCs; the structural verdict
    // is the pre-w-2026-07-28-005 rule (a TC row exists). A REQ that
    // passes structurally but not really is 'covered-unresolved' - the
    // stub-TC state, made visible instead of counted.
    const isCovered = decideReqCoverage(acs, strict, (ac) => ac.covered);
    const structurallyCovered = decideReqCoverage(acs, strict, (ac) => ac.testCases.length > 0);
    const coverageClass = isCovered ? 'covered' : structurallyCovered ? 'covered-unresolved' : 'uncovered';
    if (coverageClass === 'covered') covered += 1;
    else if (coverageClass === 'covered-unresolved') coveredUnresolved += 1;
    else uncovered += 1;
    requirements.push({ id: req.reqId, covered: isCovered, coverageClass, acs });
  }

  const result = {
    ok: coveredUnresolved === 0 && uncovered === 0,
    strict,
    totals: {
      requirements: requirements.length,
      covered,
      coveredUnresolved,
      uncovered,
    },
    requirements,
    unresolvedTestPointers: [...unresolvedByKey.values()]
      .sort((a, b) => (a.tsId + a.tcId).localeCompare(b.tsId + b.tcId)),
  };

  if (withCode) {
    result.withCode = true;
    result.codeNodeOrphans = collectCodeNodeOrphans(tree);
    result.codeTotals = summariseCodeClasses(requirements);
  }

  return result;
}

/**
 * CN docs whose `implementsAcIds` is empty - a legitimate, common state
 * (utilities, glue, wiring), reported informationally (D3/D11).
 * @param {TreeModel} tree
 * @returns {string[]}
 */
function collectCodeNodeOrphans(tree) {
  return (tree.codeNodes ?? [])
    .filter((cn) => (cn.implementsAcIds ?? []).length === 0)
    .map((cn) => cn.cnId)
    .sort();
}

/**
 * @param {ReqCoverage[]} requirements
 * @returns {{ implementedAndCovered: number, implementedUncovered: number, unimplemented: number }}
 */
function summariseCodeClasses(requirements) {
  const totals = { implementedAndCovered: 0, implementedUncovered: 0, unimplemented: 0 };
  for (const req of requirements) {
    for (const ac of req.acs) {
      if (ac.codeClass === 'implemented-and-covered') totals.implementedAndCovered += 1;
      else if (ac.codeClass === 'implemented-uncovered') totals.implementedUncovered += 1;
      else if (ac.codeClass === 'unimplemented') totals.unimplemented += 1;
    }
  }
  return totals;
}

/**
 * Select the requirements in scope for coverage. No scope = every REQ
 * in the tree. PRD scope = REQs whose prdId matches. REQ scope = just
 * that REQ. US scope = the REQ that owns that US.
 *
 * @param {TreeModel} tree
 * @param {string | null} scopeId
 * @returns {object[]}
 */
function selectRequirements(tree, scopeId) {
  if (!scopeId) return [...tree.requirements];
  const kind = tree.kindById.get(scopeId);
  if (kind === 'prd') {
    return tree.requirements.filter((r) => r.prdId === scopeId);
  }
  if (kind === 'req') {
    const req = tree.requirements.find((r) => r.reqId === scopeId);
    return req ? [req] : [];
  }
  if (kind === 'userStory') {
    const us = tree.userStories.find((u) => u.usId === scopeId);
    if (!us) return [];
    const req = tree.requirements.find((r) => r.reqId === us.reqId);
    return req ? [req] : [];
  }
  // Unknown / unscopeable id: caller (handler) refuses with exit 2. The
  // pure function returns an empty scope so callers that pass a bad id
  // without pre-flighting still get an empty envelope back.
  return [];
}

/**
 * Collect every AC under a REQ (across all its USs) with per-AC coverage
 * signal + the list of TC ids referencing that AC. A TC only counts
 * towards `covered` when its pointer resolves (w-2026-07-28-005); the
 * unresolved subset is carried per AC and accumulated into the caller's
 * `unresolvedByKey` detail map. Phase 10: when `withCode`, also attaches
 * `cnIds` and the D11 `codeClass` (the covered leg is resolution-gated
 * too - a stub TC never manufactures 'implemented-and-covered').
 *
 * @param {TreeModel} tree
 * @param {string} reqId
 * @param {{ withCode?: boolean, testPointers?: Map<string, object>, unresolvedByKey?: Map<string, object> }} [opts]
 * @returns {AcCoverage[]}
 */
function collectAcs(tree, reqId, opts = {}) {
  const withCode = Boolean(opts.withCode);
  const testPointers = opts.testPointers ?? new Map();
  const unresolvedByKey = opts.unresolvedByKey ?? new Map();
  /** @type {AcCoverage[]} */
  const acs = [];
  const usIds = tree.childrenByParent.get(reqId) ?? [];
  for (const usId of usIds) {
    const us = tree.byId.get(usId);
    if (!us) continue;
    for (const ac of us.acceptanceCriteria ?? []) {
      if (!ac?.id) continue;
      const tcEntries = tree.tcsByAcId.get(ac.id) ?? [];
      const resolvedTcs = [];
      const unresolvedTcs = [];
      for (const { tsId, tcId } of tcEntries) {
        const key = testCaseKey(tsId, tcId);
        const resolution = testPointers.get(key);
        if (resolution?.resolved === true) {
          resolvedTcs.push(tcId);
        } else {
          unresolvedTcs.push(tcId);
          if (!unresolvedByKey.has(key)) {
            unresolvedByKey.set(key, {
              tsId,
              tcId,
              testPointer: resolution?.testPointer ?? null,
              reason: resolution?.reason ?? 'missing-pointer',
            });
          }
        }
      }
      const entry = {
        id: ac.id,
        covered: resolvedTcs.length > 0,
        testCases: tcEntries.map((e) => e.tcId).sort(),
        unresolvedTestCases: [...unresolvedTcs].sort(),
      };
      if (withCode) {
        const cnIds = [...(tree.cnByAcId?.get(ac.id) ?? [])].sort();
        entry.cnIds = cnIds;
        entry.codeClass = cnIds.length === 0
          ? 'unimplemented'
          : resolvedTcs.length > 0
            ? 'implemented-and-covered'
            : 'implemented-uncovered';
      }
      acs.push(entry);
    }
  }
  return acs;
}

/**
 * shallow-any: any one AC passing = REQ passing.
 * strict: every AC passing = REQ passing. REQ with zero ACs is uncovered
 * under either mode (no chain to walk). The per-AC predicate is supplied
 * by the caller so the same rule serves both the resolution-gated verdict
 * and the structural (TC-row-exists) verdict.
 *
 * @param {AcCoverage[]} acs
 * @param {boolean} strict
 * @param {(ac: AcCoverage) => boolean} acPasses
 * @returns {boolean}
 */
function decideReqCoverage(acs, strict, acPasses) {
  if (acs.length === 0) return false;
  if (strict) return acs.every(acPasses);
  return acs.some(acPasses);
}

/**
 * Detect whether the positional is a scopeable id (PRD / REQ / US) or
 * a below-AC id that the handler must refuse with exit 2 per D10.
 * Returns 'valid' | 'below-ac' | 'unknown-kind' | 'not-found'.
 *
 * @param {TreeModel} tree
 * @param {string} id
 * @returns {'valid' | 'below-ac' | 'unknown-kind' | 'not-found'}
 */
export function classifyCoverageScope(tree, id) {
  const kind = tree.kindById.get(id);
  if (!kind) {
    // Inline AC / TC ids are below-AC by definition.
    if (/^AC-/.test(id) || /^TC-/.test(id)) return 'below-ac';
    return 'not-found';
  }
  if (kind === 'prd' || kind === 'req' || kind === 'userStory') return 'valid';
  // Below-AC or off-chain kinds. TAC / ADR / FBS / BS / TAD / TS all
  // refuse: coverage backbone is PRD -> REQ -> US -> AC -> TS -> TC,
  // scoping below AC has no meaningful reduction.
  return 'below-ac';
}

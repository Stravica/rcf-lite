// Pure coverage compute. Given a walker-produced TreeModel, walk the
// REQ chain (PRD -> REQ -> US -> AC -> TS -> TC) and report whether at
// least one full chain reaches a TC leaf per REQ.
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

/**
 * @typedef {import('../store/walker.js').TreeModel} TreeModel
 */

/**
 * @typedef {object} AcCoverage
 * @property {string} id
 * @property {boolean} covered
 * @property {string[]} testCases - TC ids that cross-reference this AC
 */

/**
 * @typedef {object} ReqCoverage
 * @property {string} id
 * @property {boolean} covered
 * @property {AcCoverage[]} acs
 */

/**
 * @typedef {object} CoverageResult
 * @property {boolean} ok - true when every requirement in scope is covered
 * @property {boolean} strict - the --strict flag echoed in the envelope
 * @property {{requirements: number, covered: number, uncovered: number}} totals
 * @property {ReqCoverage[]} requirements
 */

/**
 * Compute coverage over the tree. Returns a stable CoverageResult
 * envelope suitable for the JSON / table / mermaid emitters.
 *
 * Phase 10 (X2 CodeNode bridge, D11): `opts.withCode` layers an
 * INFORMATIONAL code axis onto every AC - `codeClass` is one of
 * `implemented-and-covered` / `implemented-uncovered` / `unimplemented`
 * (deterministic edge counting via `tree.cnByAcId` / `tree.tcsByAcId`),
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
 * @returns {CoverageResult}
 */
export function computeCoverage(tree, opts = {}) {
  const strict = Boolean(opts.strict);
  const scopeId = opts.scopeId ?? null;
  const withCode = Boolean(opts.withCode);
  const reqs = selectRequirements(tree, scopeId);

  /** @type {ReqCoverage[]} */
  const requirements = [];
  let covered = 0;
  let uncovered = 0;

  for (const req of reqs) {
    const acs = collectAcs(tree, req.reqId, { withCode, tree });
    const isCovered = decideReqCoverage(acs, strict);
    if (isCovered) covered += 1;
    else uncovered += 1;
    requirements.push({ id: req.reqId, covered: isCovered, acs });
  }

  const result = {
    ok: uncovered === 0,
    strict,
    totals: {
      requirements: requirements.length,
      covered,
      uncovered,
    },
    requirements,
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
 * signal + the list of TC ids referencing that AC. Phase 10: when
 * `withCode`, also attaches `cnIds` and the D11 `codeClass`.
 *
 * @param {TreeModel} tree
 * @param {string} reqId
 * @param {{ withCode?: boolean }} [opts]
 * @returns {AcCoverage[]}
 */
function collectAcs(tree, reqId, opts = {}) {
  const withCode = Boolean(opts.withCode);
  /** @type {AcCoverage[]} */
  const acs = [];
  const usIds = tree.childrenByParent.get(reqId) ?? [];
  for (const usId of usIds) {
    const us = tree.byId.get(usId);
    if (!us) continue;
    for (const ac of us.acceptanceCriteria ?? []) {
      if (!ac?.id) continue;
      const tcs = (tree.tcsByAcId.get(ac.id) ?? []).map((entry) => entry.tcId);
      const entry = { id: ac.id, covered: tcs.length > 0, testCases: [...tcs].sort() };
      if (withCode) {
        const cnIds = [...(tree.cnByAcId?.get(ac.id) ?? [])].sort();
        entry.cnIds = cnIds;
        entry.codeClass = cnIds.length === 0
          ? 'unimplemented'
          : tcs.length > 0
            ? 'implemented-and-covered'
            : 'implemented-uncovered';
      }
      acs.push(entry);
    }
  }
  return acs;
}

/**
 * shallow-any: any one AC covered = REQ covered.
 * strict: every AC covered = REQ covered. REQ with zero ACs is uncovered
 * under either mode (no chain to walk).
 *
 * @param {AcCoverage[]} acs
 * @param {boolean} strict
 * @returns {boolean}
 */
function decideReqCoverage(acs, strict) {
  if (acs.length === 0) return false;
  if (strict) return acs.every((a) => a.covered);
  return acs.some((a) => a.covered);
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

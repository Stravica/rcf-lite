// Pure trace compute. Given a walker-produced TreeModel + a pivot id,
// walk the graph in one or both directions.
//
// Phase 5 §D8 trace-back: cross-links are NOT traversed by --back.
// From an AC, back walks the parent-child edge to US (not the
// `fbsByAcId` cross-link). This keeps --back unambiguous and
// terminating; cross-link fan-out is what `impact` is for.
//
// Phase 5 §D9 --both output shape: {pivot, ancestors, descendants} -
// two arrays around a single pivot id; not one merged graph. The
// pivot appears in neither array (it's the anchor).
//
// Phase 5 §4.2 test surface documents the expected node/edge shape:
//   - Forward from PRD returns full descendant tree down to TCs.
//   - Forward from AC follows all cross-links (tsByAcId, tcsByAcId,
//     fbsByAcId).
//   - Back from TC walks TC -> TS -> AC -> US -> REQ -> PRD (AC noted
//     via testCases[].acId; back-walk continues through parentByChild).

/**
 * @typedef {import('../store/walker.js').TreeModel} TreeModel
 */

/**
 * @typedef {'forward' | 'back' | 'both'} TraceDirection
 */

/**
 * @typedef {object} TraceNode
 * @property {string} id
 * @property {string} kind
 * @property {number} depth - 0 for pivot; positive for descendants; negative for ancestors
 */

/**
 * @typedef {object} TraceEdge
 * @property {string} from
 * @property {string} to
 * @property {'parentChild' | 'crossLink'} kind
 */

/**
 * @typedef {object} TraceResult
 * @property {string} pivot - the id queried
 * @property {TraceDirection} direction
 * @property {boolean} found - false when the pivot id is unknown
 * @property {TraceNode[]} [nodes] - direction forward | back
 * @property {TraceEdge[]} [edges] - direction forward | back
 * @property {TraceNode[]} [ancestors] - direction both
 * @property {TraceNode[]} [descendants] - direction both
 */

const INLINE_AC_RE = /^AC-/;
const INLINE_TC_RE = /^TC-/;

/**
 * Return the effective kind of an id. `tree.kindById` covers every
 * standalone doc; inline AC / TC ids are inferred from the id prefix.
 *
 * @param {TreeModel} tree
 * @param {string} id
 * @returns {string | null}
 */
export function kindOf(tree, id) {
  const k = tree.kindById.get(id);
  if (k) return k;
  if (INLINE_AC_RE.test(id)) return tree.parentByChild.has(id) ? 'ac' : null;
  if (INLINE_TC_RE.test(id)) return tree.parentByChild.has(id) ? 'tc' : null;
  return null;
}

/**
 * Compute a trace from `id` in the requested direction. Unknown pivot
 * returns `{found: false}`; the handler layer converts this to exit 2.
 *
 * @param {TreeModel} tree
 * @param {object} opts
 * @param {string} opts.id
 * @param {TraceDirection} [opts.direction]
 * @param {boolean} [opts.includeCode] - Phase 10: extend the forward fan-out
 *   into Code Nodes (AC -> implementing CN -> transitive dependents). Opt-in
 *   so spec-only queries stay byte-identical (spec D9).
 * @returns {TraceResult}
 */
export function computeTrace(tree, { id, direction = 'forward', includeCode = false }) {
  const kind = kindOf(tree, id);
  if (!kind) {
    return { pivot: id, direction, found: false };
  }
  if (direction === 'forward') {
    const { nodes, edges } = walkForward(tree, id, kind, includeCode);
    return { pivot: id, direction, found: true, nodes, edges };
  }
  if (direction === 'back') {
    const { nodes, edges } = walkBack(tree, id, kind);
    return { pivot: id, direction, found: true, nodes, edges };
  }
  // both
  const back = walkBack(tree, id, kind);
  const fwd = walkForward(tree, id, kind, includeCode);
  // Both arrays exclude the pivot; pivot is the anchor between them
  // (spec §D9: two arrays around a single pivot id).
  return {
    pivot: id,
    direction: 'both',
    found: true,
    ancestors: back.nodes.filter((n) => n.id !== id),
    descendants: fwd.nodes.filter((n) => n.id !== id),
  };
}

/**
 * Forward walk from pivot. BFS over structural children + cross-link
 * children. Each visited id becomes a node; each traversal step
 * becomes an edge (parentChild or crossLink).
 *
 * @param {TreeModel} tree
 * @param {string} pivot
 * @param {string} pivotKind
 * @param {boolean} [includeCode] - Phase 10 opt-in for the code layer.
 * @returns {{nodes: TraceNode[], edges: TraceEdge[]}}
 */
function walkForward(tree, pivot, pivotKind, includeCode = false) {
  /** @type {TraceNode[]} */
  const nodes = [{ id: pivot, kind: pivotKind, depth: 0 }];
  /** @type {TraceEdge[]} */
  const edges = [];
  const seen = new Set([pivot]);
  const depthById = new Map([[pivot, 0]]);
  /** @type {string[]} */
  const queue = [pivot];

  while (queue.length > 0) {
    const cur = queue.shift();
    if (!cur) break;
    const curDepth = depthById.get(cur) ?? 0;
    const children = forwardChildrenOf(tree, cur, includeCode);
    for (const child of children) {
      // Always emit the edge (even if child already visited via a
      // different parent) so the graph is complete; only enqueue and
      // add-as-node the first time.
      edges.push({ from: cur, to: child.id, kind: child.edgeKind });
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      const childKind = kindOf(tree, child.id);
      if (!childKind) continue;
      const nextDepth = curDepth + 1;
      depthById.set(child.id, nextDepth);
      nodes.push({ id: child.id, kind: childKind, depth: nextDepth });
      queue.push(child.id);
    }
  }
  return { nodes, edges };
}

/**
 * Back walk from pivot. Follows `parentByChild` up to the root.
 * D8: cross-links are NOT traversed. Special case for TC: also
 * include the referenced AC (from tc.acId) between TS and US so the
 * back-trace surfaces the AC the TC exercises (§4.2 test surface).
 *
 * @param {TreeModel} tree
 * @param {string} pivot
 * @param {string} pivotKind
 * @returns {{nodes: TraceNode[], edges: TraceEdge[]}}
 */
function walkBack(tree, pivot, pivotKind) {
  /** @type {TraceNode[]} */
  const nodes = [{ id: pivot, kind: pivotKind, depth: 0 }];
  /** @type {TraceEdge[]} */
  const edges = [];
  const seen = new Set([pivot]);

  const addStep = (fromId, toId, edgeKind, depth) => {
    if (!toId || seen.has(toId)) return;
    const k = kindOf(tree, toId);
    if (!k) return;
    seen.add(toId);
    nodes.push({ id: toId, kind: k, depth });
    edges.push({ from: fromId, to: toId, kind: edgeKind });
  };

  // TC special-case: insert AC (via testCases[].acId cross-link) between
  // TS and US in the back trace. Every other segment follows parentByChild.
  if (pivotKind === 'tc') {
    const tsId = tree.parentByChild.get(pivot);
    if (tsId) {
      addStep(pivot, tsId, 'parentChild', -1);
      const ts = tree.byId.get(tsId);
      const tc = ts?.testCases?.find((t) => t.id === pivot);
      const acId = tc?.acId;
      if (acId && !seen.has(acId)) {
        addStep(tsId, acId, 'crossLink', -2);
        // Continue from AC upward via parentByChild.
        let cur = acId;
        let depth = -3;
        while (cur) {
          const parent = tree.parentByChild.get(cur);
          if (!parent) break;
          addStep(cur, parent, 'parentChild', depth);
          cur = parent;
          depth -= 1;
        }
        return { nodes, edges };
      }
      // Fall through to plain TS -> US -> REQ -> PRD walk.
      let cur = tsId;
      let depth = -2;
      while (cur) {
        const parent = tree.parentByChild.get(cur);
        if (!parent) break;
        addStep(cur, parent, 'parentChild', depth);
        cur = parent;
        depth -= 1;
      }
      return { nodes, edges };
    }
  }

  // Phase 10 (X2 CodeNode bridge): CN special-case. A code node's parents
  // are the ACs it implements (a cross-link, not a parent-child edge).
  // Insert each AC below its US, then continue up via parentByChild
  // (AC -> US -> REQ -> PRD). This is exactly the `rcf trace <path>`
  // backward query: from a source location up to every requirement that
  // location serves.
  if (pivotKind === 'codeNode') {
    const cn = tree.byId.get(pivot);
    let depth = -1;
    for (const acId of cn?.implementsAcIds ?? []) {
      if (seen.has(acId)) continue;
      addStep(pivot, acId, 'crossLink', depth);
      let cur = acId;
      let up = depth - 1;
      while (cur) {
        const parent = tree.parentByChild.get(cur);
        if (!parent || seen.has(parent)) break;
        addStep(cur, parent, 'parentChild', up);
        cur = parent;
        up -= 1;
      }
    }
    return { nodes, edges };
  }

  let cur = pivot;
  let depth = -1;
  while (cur) {
    const parent = tree.parentByChild.get(cur);
    if (!parent) break;
    addStep(cur, parent, 'parentChild', depth);
    cur = parent;
    depth -= 1;
  }
  return { nodes, edges };
}

/**
 * Enumerate forward children of `id`. Combines:
 *   - parent-child edges via `childrenByParent`
 *   - inline AC ids for US pivots
 *   - inline TC ids for TS pivots
 *   - cross-links: tsByAcId + fbsByAcId + tcsByAcId for AC pivots
 *   - cross-links: usByTacId + FBS-context-refs for TAC pivots
 *   - cross-links: FBS-context-refs for ADR pivots
 *   - cross-links: dependentsByFbsId for FBS pivots
 *
 * @param {TreeModel} tree
 * @param {string} id
 * @param {boolean} [includeCode] - Phase 10 opt-in for the code layer.
 * @returns {{id: string, edgeKind: 'parentChild' | 'crossLink'}[]}
 */
function forwardChildrenOf(tree, id, includeCode = false) {
  const kind = kindOf(tree, id);
  const doc = tree.byId.get(id);
  /** @type {{id: string, edgeKind: 'parentChild' | 'crossLink'}[]} */
  const out = [];
  const seen = new Set();
  const push = (childId, edgeKind) => {
    if (!childId || seen.has(childId)) return;
    seen.add(childId);
    out.push({ id: childId, edgeKind });
  };

  // Parent-child edges (standalone kids).
  for (const c of tree.childrenByParent.get(id) ?? []) push(c, 'parentChild');

  // Inline children.
  if (kind === 'userStory' && doc) {
    for (const ac of doc.acceptanceCriteria ?? []) push(ac?.id, 'parentChild');
  }
  if (kind === 'testSuite' && doc) {
    for (const tc of doc.testCases ?? []) push(tc?.id, 'parentChild');
  }

  // Cross-links.
  if (kind === 'ac') {
    for (const tsId of tree.tsByAcId.get(id) ?? []) push(tsId, 'crossLink');
    for (const entry of tree.tcsByAcId.get(id) ?? []) push(entry.tcId, 'crossLink');
    for (const fbsId of tree.fbsByAcId.get(id) ?? []) push(fbsId, 'crossLink');
    // Phase 10 (X2 CodeNode bridge): AC -> implementing Code Nodes. This is
    // the seam that carries a forward trace/impact from spec into source.
    // Opt-in (includeCode) so spec-only queries stay byte-identical.
    if (includeCode) {
      for (const cnId of tree.cnByAcId?.get(id) ?? []) push(cnId, 'crossLink');
    }
  }
  // Phase 10: CN -> dependent Code Nodes. Forward from a code node is the
  // blast radius: everything that declares this node in its dependencies[].
  if (kind === 'codeNode' && includeCode) {
    for (const depId of tree.dependentsByCnId?.get(id) ?? []) push(depId, 'crossLink');
  }
  if (kind === 'tac') {
    for (const usId of tree.usByTacId.get(id) ?? []) push(usId, 'crossLink');
    for (const fbs of tree.fbsItems) {
      if ((fbs.contextRequirements?.tacIds ?? []).includes(id)) push(fbs.fbsId, 'crossLink');
    }
  }
  if (kind === 'adr') {
    for (const fbs of tree.fbsItems) {
      if ((fbs.contextRequirements?.adrIds ?? []).includes(id)) push(fbs.fbsId, 'crossLink');
    }
  }
  if (kind === 'fbs') {
    for (const depId of tree.dependentsByFbsId.get(id) ?? []) push(depId, 'crossLink');
  }
  return out;
}

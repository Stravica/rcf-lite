// Mermaid formatter for coverage / trace / impact result envelopes.
// Phase 5 §D14: `flowchart LR` orientation, class palette matches
// `src/view/mermaid-diagram.js`. Text-only output; no HTML wrapper.
//
// The class-defs block, `classForId`, and label helpers are
// duplicated here rather than extracted from `src/view/mermaid-diagram.js`.
// Reason (per Phase 5 brief §5, spec §D16): view-side helpers take
// the view's `BuiltTreeModel` (title lookup via `model.byId`), while
// this formatter operates over a pure `computeTrace` result envelope
// that carries only node ids and kinds. Bridging the two contract
// shapes would need a wrapper in the view module - the "invasive"
// extraction the spec calls out. Duplicating ~30 LoC of trivial
// static defs is cheaper and keeps the view module unchanged.

const CLASS_DEFS = `
  classDef prd fill:#fde68a,stroke:#92400e,color:#1f2937;
  classDef req fill:#bbf7d0,stroke:#065f46,color:#1f2937;
  classDef us fill:#bae6fd,stroke:#0c4a6e,color:#1f2937;
  classDef ac fill:#e0e7ff,stroke:#3730a3,color:#1f2937;
  classDef tad fill:#fecaca,stroke:#991b1b,color:#1f2937;
  classDef tac fill:#fed7aa,stroke:#9a3412,color:#1f2937;
  classDef adr fill:#fbcfe8,stroke:#9d174d,color:#1f2937;
  classDef bs fill:#ddd6fe,stroke:#5b21b6,color:#1f2937;
  classDef fbs fill:#c7d2fe,stroke:#3730a3,color:#1f2937;
  classDef broken stroke:#dc2626,stroke-width:2px,stroke-dasharray:5 5,color:#7f1d1d;
`.trim();

function classForId(id) {
  if (id.startsWith('PRD-')) return 'prd';
  if (id.startsWith('REQ-')) return 'req';
  if (id.startsWith('US-')) return 'us';
  if (id.startsWith('AC-')) return 'ac';
  if (id.startsWith('TAD-')) return 'tad';
  if (id.startsWith('TAC-')) return 'tac';
  if (id.startsWith('ADR-')) return 'adr';
  if (id.startsWith('BS-')) return 'bs';
  if (id.startsWith('FBS-')) return 'fbs';
  if (id.startsWith('TS-')) return 'us'; // TS shares the US palette by convention
  if (id.startsWith('TC-')) return 'ac'; // TC shares the AC palette by convention
  return 'unknown';
}

function nodeLabel(id) {
  return `"${id}"`;
}

/**
 * Emit `flowchart LR` mermaid text for a query result.
 *
 * @param {object} result
 * @param {'coverage' | 'trace' | 'impact'} verb
 * @returns {string}
 */
export function formatMermaid(result, verb) {
  if (verb === 'coverage') return renderCoverageMermaid(result);
  if (verb === 'trace') return renderTraceMermaid(result);
  if (verb === 'impact') return renderImpactMermaid(result);
  return '';
}

function renderCoverageMermaid(result) {
  const lines = ['flowchart LR'];
  const seenIds = new Set();
  const declare = (id) => {
    if (seenIds.has(id)) return;
    seenIds.add(id);
    lines.push(`  ${id}[${nodeLabel(id)}]`);
  };
  for (const req of result.requirements) {
    declare(req.id);
    for (const ac of req.acs) {
      declare(ac.id);
      lines.push(`  ${req.id} --> ${ac.id}`);
      for (const tc of ac.testCases) {
        declare(tc);
        lines.push(`  ${ac.id} -.-> ${tc}`);
      }
    }
  }
  return `${appendClassBlock(lines, seenIds)}\n`;
}

function renderTraceMermaid(result) {
  if (!result.found) return `%% trace: id ${result.pivot} not found\n`;
  if (result.direction === 'both') {
    // Two adjacent flowchart LR blocks with the pivot appearing in both,
    // so the pivot visually anchors between ancestors and descendants
    // (spec §D9).
    const pivotId = result.pivot;
    const ancestors = result.ancestors ?? [];
    const descendants = result.descendants ?? [];
    const ancBlock = buildTraceBlock({
      title: 'Ancestors',
      pivot: pivotId,
      nodes: [{ id: pivotId, kind: 'pivot', depth: 0 }, ...ancestors],
      edges: pairToEdges(ancestors, pivotId, /*isAncestor*/ true),
    });
    const descBlock = buildTraceBlock({
      title: 'Descendants',
      pivot: pivotId,
      nodes: [{ id: pivotId, kind: 'pivot', depth: 0 }, ...descendants],
      edges: pairToEdges(descendants, pivotId, /*isAncestor*/ false),
    });
    return `${ancBlock}\n\n${descBlock}\n`;
  }
  const lines = ['flowchart LR'];
  const seenIds = new Set();
  const declare = (id) => {
    if (seenIds.has(id)) return;
    seenIds.add(id);
    lines.push(`  ${id}[${nodeLabel(id)}]`);
  };
  for (const n of result.nodes ?? []) declare(n.id);
  for (const e of result.edges ?? []) {
    const arrow = e.kind === 'crossLink' ? '-.->' : '-->';
    lines.push(`  ${e.from} ${arrow} ${e.to}`);
  }
  return `${appendClassBlock(lines, seenIds)}\n`;
}

function renderImpactMermaid(result) {
  if (!result.found) return `%% impact: id ${result.pivot} not found\n`;
  const lines = ['flowchart LR'];
  const seenIds = new Set();
  const declare = (id) => {
    if (seenIds.has(id)) return;
    seenIds.add(id);
    lines.push(`  ${id}[${nodeLabel(id)}]`);
  };
  for (const n of result.nodes ?? []) declare(n.id);
  for (const e of result.edges ?? []) {
    const arrow = e.kind === 'crossLink' ? '-.->' : '-->';
    lines.push(`  ${e.from} ${arrow} ${e.to}`);
  }
  return `${appendClassBlock(lines, seenIds)}\n`;
}

// -- helpers --

function buildTraceBlock({ nodes, edges }) {
  const lines = ['flowchart LR'];
  const seen = new Set();
  const declare = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    lines.push(`  ${id}[${nodeLabel(id)}]`);
  };
  for (const n of nodes) declare(n.id);
  for (const e of edges) {
    const arrow = e.kind === 'crossLink' ? '-.->' : '-->';
    lines.push(`  ${e.from} ${arrow} ${e.to}`);
  }
  return appendClassBlock(lines, seen);
}

// The both-direction trace result does not preserve raw edges; synthesise
// a linear chain from the pivot through ancestors / descendants in
// depth order. Edge kind defaults to parentChild because we don't know
// the arrival relationship at this layer - the caller uses the raw
// forward / back envelopes when precise edge kinds matter.
function pairToEdges(list, pivot, isAncestor) {
  const edges = [];
  if (list.length === 0) return edges;
  if (isAncestor) {
    // Ancestors sorted by depth descending (closest first). Chain the
    // pivot -> first ancestor -> next ancestor. Depth on the trace
    // result is negative, closest ancestor has depth -1.
    let prev = pivot;
    const sorted = [...list].sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0));
    for (const n of sorted) {
      edges.push({ from: n.id, to: prev, kind: 'parentChild' });
      prev = n.id;
    }
    return edges;
  }
  // Descendants: pivot -> depth 1 -> depth 2 -> ...
  const sorted = [...list].sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0));
  let prev = pivot;
  for (const n of sorted) {
    edges.push({ from: prev, to: n.id, kind: 'parentChild' });
    prev = n.id;
  }
  return edges;
}

function appendClassBlock(lines, ids) {
  for (const id of ids) {
    const cls = classForId(id);
    if (cls !== 'unknown') lines.push(`  class ${id} ${cls};`);
  }
  lines.push(CLASS_DEFS);
  return lines.join('\n');
}

export { classForId, CLASS_DEFS };

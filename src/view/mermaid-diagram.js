// Mermaid diagram emission. Phase 3.2 replaces the exhaustive master
// diagram with a lightweight overview (PRD -> REQ family + TAD + BS) and
// keeps the per-requirement subdiagrams for drill-down. Click bindings on
// every diagram anchor into the hash-routed doc DOM (D5, D7).
//
// Node classes match the CSS palette in style.css. Broken nodes carry the
// `broken` class (dashed border, distinct colour). FBS-to-AC edges are
// dashed; FBS dependencies are dotted; FBS context (TAC / ADR) edges are
// dotted-thick.

const NODE_LABEL = {
  prd: 'PRD',
  req: 'REQ',
  us: 'US',
  ac: 'AC',
  tad: 'TAD',
  tac: 'TAC',
  adr: 'ADR',
  bs: 'BS',
  fbs: 'FBS',
};

/**
 * Mermaid is strict about id syntax: `-` is fine but parentheses, quotes
 * and unicode chars are not. Document ids are already safe (e.g. "REQ-002");
 * we just wrap labels in quotes.
 *
 * @param {string} id
 * @returns {string}
 */
function nodeId(id) {
  return id;
}

function nodeLabel(id, model) {
  const doc = model.byId.get(id);
  const title = pickTitle(doc, id);
  if (!title) return `"${id}"`;
  const safe = title.replace(/"/g, "'").replace(/\n/g, ' ');
  const trimmed = safe.length > 48 ? `${safe.slice(0, 45)}...` : safe;
  return `"${id}<br/>${trimmed}"`;
}

function pickTitle(doc, id) {
  if (!doc) return null;
  if (typeof doc.title === 'string') return doc.title;
  if (typeof doc.name === 'string') return doc.name;
  if (typeof doc.productName === 'string') return doc.productName;
  if (typeof doc.description === 'string') return doc.description;
  return id;
}

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
  return 'unknown';
}

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

function emitClick(id) {
  return `  click ${nodeId(id)} "#${id}";`;
}

function emitClassAssignments(ids, model) {
  const lines = [];
  for (const id of ids) {
    const cls = classForId(id);
    if (cls !== 'unknown') {
      lines.push(`  class ${nodeId(id)} ${cls};`);
    }
    if (model.brokenIds.has(id)) {
      lines.push(`  class ${nodeId(id)} broken;`);
    }
  }
  return lines;
}

/**
 * Build the overview diagram (`flowchart LR`): PRD -> each REQ (solid),
 * PRD -.-> TAD, PRD -.-> BS (dashed). ~10 nodes on the Phase 2 tree; the
 * whole point is a single-screen navigation surface (D3).
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 * @returns {string}
 */
export function overviewDiagram(model) {
  /** @type {string[]} */
  const lines = ['flowchart LR'];
  /** @type {Set<string>} */
  const declared = new Set();
  /** @type {Set<string>} */
  const allIds = new Set();

  const declare = (id) => {
    if (declared.has(id)) return;
    declared.add(id);
    allIds.add(id);
    lines.push(`  ${nodeId(id)}[${nodeLabel(id, model)}]`);
  };

  // PRD -> REQs (solid).
  if (model.prd?.prdId) {
    declare(model.prd.prdId);
    for (const reqId of model.prd.requirementIds ?? []) {
      declare(reqId);
      lines.push(`  ${nodeId(model.prd.prdId)} --> ${nodeId(reqId)}`);
    }
  }

  // PRD -.-> TAD (dashed - different relationship).
  if (model.prd?.prdId && model.tad?.tadId) {
    declare(model.tad.tadId);
    lines.push(`  ${nodeId(model.prd.prdId)} -.-> ${nodeId(model.tad.tadId)}`);
  } else if (model.tad?.tadId) {
    declare(model.tad.tadId);
  }

  // PRD -.-> BS (dashed).
  if (model.prd?.prdId && model.bs?.bsId) {
    declare(model.bs.bsId);
    lines.push(`  ${nodeId(model.prd.prdId)} -.-> ${nodeId(model.bs.bsId)}`);
  } else if (model.bs?.bsId) {
    declare(model.bs.bsId);
  }

  // Click bindings.
  for (const id of allIds) lines.push(emitClick(id));
  // Class assignments.
  lines.push(...emitClassAssignments([...allIds], model));
  // Class definitions.
  lines.push(CLASS_DEFS);

  return lines.join('\n');
}

/**
 * Build a per-REQ subdiagram (`flowchart LR`).
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 * @param {object} req - the requirement document
 * @returns {string}
 */
export function requirementSubdiagram(model, req) {
  if (!req?.reqId) return 'flowchart LR\n  empty[No requirement provided]';
  /** @type {string[]} */
  const lines = ['flowchart LR'];
  /** @type {Set<string>} */
  const declared = new Set();
  /** @type {Set<string>} */
  const allIds = new Set();
  const declare = (id) => {
    if (declared.has(id)) return;
    declared.add(id);
    allIds.add(id);
    lines.push(`  ${nodeId(id)}[${nodeLabel(id, model)}]`);
  };

  declare(req.reqId);
  const stories = model.storiesByReqId.get(req.reqId) ?? [];
  for (const us of stories) {
    declare(us.usId);
    lines.push(`  ${nodeId(req.reqId)} --> ${nodeId(us.usId)}`);
    for (const ac of us.acceptanceCriteria ?? []) {
      declare(ac.id);
      lines.push(`  ${nodeId(us.usId)} --> ${nodeId(ac.id)}`);
      const fbsList = model.fbsByAcId.get(ac.id) ?? [];
      for (const f of fbsList) {
        declare(f.fbsId);
        // Edge direction reversed so LR layout places FBS to the right of
        // its AC (reads "AC ... delivered by ... FBS"). Same relationship
        // as the old FBS->AC edge; just laid out more naturally.
        lines.push(`  ${nodeId(ac.id)} -.->|delivered by| ${nodeId(f.fbsId)}`);
      }
    }
  }

  for (const id of allIds) lines.push(emitClick(id));
  lines.push(...emitClassAssignments([...allIds], model));
  lines.push(CLASS_DEFS);
  return lines.join('\n');
}

/**
 * Build every per-REQ subdiagram, keyed by reqId.
 *
 * @param {import('./tree-model.js').BuiltTreeModel} model
 * @returns {Map<string, string>}
 */
export function allRequirementSubdiagrams(model) {
  const out = new Map();
  for (const req of model.requirements) {
    if (!req?.reqId) continue;
    out.set(req.reqId, requirementSubdiagram(model, req));
  }
  return out;
}

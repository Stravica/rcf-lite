// Build/DAG sub-tab renderer (viewer UI refresh PR 6; REQ-002, US-204,
// TAC-4131-build-dag-view, ADR-4133-dag-dependency-depth-layout).
//
// Pure HTML-string renderer for the Build tab's DAG sub-tab:
//   - DagToolbar: Status chips, Area select, Buildable-now, Critical-path
//     and Show-unconnected toggles plus a cycle finding (findingsList).
//   - DagCanvas: HTML buttons for each FBS node + inline SVG edges, laid
//     by `dependsOnFbsIds` depth (columns) and `buildOrder` (rows). The
//     canvas owns its own overflow so the viewer never scrolls
//     horizontally (ADR-4133).
//   - DagInspector: a sticky side panel the client fills on select.
//   - Unconnected lane: FBS with no incoming and no outgoing dependency,
//     hidden by default; the toggle carries the count.
//
// Layout, closures and critical path come from `buildDagLayout` so the
// toolbar and the canvas see the same numbers (AC-204-1, AC-204-3). The
// inspector is HTML-only; the client in page-init.js (wireBuildDag)
// swaps its body on select without any outbound postMessage (AC-204-7).

import { escapeHtml } from './doc-renderers/helpers.js';
import { pill } from './components/pill.js';
import { renderBadge } from './components/badge.js';
import { findingsList } from './components/findings-list.js';

/**
 * @typedef {object} DagNode
 * @property {string} id
 * @property {string} title
 * @property {string} status
 * @property {string} domain
 * @property {string} size
 * @property {number} buildOrder
 * @property {number} acCount
 * @property {number} depth
 * @property {string[]} needs             direct dependencies
 * @property {string[]} waits             direct dependants
 * @property {string[]} upstream          transitive closure of needs
 * @property {string[]} downstream        transitive closure of waits
 * @property {boolean} buildable
 * @property {boolean} critical
 * @property {boolean} unconnected
 */

/**
 * @typedef {object} DagLayout
 * @property {Map<string, DagNode>} nodes
 * @property {Array<{ from: string, to: string }>} edges
 * @property {string[][]} columns        column index -> fbsIds (buildOrder asc)
 * @property {string[]} unconnectedIds   fbsIds with no in and no out edge
 * @property {string[]} criticalPathIds  longest chain by node count
 * @property {string[]} cycleIds         fbsIds that sit on a dependsOnFbsIds cycle
 * @property {number} maxDepth
 */

/**
 * Pure projection of `fbsItems[].dependsOnFbsIds` into a DAG layout.
 *
 * - A node's depth is the longest chain length from `dependsOnFbsIds` to a
 *   root (0 for an FBS that declares no dependency).
 * - Unconnected: no incoming and no outgoing edge.
 * - Critical path: longest chain by node count across the DAG (ADR-4133).
 * - Cycle members are excluded from the depth layout and surfaced as a
 *   finding by the toolbar (AC-204-6); non-cycle FBS still render.
 *
 * @param {object[]} fbsItems
 * @param {Set<string>} [buildableIds] - the actionable set from computeQueue
 * @returns {DagLayout}
 */
export function buildDagLayout(fbsItems, buildableIds) {
  const items = Array.isArray(fbsItems) ? fbsItems : [];
  const buildable = buildableIds instanceof Set ? buildableIds : new Set();
  const byId = new Map();
  for (const f of items) {
    if (!f || typeof f.fbsId !== 'string') continue;
    byId.set(f.fbsId, f);
  }

  const needsById = new Map();
  const waitsById = new Map();
  for (const f of items) {
    const id = f.fbsId;
    if (!id) continue;
    const deps = Array.isArray(f.dependsOnFbsIds) ? f.dependsOnFbsIds.filter((d) => byId.has(d)) : [];
    needsById.set(id, deps);
    if (!waitsById.has(id)) waitsById.set(id, []);
    for (const d of deps) {
      if (!waitsById.has(d)) waitsById.set(d, []);
      waitsById.get(d).push(id);
    }
  }

  const cycleIds = findCycleIds(byId, needsById);
  const cycleSet = new Set(cycleIds);

  const depth = new Map();
  function computeDepth(id, seen) {
    if (cycleSet.has(id)) return 0;
    if (depth.has(id)) return depth.get(id);
    if (seen.has(id)) return 0;
    seen.add(id);
    const deps = needsById.get(id) ?? [];
    let d = 0;
    for (const dep of deps) {
      if (cycleSet.has(dep)) continue;
      d = Math.max(d, computeDepth(dep, seen) + 1);
    }
    seen.delete(id);
    depth.set(id, d);
    return d;
  }
  for (const id of byId.keys()) {
    if (!cycleSet.has(id)) computeDepth(id, new Set());
  }

  const upstream = new Map();
  const downstream = new Map();
  for (const id of byId.keys()) {
    upstream.set(id, closure(id, needsById));
    downstream.set(id, closure(id, waitsById));
  }

  const criticalPathIds = longestChain(byId, needsById, waitsById, cycleSet);
  const criticalSet = new Set(criticalPathIds);

  const unconnectedIds = [];
  for (const id of byId.keys()) {
    if (cycleSet.has(id)) continue;
    const inDeg = (needsById.get(id) ?? []).length;
    const outDeg = (waitsById.get(id) ?? []).length;
    if (inDeg === 0 && outDeg === 0) unconnectedIds.push(id);
  }
  unconnectedIds.sort((a, b) => byBuildOrder(byId.get(a), byId.get(b)));

  let maxDepth = 0;
  for (const id of byId.keys()) {
    if (cycleSet.has(id)) continue;
    const inDeg = (needsById.get(id) ?? []).length;
    const outDeg = (waitsById.get(id) ?? []).length;
    if (inDeg === 0 && outDeg === 0) continue;
    const d = depth.get(id) ?? 0;
    if (d > maxDepth) maxDepth = d;
  }

  const columns = Array.from({ length: maxDepth + 1 }, () => []);
  for (const id of byId.keys()) {
    if (cycleSet.has(id)) continue;
    const inDeg = (needsById.get(id) ?? []).length;
    const outDeg = (waitsById.get(id) ?? []).length;
    if (inDeg === 0 && outDeg === 0) continue;
    const d = depth.get(id) ?? 0;
    columns[d].push(id);
  }
  for (const col of columns) {
    col.sort((a, b) => byBuildOrder(byId.get(a), byId.get(b)));
  }

  const nodes = new Map();
  const unconnectedSet = new Set(unconnectedIds);
  for (const [id, f] of byId.entries()) {
    const node = {
      id,
      title: typeof f.title === 'string' ? f.title : '',
      status: typeof f.executionStatus === 'string' ? f.executionStatus : '',
      domain: typeof f.domain === 'string' ? f.domain : '',
      size: typeof f.estimatedSize === 'string' ? f.estimatedSize : '',
      buildOrder: typeof f.buildOrder === 'number' ? f.buildOrder : 0,
      acCount: Array.isArray(f.acIds) ? f.acIds.length : 0,
      depth: cycleSet.has(id) ? -1 : (depth.get(id) ?? 0),
      needs: (needsById.get(id) ?? []).slice(),
      waits: (waitsById.get(id) ?? []).slice(),
      upstream: Array.from(upstream.get(id) ?? []).sort(idSort(byId)),
      downstream: Array.from(downstream.get(id) ?? []).sort(idSort(byId)),
      buildable: buildable.has(id),
      critical: criticalSet.has(id),
      unconnected: unconnectedSet.has(id),
    };
    nodes.set(id, node);
  }

  const edges = [];
  for (const [to, deps] of needsById.entries()) {
    for (const from of deps) {
      edges.push({ from, to });
    }
  }

  return { nodes, edges, columns, unconnectedIds, criticalPathIds, cycleIds, maxDepth };
}

function closure(start, edgesById) {
  const out = new Set();
  const stack = [start];
  while (stack.length > 0) {
    const cur = stack.pop();
    const next = edgesById.get(cur) ?? [];
    for (const n of next) {
      if (out.has(n)) continue;
      out.add(n);
      stack.push(n);
    }
  }
  return out;
}

function byBuildOrder(a, b) {
  const ao = a?.buildOrder ?? 0;
  const bo = b?.buildOrder ?? 0;
  if (ao !== bo) return ao - bo;
  return String(a?.fbsId ?? '').localeCompare(String(b?.fbsId ?? ''));
}

function idSort(byId) {
  return (a, b) => byBuildOrder(byId.get(a), byId.get(b));
}

function findCycleIds(byId, needsById) {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const colour = new Map();
  const onStack = new Map();
  const stack = [];
  const result = new Set();
  for (const id of byId.keys()) colour.set(id, WHITE);
  for (const start of byId.keys()) {
    if (colour.get(start) !== WHITE) continue;
    const work = [{ id: start, i: 0 }];
    colour.set(start, GREY);
    onStack.set(start, true);
    stack.push(start);
    while (work.length > 0) {
      const top = work[work.length - 1];
      const deps = needsById.get(top.id) ?? [];
      if (top.i >= deps.length) {
        colour.set(top.id, BLACK);
        onStack.delete(top.id);
        stack.pop();
        work.pop();
        continue;
      }
      const next = deps[top.i];
      top.i += 1;
      if (colour.get(next) === WHITE) {
        colour.set(next, GREY);
        onStack.set(next, true);
        stack.push(next);
        work.push({ id: next, i: 0 });
      } else if (onStack.get(next)) {
        for (let i = stack.length - 1; i >= 0; i -= 1) {
          result.add(stack[i]);
          if (stack[i] === next) break;
        }
      }
    }
  }
  return Array.from(result).sort();
}

function longestChain(byId, needsById, waitsById, cycleSet) {
  const memo = new Map();
  function longest(id) {
    if (memo.has(id)) return memo.get(id);
    const waits = (waitsById.get(id) ?? []).filter((d) => !cycleSet.has(d));
    let best = [id];
    for (const n of waits) {
      const chain = [id, ...longest(n)];
      if (chain.length > best.length) best = chain;
    }
    memo.set(id, best);
    return best;
  }
  let overall = [];
  for (const id of byId.keys()) {
    if (cycleSet.has(id)) continue;
    const deps = needsById.get(id) ?? [];
    if (deps.filter((d) => !cycleSet.has(d)).length !== 0) continue;
    const chain = longest(id);
    if (chain.length > overall.length) overall = chain;
  }
  return overall;
}

// ------------------------------------------------------------------------
// HTML render
// ------------------------------------------------------------------------

const NODE_W = 220;
const NODE_H = 40;
const COL_GAP = 68;
const ROW_GAP = 10;
const PAD = 20;
const HEADER_H = 28;
const LANE_HEAD_H = 44;

/**
 * @param {object} args
 * @param {DagLayout} args.layout
 * @param {Record<string, object>} [args.inspectorPayload] - rides on a
 *   `data-rcf-dag-inspector-data` attribute on the inspector shell (PR 1
 *   contract: component payload data on a `data-*` attribute, never an
 *   inline `<script>` body).
 * @returns {string}
 */
export function renderBuildDag({ layout, inspectorPayload }) {
  const toolbar = renderDagToolbar(layout);
  const canvas = renderDagCanvas(layout);
  const inspector = renderDagInspector(inspectorPayload);
  const legend = renderDagLegend();
  return `<div class="rcf-dag" data-rcf-dag="build">
${toolbar}
<div class="rcf-dag-grid">
  <div class="rcf-dag-canvas-wrap card" data-rcf-dag-canvas-wrap>
    ${canvas}
  </div>
  <aside class="rcf-dag-inspector card" data-rcf-dag-inspector>
    ${inspector}
  </aside>
</div>
${legend}
</div>`;
}

function renderDagToolbar(layout) {
  const uncCount = layout.unconnectedIds.length;
  const critCount = layout.criticalPathIds.length;
  const statusChips = ['notStarted', 'inProgress', 'complete', 'verified']
    .map((s) => `<button type="button" class="rcf-dag-chip" data-rcf-dag-status="${escapeHtml(s)}" aria-pressed="true">${escapeHtml(statusLabel(s))}</button>`)
    .join('');
  const domainOptions = Array.from(new Set(
    Array.from(layout.nodes.values()).map((n) => n.domain).filter((d) => typeof d === 'string' && d.length > 0),
  )).sort();
  const domainSelect = `<label class="rcf-dag-label"><span class="small muted">Area</span><select class="rcf-dag-select" data-rcf-dag-domain><option value="">All areas</option>${domainOptions.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join('')}</select></label>`;
  const toggleBuildable = `<button type="button" class="rcf-dag-chip" data-rcf-dag-toggle="buildable" aria-pressed="false">Buildable now</button>`;
  const toggleCritical = `<button type="button" class="rcf-dag-chip" data-rcf-dag-toggle="critical" aria-pressed="false">Critical path <span class="rcf-badge rcf-badge--count">${critCount}</span></button>`;
  const toggleUnconnected = `<button type="button" class="rcf-dag-chip" data-rcf-dag-toggle="unconnected" aria-pressed="false">Show unconnected <span class="rcf-badge rcf-badge--count">${uncCount}</span></button>`;
  const findings = layout.cycleIds.length > 0
    ? findingsList({
      heading: 'Dependency cycle',
      count: layout.cycleIds.length,
      items: layout.cycleIds.map((id) => ({ id, why: 'sits on a dependsOnFbsIds cycle; excluded from the depth layout', href: `#tab=build&sub=specs&entity=${id}` })),
    })
    : '';
  return `<div class="rcf-dag-toolbar" data-rcf-dag-toolbar>
  <div class="rcf-dag-toolbar-row">
    <span class="small muted">Status</span>
    ${statusChips}
    ${domainSelect}
    ${toggleBuildable}
    ${toggleCritical}
    ${toggleUnconnected}
  </div>
  ${findings ? `<div class="rcf-dag-toolbar-findings">${findings}</div>` : ''}
</div>`;
}

function statusLabel(s) {
  switch (s) {
    case 'notStarted': return 'not started';
    case 'inProgress': return 'in progress';
    default: return s;
  }
}

function renderDagCanvas(layout) {
  const positions = layoutPositions(layout);
  const connectedCols = layout.columns.length;
  const connectedHeight = positions.connectedHeight;
  const canvasW = Math.max(PAD * 2 + Math.max(1, connectedCols) * (NODE_W + COL_GAP), 900);
  let canvasH = PAD + HEADER_H + connectedHeight + PAD;

  const laneRows = [];
  if (layout.unconnectedIds.length > 0) {
    const perRow = Math.max(1, Math.floor((canvasW - PAD * 2) / (NODE_W + 12)));
    const laneTop = canvasH + 8;
    for (let i = 0; i < layout.unconnectedIds.length; i += 1) {
      const id = layout.unconnectedIds[i];
      const col = i % perRow;
      const row = Math.floor(i / perRow);
      positions.pos.set(id, {
        x: PAD + col * (NODE_W + 12),
        y: laneTop + LANE_HEAD_H + row * (NODE_H + ROW_GAP),
      });
      laneRows.push({ id, col, row });
    }
    const rows = Math.ceil(layout.unconnectedIds.length / perRow);
    canvasH = laneTop + LANE_HEAD_H + rows * (NODE_H + ROW_GAP) + PAD;
    positions.laneTop = laneTop;
  }

  const columnHeaders = layout.columns.map((_, ci) => {
    const label = ci === 0 ? 'NO DEPENDENCIES' : `DEPTH ${ci}`;
    return `<div class="rcf-dag-colhead" style="left:${PAD + ci * (NODE_W + COL_GAP)}px;top:${PAD}px;width:${NODE_W}px">${label}</div>`;
  }).join('');

  const laneHeader = layout.unconnectedIds.length > 0
    ? `<div class="rcf-dag-lane-head" data-rcf-dag-lane-head style="left:${PAD}px;top:${positions.laneTop}px;right:${PAD}px">UNCONNECTED (<span data-rcf-dag-lane-count>${layout.unconnectedIds.length}</span>): no declared dependency, nothing depends on them; ordered by buildOrder</div>`
    : '';

  const edgesSvg = renderEdges(layout, positions, canvasW, canvasH);
  const nodesHtml = renderNodes(layout, positions);

  const laneDataAttrs = layout.unconnectedIds.length > 0 ? ' data-has-unconnected="1"' : '';

  return `<div class="rcf-dag-canvas" data-rcf-dag-canvas${laneDataAttrs} style="width:${canvasW}px;height:${canvasH}px">
    ${edgesSvg}
    ${columnHeaders}
    ${laneHeader}
    ${nodesHtml}
  </div>`;
}

function layoutPositions(layout) {
  const pos = new Map();
  let maxRows = 0;
  layout.columns.forEach((col, ci) => {
    col.forEach((id, ri) => {
      pos.set(id, {
        x: PAD + ci * (NODE_W + COL_GAP),
        y: PAD + HEADER_H + ri * (NODE_H + ROW_GAP),
      });
    });
    if (col.length > maxRows) maxRows = col.length;
  });
  const connectedHeight = Math.max(0, maxRows * (NODE_H + ROW_GAP));
  return { pos, maxRows, connectedHeight, laneTop: 0 };
}

function renderEdges(layout, positions, w, h) {
  const defs = `<defs>
    <marker id="rcf-dag-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
      <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--rcf-dag-edge, currentColor)"/>
    </marker>
    <marker id="rcf-dag-arrow-up" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
      <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--sv-link)"/>
    </marker>
    <marker id="rcf-dag-arrow-down" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
      <path d="M0,0 L7,3.5 L0,7 Z" fill="var(--sv-warning)"/>
    </marker>
  </defs>`;
  const paths = layout.edges.map((e) => {
    const a = positions.pos.get(e.from);
    const b = positions.pos.get(e.to);
    if (!a || !b) return '';
    const x1 = a.x + NODE_W;
    const y1 = a.y + NODE_H / 2;
    const x2 = b.x;
    const y2 = b.y + NODE_H / 2;
    const c1x = x1 + COL_GAP / 2;
    const c2x = x2 - COL_GAP / 2;
    const d = `M${x1},${y1} C${c1x},${y1} ${c2x},${y2} ${x2},${y2}`;
    return `<path class="rcf-dag-edge" d="${d}" data-rcf-dag-edge data-from="${escapeHtml(e.from)}" data-to="${escapeHtml(e.to)}" marker-end="url(#rcf-dag-arrow)"></path>`;
  }).join('');
  return `<svg class="rcf-dag-edges" width="${w}" height="${h}" aria-hidden="true" focusable="false">
    ${defs}
    ${paths}
  </svg>`;
}

function renderNodes(layout, positions) {
  const html = [];
  for (const [id, node] of layout.nodes.entries()) {
    const p = positions.pos.get(id);
    if (!p) continue;
    const dotClass = statusDot(node.status);
    const title = `${node.id} ${node.title} (${node.status})`;
    const buildableChip = node.buildable
      ? '<span class="rcf-dag-node-tag" title="No unmet dependencies">ready</span>'
      : '';
    html.push(
      `<button type="button" class="rcf-dag-node"`
      + ` data-fbs-id="${escapeHtml(id)}"`
      + ` data-status="${escapeHtml(node.status)}"`
      + ` data-domain="${escapeHtml(node.domain)}"`
      + ` data-depth="${node.depth}"`
      + ` data-buildable="${node.buildable ? '1' : '0'}"`
      + ` data-critical="${node.critical ? '1' : '0'}"`
      + ` data-unconnected="${node.unconnected ? '1' : '0'}"`
      + ` style="left:${p.x}px;top:${p.y}px;width:${NODE_W}px;height:${NODE_H}px"`
      + ` title="${escapeHtml(title)}">`
      + `<span class="rcf-dag-node-dot ${dotClass}" aria-hidden="true"></span>`
      + `<span class="rcf-dag-node-id mono">${escapeHtml(id.replace(/^FBS-/, ''))}</span>`
      + `<span class="rcf-dag-node-title">${escapeHtml(node.title)}</span>`
      + buildableChip
      + `</button>`,
    );
  }
  return html.join('\n    ');
}

function statusDot(status) {
  if (status === 'verified' || status === 'complete') return 'rcf-dag-node-dot--ok';
  if (status === 'inProgress') return 'rcf-dag-node-dot--warn';
  return 'rcf-dag-node-dot--none';
}

function renderDagInspector(payload) {
  // PR 1 contract (standing criterion): component payload rides on a
  // `data-*` attribute on this shell, never an inline `<script>` body.
  // The client in page-init.js reads `data-rcf-dag-inspector-data`
  // directly off this element. No outbound postMessage, no fetch.
  const safeJson = JSON.stringify(payload || {}).replace(/</g, '\\u003c');
  const attr = safeJson.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return `<div class="rcf-dag-inspector-body" data-rcf-dag-inspector-body data-rcf-dag-inspector-data="${attr}">
    <div class="muted small">Select a build spec to see what it needs and what waits on it.</div>
  </div>`;
}

function renderDagLegend() {
  return `<p class="rcf-dag-legend small muted">`
    + `Columns are dependency depth (left has no declared dependency), computed from <code>dependsOnFbsIds</code>; row order inside a column is <code>buildOrder</code>. `
    + `Click a node: <span style="color:var(--sv-link)">upstream</span> outlines in link colour, <span style="color:var(--sv-warning)">downstream</span> in warning. `
    + `Specs with no dependency and no dependant sit in the unconnected lane so they do not swamp the graph.`
    + `</p>`;
}

/**
 * Build an inspector payload the client can render after a selection
 * without having to recompute the layout. One payload per selectable
 * node (including unconnected); keyed by fbsId.
 *
 * The payload lives in a <script type="application/json"> tag beside
 * the canvas so the DAG stays SSR-driven and the client wiring has no
 * other data source.
 *
 * @param {DagLayout} layout
 * @returns {Record<string, object>}
 */
export function buildDagInspectorPayload(layout) {
  const out = {};
  for (const [id, node] of layout.nodes.entries()) {
    out[id] = {
      id: node.id,
      title: node.title,
      status: node.status,
      domain: node.domain,
      size: node.size,
      buildOrder: node.buildOrder,
      acCount: node.acCount,
      buildable: node.buildable,
      critical: node.critical,
      unconnected: node.unconnected,
      needs: node.needs,
      waits: node.waits,
      needsTotal: node.upstream.length,
      waitsTotal: node.downstream.length,
      upstream: node.upstream,
      downstream: node.downstream,
      needsMeta: node.needs.map((depId) => inspectorMeta(layout, depId)),
      waitsMeta: node.waits.map((depId) => inspectorMeta(layout, depId)),
    };
  }
  return out;
}

function inspectorMeta(layout, id) {
  const n = layout.nodes.get(id);
  return {
    id,
    title: n?.title ?? '',
    status: n?.status ?? '',
  };
}


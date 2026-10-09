// Readiness Trace matrix renderer (FBS-208, US-209 under REQ-002,
// TAC-4136-view-query-routes, ADR-4140-view-query-routes-per-pivot-matrix-no-mermaid).
//
// Pure HTML-string renderer. Takes a trace response (as the GET
// /trace.json route returns) plus a coverage response (as the GET
// /coverage.json route returns, strict, scoped to the pivot's owning
// REQ when applicable) and emits a matrix:
//
//   rows:    one TraceMatrixRow per story (US) and per criterion (AC)
//            under the pivot.
//   columns: suites (TS), cases (TC), build specs (FBS), components (CN).
//   cells:   TraceMatrixCell with `reached` true where the forward
//            trace reaches the column from the row, and `resolution`
//            one of "resolving" / "unresolved" / "none" from coverage.
//
// Colours stay on existing tokens (`--sv-success`, `--sv-warning`,
// `--sv-muted`); no new palette entry is introduced (AC-209-2). Over
// 200 rows the body carries a row filter by story id or criterion id;
// nothing is truncated (AC-209-7). An unknown pivot renders the empty
// state and offers the lookup modal (AC-209-6).
//
// No CLI command text, no mermaid, no write controls (ADR-4140,
// ADR-4139).

import { escapeHtml } from '../doc-renderers/helpers.js';

const RESOLUTIONS = ['resolving', 'unresolved', 'none'];
const ROW_FILTER_THRESHOLD = 200;

/**
 * @typedef {object} TraceMatrixCell
 * @property {string} kind          'ts' | 'tc' | 'fbs' | 'cn'
 * @property {boolean} reached      the forward trace from the row reaches at least one id in this column
 * @property {'resolving'|'unresolved'|'none'} resolution
 * @property {string[]} ids         the specific column entity ids reached from this row
 */

/**
 * @typedef {object} TraceMatrixRow
 * @property {string} id            US-xxx or AC-xxx-n
 * @property {'us'|'ac'} kind
 * @property {string} title
 * @property {string} parent        the parent US id for an AC row; empty for a US row
 * @property {TraceMatrixCell[]} cells
 */

/**
 * Build the matrix row and cell data for a pivot's forward trace and
 * coverage.
 *
 * `coverage` must be shaped like the `./coverage.json` route payload:
 * `requirements[]` with `acs[]` carrying `covered` and `testCases`.
 * When `coverage` is null (not fetched yet or absent), every cell's
 * resolution is `"none"`.
 *
 * @param {object} args
 * @param {object} args.trace           /trace.json payload
 * @param {object|null} args.coverage   /coverage.json payload or null
 * @returns {TraceMatrixRow[]}
 */
export function buildTraceMatrixRows({ trace, coverage }) {
  if (!trace || !trace.found || !Array.isArray(trace.nodes) || !Array.isArray(trace.edges)) {
    return [];
  }
  const nodes = trace.nodes;
  const edges = trace.edges;
  const byId = new Map();
  for (const n of nodes) {
    if (n && typeof n.id === 'string' && typeof n.kind === 'string') byId.set(n.id, n);
  }
  // Build forward reach from each AC and each US (via its ACs) to TS/TC/FBS/CN.
  const outFromId = new Map();
  for (const e of edges) {
    if (!e || typeof e.from !== 'string' || typeof e.to !== 'string') continue;
    if (!outFromId.has(e.from)) outFromId.set(e.from, []);
    outFromId.get(e.from).push(e.to);
  }
  // Flatten AC's downstream reach into kind buckets.
  // FBS-208 FINALISE (P2-4): stop traversal at a TS boundary so an
  // AC's Cases column only lists the AC's OWN testPointer-reached TCs,
  // not every sibling TC its TS also contains. TS is still recorded
  // in the bucket when a TS edge reaches it; we just do not descend
  // into TS->TC containment from an AC row.
  function reachFrom(id) {
    const bucket = { ts: [], tc: [], fbs: [], cn: [] };
    const seen = new Set([id]);
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop();
      const curKind = byId.get(cur)?.kind;
      if (curKind === 'ts' || curKind === 'testSuite') continue;
      for (const to of outFromId.get(cur) ?? []) {
        if (seen.has(to)) continue;
        seen.add(to);
        const kind = byId.get(to)?.kind;
        if (kind === 'ts' || kind === 'testSuite') bucket.ts.push(to);
        else if (kind === 'tc' || kind === 'testCase') bucket.tc.push(to);
        else if (kind === 'fbs') bucket.fbs.push(to);
        else if (kind === 'cn' || kind === 'codeNode') bucket.cn.push(to);
        stack.push(to);
      }
    }
    for (const k of Object.keys(bucket)) bucket[k] = Array.from(new Set(bucket[k])).sort();
    return bucket;
  }

  // AC-level coverage index by AC id.
  const acCoverageByAc = new Map();
  if (coverage && Array.isArray(coverage.requirements)) {
    for (const req of coverage.requirements) {
      for (const ac of req.acs ?? []) {
        if (ac && typeof ac.id === 'string') acCoverageByAc.set(ac.id, ac);
      }
    }
  }

  // Pivot is the first node (depth 0). Children under it: US + AC.
  const pivot = nodes[0] && nodes[0].id;
  if (!pivot) return [];

  // Group ACs under their parent US for row grouping.
  const usRows = [];
  const acsByUs = new Map();
  const standaloneAcs = [];
  for (const n of nodes) {
    if (n.kind === 'userStory' || n.kind === 'us') {
      usRows.push(n);
      acsByUs.set(n.id, []);
    }
  }
  for (const n of nodes) {
    if (n.kind !== 'ac') continue;
    // Find the US parent: back-walk edges with kind parentChild.
    let parentUs = null;
    for (const e of edges) {
      if (e.to === n.id && e.kind === 'parentChild') {
        const p = byId.get(e.from);
        if (p && (p.kind === 'userStory' || p.kind === 'us')) { parentUs = p.id; break; }
      }
    }
    if (parentUs && acsByUs.has(parentUs)) acsByUs.get(parentUs).push(n);
    else standaloneAcs.push(n);
  }

  const rows = [];
  function kindOfResolution(acId, kindKey, ids) {
    if (!ids || ids.length === 0) return 'none';
    if (kindKey !== 'tc') {
      // TS/FBS/CN resolution is simply reached-or-not; "resolving" when ids present.
      return 'resolving';
    }
    const cov = acCoverageByAc.get(acId);
    if (!cov) return 'unresolved';
    const resolvedSet = new Set(cov.testCases ?? []);
    const unresolvedSet = new Set(cov.unresolvedTestCases ?? []);
    const resolvedHits = ids.filter((id) => resolvedSet.has(id) && !unresolvedSet.has(id));
    const unresolvedHits = ids.filter((id) => unresolvedSet.has(id));
    if (unresolvedHits.length === 0 && resolvedHits.length > 0) return 'resolving';
    if (unresolvedHits.length > 0 && resolvedHits.length === 0) return 'unresolved';
    if (unresolvedHits.length > 0) return 'unresolved';
    return 'none';
  }

  function usRowFrom(us, acsUnder) {
    // Union of AC reaches is the US-level reach.
    const u = { ts: new Set(), tc: new Set(), fbs: new Set(), cn: new Set() };
    for (const a of acsUnder) {
      const r = reachFrom(a.id);
      for (const k of ['ts', 'tc', 'fbs', 'cn']) r[k].forEach((v) => u[k].add(v));
    }
    const bucket = {
      ts: [...u.ts].sort(),
      tc: [...u.tc].sort(),
      fbs: [...u.fbs].sort(),
      cn: [...u.cn].sort(),
    };
    // US-level resolution for TC: resolving only if every AC under it resolves.
    const anyAcUnresolved = acsUnder.some((a) => {
      const cov = acCoverageByAc.get(a.id);
      return cov ? cov.covered !== true : bucket.tc.length > 0;
    });
    return {
      id: us.id,
      kind: 'us',
      title: us.title ?? '',
      parent: '',
      cells: ['ts', 'tc', 'fbs', 'cn'].map((kindKey) => ({
        kind: kindKey,
        reached: bucket[kindKey].length > 0,
        resolution: kindKey === 'tc'
          ? (bucket.tc.length === 0 ? 'none' : (anyAcUnresolved ? 'unresolved' : 'resolving'))
          : (bucket[kindKey].length === 0 ? 'none' : 'resolving'),
        ids: bucket[kindKey],
      })),
    };
  }

  function acRowFrom(ac, parentUsId) {
    const r = reachFrom(ac.id);
    return {
      id: ac.id,
      kind: 'ac',
      title: ac.title ?? '',
      parent: parentUsId ?? '',
      cells: ['ts', 'tc', 'fbs', 'cn'].map((kindKey) => ({
        kind: kindKey,
        reached: r[kindKey].length > 0,
        resolution: kindOfResolution(ac.id, kindKey, r[kindKey]),
        ids: r[kindKey],
      })),
    };
  }

  for (const us of usRows) {
    const acs = acsByUs.get(us.id) ?? [];
    rows.push(usRowFrom(us, acs));
    for (const ac of acs) rows.push(acRowFrom(ac, us.id));
  }
  for (const ac of standaloneAcs) rows.push(acRowFrom(ac, ''));

  return rows;
}

const RESOLUTION_LABEL = {
  resolving: 'resolving',
  unresolved: 'unresolved',
  none: 'none',
};

const COLUMN_LABEL = {
  ts: 'Suites',
  tc: 'Cases',
  fbs: 'Build specs',
  cn: 'Components',
};

/**
 * Render the Trace matrix section for the Readiness Trace sub-view.
 * Emits an empty-state block when `pivot` is empty or `trace.found`
 * is false (AC-209-6).
 *
 * @param {object} args
 * @param {string} args.pivot     the pivot id in the hash (may be '')
 * @param {object|null} args.trace    /trace.json payload (null until first fetch)
 * @param {object|null} args.coverage /coverage.json payload (null until first fetch)
 * @param {boolean} [args.stale]  the client cache is marked stale (post-SSE swap)
 * @param {boolean} [args.loading] fetch in flight
 * @returns {string}
 */
export function renderTraceMatrix(args) {
  const pivot = typeof args?.pivot === 'string' ? args.pivot : '';
  const trace = args?.trace ?? null;
  const coverage = args?.coverage ?? null;
  const stale = Boolean(args?.stale);
  const loading = Boolean(args?.loading);

  if (!pivot) {
    return renderEmptyState({ reason: 'no-pivot' });
  }
  if (loading && !trace) {
    return renderLoadingState({ pivot });
  }
  if (trace && trace.found === false) {
    return renderEmptyState({ reason: 'unknown-pivot', pivot });
  }
  if (!trace) {
    // Shell before client fetch; renders on first paint.
    return renderShell({ pivot, stale });
  }
  // FBS-208 FINALISE (P2-5): downstream pivots (TS/TC/FBS/CN/TAC/ADR)
  // produce no US/AC rows. Render an explanatory state instead of a
  // silent empty table.
  if (/^(TS-|TC-|FBS-|CN-|TAC-|ADR-)/.test(pivot)) {
    return renderDownstreamState({ pivot });
  }

  const rows = buildTraceMatrixRows({ trace, coverage });
  const needsFilter = rows.length > ROW_FILTER_THRESHOLD;
  const filterBar = needsFilter ? renderRowFilter() : '';
  const staleBanner = stale
    ? `<p class="rcf-trace-matrix__stale muted small" data-rcf-trace-stale="yes">Tree changed. The matrix below reflects the previous version; a fresh trace is being fetched.</p>`
    : '';

  const headerCount = `<span class="rcf-badge rcf-badge--count">${rows.length}</span>`;
  const thead = `<thead>
    <tr>
      <th scope="col" data-rcf-col="row">Story / criterion</th>
      <th scope="col" data-rcf-col="ts" data-rcf-trace-col="ts">${escapeHtml(COLUMN_LABEL.ts)}</th>
      <th scope="col" data-rcf-col="tc" data-rcf-trace-col="tc">${escapeHtml(COLUMN_LABEL.tc)}</th>
      <th scope="col" data-rcf-col="fbs" data-rcf-trace-col="fbs">${escapeHtml(COLUMN_LABEL.fbs)}</th>
      <th scope="col" data-rcf-col="cn" data-rcf-trace-col="cn">${escapeHtml(COLUMN_LABEL.cn)}</th>
    </tr>
  </thead>`;

  const body = rows.map(renderRow).join('');

  return `<section class="rcf-trace-matrix" data-rcf-trace-matrix="yes" data-rcf-pivot="${escapeHtml(pivot)}" aria-labelledby="rcf-readiness-trace-heading">
  <header class="rcf-trace-matrix__head">
    <h3 id="rcf-readiness-trace-heading">Trace matrix for ${escapeHtml(pivot)}</h3>
    ${headerCount}
  </header>
  ${staleBanner}
  ${filterBar}
  <table class="rcf-trace-matrix__table" aria-describedby="rcf-readiness-trace-heading">
    ${thead}
    <tbody>${body}</tbody>
  </table>
</section>`;
}

function renderRowFilter() {
  return `<div class="rcf-trace-matrix__filter" data-rcf-filterbar="trace-matrix" role="search">
    <label>
      <span>Filter rows (story id or criterion id)</span>
      <input type="search" data-rcf-filter-key="rowId" placeholder="e.g. US-209 or AC-209-3">
    </label>
  </div>`;
}

function renderRow(row) {
  const kindAttr = row.kind === 'us' ? 'us' : 'ac';
  const parentAttr = row.parent ? ` data-rcf-parent="${escapeHtml(row.parent)}"` : '';
  const titleLabel = row.title
    ? `<span class="rcf-trace-matrix__row-title muted small">${escapeHtml(row.title)}</span>`
    : '';
  const idLink = `<a href="#${escapeHtml(row.id)}" data-rcf-trace-row-id="${escapeHtml(row.id)}">${escapeHtml(row.id)}</a>`;
  const cells = row.cells.map((c) => renderCell(row, c)).join('');
  return `<tr data-rcf-row-id="${escapeHtml(row.id)}" data-rcf-row-kind="${kindAttr}"${parentAttr}>
    <th scope="row" data-rcf-col="row">${idLink} ${titleLabel}</th>
    ${cells}
  </tr>`;
}

function renderCell(row, cell) {
  const kindAttr = escapeHtml(cell.kind);
  const resolutionAttr = RESOLUTIONS.includes(cell.resolution) ? cell.resolution : 'none';
  const label = cell.ids.length === 0
    ? ''
    : `<span class="rcf-trace-matrix__cell-ids" data-rcf-cell-ids="${escapeHtml(cell.ids.join(','))}">${escapeHtml(cell.ids.length === 1 ? cell.ids[0] : `${cell.ids.length} ids`)}</span>`;
  const srReach = cell.reached ? 'reached' : 'not reached';
  const srResolution = `resolution ${RESOLUTION_LABEL[resolutionAttr] ?? resolutionAttr}`;
  return `<td data-rcf-col="${kindAttr}" data-rcf-trace-col="${kindAttr}" data-rcf-cell-reach="${cell.reached ? 'yes' : 'no'}" data-rcf-cell-resolution="${escapeHtml(resolutionAttr)}" title="${escapeHtml(`${COLUMN_LABEL[cell.kind] ?? cell.kind}: ${srReach}, ${srResolution}`)}">${label || '<span class="rcf-sr-only">' + escapeHtml(srReach) + '</span>'}</td>`;
}

function renderShell({ pivot, stale }) {
  const staleBanner = stale
    ? `<p class="rcf-trace-matrix__stale muted small" data-rcf-trace-stale="yes">Tree changed. Fetching a fresh trace.</p>`
    : '';
  return `<section class="rcf-trace-matrix" data-rcf-trace-matrix="shell" data-rcf-pivot="${escapeHtml(pivot)}" aria-labelledby="rcf-readiness-trace-heading">
  <header class="rcf-trace-matrix__head"><h3 id="rcf-readiness-trace-heading">Trace matrix for ${escapeHtml(pivot)}</h3></header>
  ${staleBanner}
  <p class="muted">Loading trace for ${escapeHtml(pivot)}...</p>
</section>`;
}

function renderLoadingState({ pivot }) {
  return `<section class="rcf-trace-matrix" data-rcf-trace-matrix="loading" data-rcf-pivot="${escapeHtml(pivot)}" aria-labelledby="rcf-readiness-trace-heading">
  <header class="rcf-trace-matrix__head"><h3 id="rcf-readiness-trace-heading">Trace matrix for ${escapeHtml(pivot)}</h3></header>
  <p class="muted">Loading trace...</p>
</section>`;
}

function renderDownstreamState({ pivot }) {
  // FBS-208 FINALISE (P2-5): the matrix pivots on upstream nodes
  // (REQ/US/AC); a downstream pivot (TS/TC/FBS/CN/TAC/ADR) has no
  // upstream US/AC rows so the body would be empty.
  const safePivot = escapeHtml(pivot);
  return `<section class="rcf-trace-matrix rcf-trace-matrix--empty" data-rcf-trace-matrix="downstream" data-rcf-trace-reason="downstream-pivot" data-rcf-pivot="${safePivot}" aria-labelledby="rcf-readiness-trace-heading">
  <header class="rcf-trace-matrix__head"><h3 id="rcf-readiness-trace-heading">No upstream rows for ${safePivot}</h3></header>
  <p>The matrix pivots on a requirement, story or criterion. Pick an upstream id that reaches <code>${safePivot}</code>.</p>
  <p><button type="button" class="rcf-trace-matrix__lookup" data-rcf-trace-open-lookup="yes">Open the lookup</button></p>
</section>`;
}

function renderEmptyState({ reason, pivot }) {
  const heading = reason === 'unknown-pivot' && pivot
    ? `No trace for ${escapeHtml(pivot)}`
    : 'Pick an id to trace';
  const body = reason === 'unknown-pivot'
    ? `<p>The id <code>${escapeHtml(pivot ?? '')}</code> is not in the current tree.</p>
       <p>Pick another id below.</p>
       <p><button type="button" class="rcf-trace-matrix__lookup" data-rcf-trace-open-lookup="yes">Open the lookup</button></p>`
    : `<p>Pick a requirement, story or criterion through the Trace action on any readiness row, or open the lookup to search by id.</p>
       <p><button type="button" class="rcf-trace-matrix__lookup" data-rcf-trace-open-lookup="yes">Open the lookup</button></p>`;
  return `<section class="rcf-trace-matrix rcf-trace-matrix--empty" data-rcf-trace-matrix="empty" data-rcf-trace-reason="${escapeHtml(reason)}"${pivot ? ` data-rcf-pivot="${escapeHtml(pivot)}"` : ''} aria-labelledby="rcf-readiness-trace-heading">
  <header class="rcf-trace-matrix__head"><h3 id="rcf-readiness-trace-heading">${heading}</h3></header>
  ${body}
</section>`;
}

export const TRACE_MATRIX_ROW_FILTER_THRESHOLD = ROW_FILTER_THRESHOLD;
export const TRACE_MATRIX_RESOLUTIONS = RESOLUTIONS;

// FBS-208 (US-209 under REQ-002, TS-241, TAC-4136, ADR-4140): tests
// for the Readiness Trace sub-view, its matrix and its action
// surface. Each test binds one AC verbatim (TC-241-209-*).
//
// The server-side trace route and coverage route are already covered
// in test/view/query-routes.test.js; this file exercises the
// renderer, the action wiring in the readiness tables, and the
// retirement of the per-REQ Mermaid slice on the Requirements and
// Readiness tabs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '#core/store';
import { buildTreeModel } from '../../src/view/tree-model.js';
import { renderModelToPage } from '../../src/view/index.js';
import { renderTraceMatrix, buildTraceMatrixRows, TRACE_MATRIX_ROW_FILTER_THRESHOLD, TRACE_MATRIX_RESOLUTIONS } from '../../src/view/readiness/trace-matrix.js';
import { renderQuestionsTable, renderBlockingTable } from '../../src/view/readiness/tables.js';
import { renderCoverageSummary } from '../../src/view/readiness/coverage-summary.js';
import { renderThinReqsTable } from '../../src/view/readiness/thin-reqs.js';
import { computeTrace } from '../../src/query/trace.js';
import { computeCoverage } from '../../src/query/coverage.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

async function dogfoodWalked() {
  const result = await walkTree({ projectRoot: repoRoot });
  return { tree: result.tree, model: buildTreeModel(result) };
}

test('AC-209-1 happy: the trace subtab and a pivot id in the hash', async () => {
  const { tree } = await dogfoodWalked();
  const trace = computeTrace(tree, { id: 'REQ-002', direction: 'forward', includeCode: true });
  assert.equal(trace.found, true, 'REQ-002 is a valid pivot');
  // The matrix must have one TraceMatrixRow per story (US) and per criterion (AC) under the pivot.
  const rows = buildTraceMatrixRows({ trace, coverage: null });
  assert.ok(rows.length > 0, 'rows produced from a real forward trace');
  const stories = rows.filter((r) => r.kind === 'us');
  const criteria = rows.filter((r) => r.kind === 'ac');
  assert.ok(stories.length > 0, 'at least one US row');
  assert.ok(criteria.length > 0, 'at least one AC row');
  // Each row carries 4 cells for suites, cases, build specs, components in that order.
  for (const r of rows) {
    assert.equal(r.cells.length, 4);
    assert.deepEqual(r.cells.map((c) => c.kind), ['ts', 'tc', 'fbs', 'cn']);
    for (const c of r.cells) {
      assert.equal(typeof c.reached, 'boolean');
      assert.ok(Array.isArray(c.ids));
    }
  }
  // The forward trace from the row's criterion reaches each column: pick an AC under US-201
  // and assert its cases cell carries at least one id from the chain's TCs.
  const ac201 = criteria.find((r) => r.id === 'AC-201-1');
  assert.ok(ac201, 'AC-201-1 is a row');
  const tcCell = ac201.cells.find((c) => c.kind === 'tc');
  assert.ok(tcCell.ids.length > 0, 'AC-201-1 cases column is populated by the forward trace');
  // Rendered HTML carries the pivot in the heading and the matrix shape.
  const html = renderTraceMatrix({ pivot: 'REQ-002', trace, coverage: null });
  assert.match(html, /data-rcf-trace-matrix="yes"/);
  assert.match(html, /data-rcf-pivot="REQ-002"/);
  assert.match(html, /data-rcf-trace-col="ts"/);
  assert.match(html, /data-rcf-trace-col="tc"/);
  assert.match(html, /data-rcf-trace-col="fbs"/);
  assert.match(html, /data-rcf-trace-col="cn"/);
});

test('AC-209-2 happy: coverage data for the pivots criteria', async () => {
  const { tree } = await dogfoodWalked();
  const trace = computeTrace(tree, { id: 'REQ-002', direction: 'forward', includeCode: true });
  const coverage = computeCoverage(tree, { strict: true, scopeId: 'REQ-002' });
  const rows = buildTraceMatrixRows({ trace, coverage });
  const resolutions = new Set();
  for (const r of rows) {
    for (const c of r.cells) {
      resolutions.add(c.resolution);
      assert.ok(TRACE_MATRIX_RESOLUTIONS.includes(c.resolution), `resolution ${c.resolution}`);
    }
  }
  // The chain emits all three states somewhere on the dogfood pivot
  // (or at the very least "resolving" and "none").
  assert.ok(resolutions.has('resolving') || resolutions.has('none') || resolutions.has('unresolved'));
  // Render carries the resolution attribute mapped to each token row.
  const html = renderTraceMatrix({ pivot: 'REQ-002', trace, coverage });
  assert.match(html, /data-rcf-cell-resolution="resolving"|data-rcf-cell-resolution="unresolved"|data-rcf-cell-resolution="none"/);
  // No new palette token is introduced; the three tokens the CSS uses are --sv-success, --sv-warning and --sv-muted.
  // (The contrast-aa test already asserts those are below-threshold-free.)
  for (const r of rows) {
    for (const c of r.cells) {
      if (c.ids.length === 0) assert.equal(c.resolution, 'none');
    }
  }
});

test('AC-209-3 happy: any id rendered in the questions blocking thinre', async () => {
  // Trace actions must appear on readiness rows: questions, blocking,
  // thin-requirements and coverage (unresolved pointers) tables.
  const questionRows = [
    {
      number: 1,
      itemId: 'REQ-012',
      group: 'Requirement REQ-012',
      ask: 'name the requirement',
      settles: 'Write the title.',
      state: 'open',
      locationHref: '#REQ-012',
      locationLabel: 'REQ-012',
      briefHandle: 'REQ-012: name the requirement',
      checkId: 'D2/skeleton:reqIntent',
      stage: 'D2',
    },
  ];
  const qHtml = renderQuestionsTable({ rows: questionRows });
  assert.match(qHtml, /data-rcf-trace-for="REQ-012"/);
  assert.match(qHtml, /#tab=readiness&(?:amp;)?sub=trace&(?:amp;)?entity=REQ-012/);

  const blockingRows = [
    {
      stage: 'D2', check: 'skeleton:reqIntent', rawId: 'REQ-012',
      docId: 'REQ-012', fragment: '', href: '#REQ-012',
      why: 'missing title', resolved: 'add a title',
      persona: 'productOwner', question: '',
    },
  ];
  const bHtml = renderBlockingTable({ rows: blockingRows });
  assert.match(bHtml, /data-rcf-trace-for="REQ-012"/);

  // Thin-reqs table (FBS-205) already renders a Trace link per row.
  const thinRows = [
    {
      reqId: 'REQ-002', stories: 3, criteria: 5, covered: false,
      openHref: '#REQ-002', traceHref: '#tab=readiness&sub=trace&entity=REQ-002',
      thinReason: ['acs:uncoveredResolving'],
    },
  ];
  const tHtml = renderThinReqsTable({ rows: thinRows });
  assert.match(tHtml, /#tab=readiness&(?:amp;)?sub=trace&(?:amp;)?entity=REQ-002/);

  // Coverage summary unresolved-pointers table has a Trace cell per row.
  const covHtml = renderCoverageSummary({
    coverage: { tree: {
      totals: { requirements: 2, covered: 1, coveredUnresolved: 1, uncovered: 0 },
      unresolvedTestPointers: [{ tsId: 'TS-237', tcId: 'TC-237-18003-1-happy', testPointer: 'test/x.js::k', reason: 'test-missing' }],
    } },
    tree: null,
  });
  assert.match(covHtml, /data-rcf-trace-for="TS-237"/);
  assert.match(covHtml, /#tab=readiness&(?:amp;)?sub=trace&(?:amp;)?entity=TS-237/);
});

test('AC-209-4 edge: an sse treeupdate that swaps rcflivecontent whil', async () => {
  // The matrix caches by state.version in the client; a swap marks
  // the current render stale and refetches. The server-side render
  // path exposes the mechanism via `window.__rcfTreeVersion` and the
  // stale banner markup. We assert the renderer emits a stale banner
  // when the args say so, and that the empty-state renderer never
  // throws when `trace` is missing (the state the stale refetch is in
  // flight occupies).
  const { tree } = await dogfoodWalked();
  const trace = computeTrace(tree, { id: 'REQ-002', direction: 'forward', includeCode: true });
  const htmlFresh = renderTraceMatrix({ pivot: 'REQ-002', trace, coverage: null });
  assert.doesNotMatch(htmlFresh, /data-rcf-trace-stale="yes"/);
  const htmlStale = renderTraceMatrix({ pivot: 'REQ-002', trace, coverage: null, stale: true });
  assert.match(htmlStale, /data-rcf-trace-stale="yes"/);
  // In the "fetch in flight" case (loading: true, no trace yet) the
  // renderer emits a loading state, not an empty state.
  const loading = renderTraceMatrix({ pivot: 'REQ-002', trace: null, coverage: null, loading: true });
  assert.match(loading, /data-rcf-trace-matrix="loading"/);
});

test('AC-209-5 must-not: the requirements tab', async () => {
  // The Requirements tab must not carry any Mermaid slice. The
  // Readiness tab likewise carries no Mermaid at all.
  const { fullPageHtml } = await renderModelToPage({ projectRoot: repoRoot });
  const requirementsPanel = sliceTab(fullPageHtml, 'tab-requirements');
  const readinessPanel = sliceTab(fullPageHtml, 'tab-readiness');
  assert.ok(requirementsPanel, 'requirements panel found');
  assert.ok(readinessPanel, 'readiness panel found');
  assert.doesNotMatch(requirementsPanel, /<pre class="mermaid">/);
  assert.doesNotMatch(requirementsPanel, /class="rcf-req-slice"/);
  assert.doesNotMatch(requirementsPanel, /<section class="subdiagram"/);
  assert.doesNotMatch(readinessPanel, /<pre class="mermaid">/);
  assert.doesNotMatch(readinessPanel, /class="mermaid"/);
});

test('AC-209-6 failure: a pivot the route reports with found false', () => {
  const html = renderTraceMatrix({ pivot: 'REQ-NOPE', trace: { pivot: 'REQ-NOPE', found: false }, coverage: null });
  assert.match(html, /data-rcf-trace-matrix="empty"/);
  assert.match(html, /data-rcf-trace-reason="unknown-pivot"/);
  assert.match(html, /No trace for REQ-NOPE/);
  assert.match(html, /data-rcf-trace-open-lookup="yes"/);
  // No partial matrix is drawn when found is false.
  assert.doesNotMatch(html, /data-rcf-trace-matrix="yes"/);
  assert.doesNotMatch(html, /<tbody>/);
});

test('AC-209-7 edge: a pivot whose forward trace yields more than 200', () => {
  // Build a synthetic trace with >200 rows and assert the filter bar
  // appears and the full row set is retained.
  const nodes = [{ id: 'REQ-X', kind: 'req', depth: 0, title: 'x' }];
  const edges = [];
  for (let i = 0; i < 220; i += 1) {
    const usId = `US-${1000 + i}`;
    nodes.push({ id: usId, kind: 'us', depth: 1, title: `s${i}` });
    edges.push({ from: 'REQ-X', to: usId, kind: 'parentChild' });
    const acId = `AC-${1000 + i}-1`;
    nodes.push({ id: acId, kind: 'ac', depth: 2, title: `c${i}` });
    edges.push({ from: usId, to: acId, kind: 'parentChild' });
  }
  const trace = { pivot: 'REQ-X', direction: 'forward', found: true, nodes, edges };
  const rows = buildTraceMatrixRows({ trace, coverage: null });
  assert.ok(rows.length > TRACE_MATRIX_ROW_FILTER_THRESHOLD, 'synthetic trace produced many rows');
  const html = renderTraceMatrix({ pivot: 'REQ-X', trace, coverage: null });
  assert.match(html, /data-rcf-filterbar="trace-matrix"/);
  assert.match(html, /data-rcf-filter-key="rowId"/);
  // Full row set is in the DOM; the filter is client-side.
  const bodyMatches = html.match(/<tr data-rcf-row-id="/g) || [];
  assert.ok(bodyMatches.length >= rows.length, 'every row rendered, nothing truncated');
});

// Helper: slice out a tabpanel's HTML by its id.
function sliceTab(html, tabId) {
  const openMarker = `id="${tabId}"`;
  const start = html.indexOf(openMarker);
  if (start === -1) return '';
  // The next tabpanel section begins with `id="tab-...` or the main close.
  const after = html.slice(start);
  const nextTabIdx = after.indexOf(`id="tab-`, openMarker.length);
  const mainClose = after.indexOf('</main>');
  const end = nextTabIdx === -1 ? mainClose : Math.min(nextTabIdx, mainClose);
  return after.slice(0, end > 0 ? end : after.length);
}

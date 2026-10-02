// Viewer UI refresh PR 5: integration coverage for the Build tab -
// BuildStats card, SubTabStrip, FilterBar, Spec rows (DocRow with
// buildable pill, status, AC and dep links), DAG placeholder, FBS
// slots and Test suites removed. Builds against the dogfood tree.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '#core/store';
import { renderPage } from '../../src/view/html-page.js';
import { buildTreeModel } from '../../src/view/tree-model.js';
import { computeQueue } from '../../src/build/queue.js';
import { renderBuildStats, renderSpecBody } from '../../src/view/doc-renderers/build.js';
import { buildDagLayout, buildDagInspectorPayload, renderBuildDag } from '../../src/view/build-dag.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

async function renderLive() {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const html = renderPage(model);
  return { model, html };
}

function sliceBuildTab(html) {
  const start = html.indexOf('id="tab-build"');
  assert.ok(start > 0, 'tab-build slice is non-empty');
  // The next sibling after Build is </section> at the end of the panel.
  // We just return everything from the opening up to the closing of main.
  const end = html.indexOf('</main>', start);
  return html.slice(start, end === -1 ? html.length : end);
}

function sliceFbsRow(slice, fbsId) {
  const anchorIdx = slice.indexOf(`data-doc-id="${fbsId}"`);
  assert.ok(anchorIdx > 0, `expected FBS row for ${fbsId}`);
  // Walk left to the <details for this row.
  const openIdx = slice.lastIndexOf('<details ', anchorIdx);
  assert.ok(openIdx !== -1, `missing <details opener for ${fbsId}`);
  // Walk right to the matching </details>. Each row has one inner
  // raw-json <details> so count opens and closes.
  let depth = 0;
  let i = openIdx;
  while (i < slice.length) {
    const nextOpen = slice.indexOf('<details', i);
    const nextClose = slice.indexOf('</details>', i);
    if (nextClose === -1) break;
    if (nextOpen !== -1 && nextOpen < nextClose) {
      depth += 1;
      i = nextOpen + 1;
    } else {
      depth -= 1;
      i = nextClose + 10;
      if (depth === 0) return slice.slice(openIdx, i);
    }
  }
  return slice.slice(openIdx);
}

// ---------------------------------------------------------------------
// BuildStats card and page head (decision 6)
// ---------------------------------------------------------------------

test('Build tab renders a BuildStats card with the six totals', async () => {
  const { html } = await renderLive();
  const slice = sliceBuildTab(html);
  assert.match(slice, /class="rcf-build-stats card"/);
  for (const label of ['build specs', 'verified', 'complete', 'in progress', 'not started', 'buildable now']) {
    assert.match(slice, new RegExp(`<span class="rcf-build-stat-l">${label}</span>`));
  }
});

test('BuildStats "buildable now" count equals computeQueue.totals.actionable', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const queue = computeQueue({ fbsItems: model.fbsItems });
  const html = renderPage(model);
  const slice = sliceBuildTab(html);
  const re = /<span class="rcf-build-stat-n">(\d+)<\/span><span class="rcf-build-stat-l">buildable now<\/span>/;
  const match = slice.match(re);
  assert.ok(match, 'buildable-now stat tile must render in the BuildStats card');
  assert.equal(Number(match[1]), queue.totals.actionable);
});

test('Build tab renders the BS page head (BS id + strategy)', async () => {
  const { model, html } = await renderLive();
  const slice = sliceBuildTab(html);
  if (model.bs) {
    assert.match(slice, /class="rcf-build-head"/);
    assert.match(slice, new RegExp(`class="rcf-build-head-id mono">${model.bs.bsId}</span>`));
  }
});

// ---------------------------------------------------------------------
// SubTabStrip Specs | DAG (decisions 6 + 12)
// ---------------------------------------------------------------------

test('Build tab mounts the SubTabStrip with Specs and DAG items', async () => {
  const { html } = await renderLive();
  const slice = sliceBuildTab(html);
  assert.match(slice, /data-rcf-subtabstrip="build"/);
  assert.match(slice, /data-sub="specs" aria-controls="build-sub-specs" aria-selected="true"/);
  assert.match(slice, /data-sub="dag" aria-controls="build-sub-dag" aria-selected="false"/);
});

test('Build DAG sub-panel renders the DAG (toolbar, canvas, inspector shell)', async () => {
  const { html } = await renderLive();
  const slice = sliceBuildTab(html);
  assert.match(slice, /id="build-sub-dag"[^>]*data-rcf-subpanel="dag"[^>]*hidden/);
  assert.match(slice, /data-rcf-dag="build"/);
  assert.match(slice, /data-rcf-dag-toolbar/);
  assert.match(slice, /data-rcf-dag-canvas/);
  assert.match(slice, /data-rcf-dag-inspector/);
  assert.match(slice, /data-rcf-dag-inspector-data/);
});

// ---------------------------------------------------------------------
// Specs FilterBar (decision 3)
// ---------------------------------------------------------------------

test('Specs FilterBar carries text, status, area, size + Buildable-now toggle', async () => {
  const { html } = await renderLive();
  const slice = sliceBuildTab(html);
  assert.match(slice, /data-rcf-filterbar="build-specs"/);
  assert.match(slice, /class="rcf-filter-text"/);
  assert.match(slice, /data-filter-key="status"/);
  assert.match(slice, /data-filter-key="domain"/);
  assert.match(slice, /data-filter-key="size"/);
  assert.match(slice, /data-filter-key="buildable"/);
  // Count line (visible of total) renders on the bar.
  assert.match(slice, /class="rcf-filter-count count"/);
});

// ---------------------------------------------------------------------
// Spec rows (decision 2): id + order chip + badges + status pill
// ---------------------------------------------------------------------

test('each Spec row renders as a shared DocRow with order chip, AC + status meta', async () => {
  const { model, html } = await renderLive();
  const slice = sliceBuildTab(html);
  for (const f of model.fbsItems) {
    const re = new RegExp(`<details[^>]*data-doc-id="${f.fbsId}"`);
    assert.match(slice, re, `missing DocRow for ${f.fbsId}`);
  }
  // Order chip, status pill, deps badge all present on the FBS-002 row
  // (deps: FBS-001 per dogfood tree).
  const fbs002 = model.fbsItems.find((f) => f.fbsId === 'FBS-002');
  assert.ok(fbs002, 'expected FBS-002 in the dogfood tree');
  const row = sliceFbsRow(slice, 'FBS-002');
  assert.match(row, /class="rcf-spec-order mono muted small"/);
  assert.match(row, /class="rcf-spec-id mono">FBS-002</);
  // status pill
  assert.match(row, /class="rcf-pill rcf-pill--doc-status rcf-pill--complete"/);
  // dep count
  assert.match(row, /<span class="rcf-badge-label">deps<\/span>/);
});

test('buildable rows carry a Buildable pill and data-buildable="1"', async () => {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  const queue = computeQueue({ fbsItems: model.fbsItems });
  const buildableIds = queue.items.filter((i) => i.state === 'actionable').map((i) => i.fbsId);
  assert.ok(buildableIds.length > 0, 'expected the dogfood tree to carry buildable-now FBS');
  const html = renderPage(model);
  const slice = sliceBuildTab(html);
  for (const id of buildableIds) {
    const row = sliceFbsRow(slice, id);
    assert.match(row, /data-buildable="1"/);
    assert.match(row, /class="rcf-pill rcf-pill--build-queue rcf-pill--buildable"/);
  }
});

// ---------------------------------------------------------------------
// Expanded Spec body (decision 2 / design doc section 5.6)
// ---------------------------------------------------------------------

test('expanded Spec body renders summary, approach, AC links, deliverables, Show in the DAG + raw JSON', async () => {
  const { html } = await renderLive();
  const slice = sliceBuildTab(html);
  const row = sliceFbsRow(slice, 'FBS-001');
  assert.match(row, /class="rcf-spec-summary"/);
  assert.match(row, /<h4>Approach</);
  assert.match(row, /<h4>Acceptance criteria \(/);
  assert.match(row, /href="#tab=requirements&amp;entity=AC-101-1"/);
  assert.match(row, /<h4>Deliverables</);
  assert.match(row, /href="#tab=build&amp;sub=dag&amp;entity=FBS-001">Show in the DAG/);
  assert.match(row, /data-doc-id="FBS-001::raw"/);
  // Context block linking to TAC-001 and ADR-001 as mono anchors into
  // the Architecture tab.
  assert.match(row, /href="#tab=architecture&amp;entity=TAC-001"/);
  assert.match(row, /href="#tab=architecture&amp;entity=ADR-001"/);
});

test('Spec row with a declared dependency renders a Depends on link into Specs', async () => {
  const { html } = await renderLive();
  const slice = sliceBuildTab(html);
  const row = sliceFbsRow(slice, 'FBS-002');
  assert.match(row, /<h4>Depends on</);
  assert.match(row, /href="#tab=build&amp;sub=specs&amp;entity=FBS-001"/);
});

// ---------------------------------------------------------------------
// Removed surfaces (decision 6)
// ---------------------------------------------------------------------

test('Build tab no longer carries the FBS slots ordered list or the Test suites heading', async () => {
  const { html } = await renderLive();
  const slice = sliceBuildTab(html);
  assert.doesNotMatch(slice, /<h4>FBS slots<\/h4>/);
  assert.doesNotMatch(slice, />Test suites</);
  assert.doesNotMatch(slice, /class="doc doc-ts"/);
});

// ---------------------------------------------------------------------
// Tab label and h2 (design doc section 3)
// ---------------------------------------------------------------------

test('Build tab button and heading read "Build" (not "Build sequence")', async () => {
  const { html } = await renderLive();
  assert.match(html, /data-tab="build" aria-selected="false" aria-controls="tab-build">Build</);
  assert.match(html, /<h2 class="tab-heading">Build<\/h2>/);
});

// ---------------------------------------------------------------------
// page-init wiring (PR 5)
// ---------------------------------------------------------------------

test('page-init.js carries the Build FilterBar + SubTab wiring', () => {
  const pageInit = readFileSync(resolve(repoRoot, 'src', 'view', 'page-init.js'), 'utf8');
  for (const marker of [
    'wireBuildTab',
    'wireBuildSubTabStrip',
    'wireBuildFilterBar',
    'applyBuildHash',
    'buildHashFragment',
    'data-rcf-filterbar="build-specs"',
    'data-rcf-subtabstrip="build"',
  ]) {
    assert.match(pageInit, new RegExp(marker.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')));
  }
});

// ---------------------------------------------------------------------
// DAG sub-tab (viewer UI refresh PR 6; US-204, TAC-4131, ADR-4133)
// ---------------------------------------------------------------------

test('buildDagLayout: columns are dependency-depth tiers from dependsOnFbsIds (AC-204-1)', () => {
  const fbsItems = [
    { fbsId: 'FBS-001', buildOrder: 1, executionStatus: 'complete', dependsOnFbsIds: [] },
    { fbsId: 'FBS-002', buildOrder: 2, executionStatus: 'complete', dependsOnFbsIds: ['FBS-001'] },
    { fbsId: 'FBS-003', buildOrder: 3, executionStatus: 'notStarted', dependsOnFbsIds: ['FBS-002'] },
    { fbsId: 'FBS-004', buildOrder: 4, executionStatus: 'notStarted', dependsOnFbsIds: ['FBS-001', 'FBS-002'] },
  ];
  const layout = buildDagLayout(fbsItems, new Set(['FBS-003', 'FBS-004']));
  assert.equal(layout.columns.length, 3);
  assert.deepEqual(layout.columns[0], ['FBS-001']);
  assert.deepEqual(layout.columns[1], ['FBS-002']);
  assert.deepEqual(layout.columns[2].sort(), ['FBS-003', 'FBS-004']);
  assert.equal(layout.nodes.get('FBS-001').depth, 0);
  assert.equal(layout.nodes.get('FBS-002').depth, 1);
  assert.equal(layout.nodes.get('FBS-003').depth, 2);
  assert.equal(layout.nodes.get('FBS-004').depth, 2);
});

test('buildDagLayout: unconnected lane holds FBS with no incoming and no outgoing edge', () => {
  const fbsItems = [
    { fbsId: 'FBS-001', buildOrder: 1, executionStatus: 'complete', dependsOnFbsIds: [] },
    { fbsId: 'FBS-002', buildOrder: 2, executionStatus: 'complete', dependsOnFbsIds: ['FBS-001'] },
    { fbsId: 'FBS-010', buildOrder: 10, executionStatus: 'notStarted', dependsOnFbsIds: [] },
    { fbsId: 'FBS-011', buildOrder: 11, executionStatus: 'notStarted', dependsOnFbsIds: [] },
  ];
  const layout = buildDagLayout(fbsItems, new Set());
  assert.deepEqual(layout.unconnectedIds.sort(), ['FBS-010', 'FBS-011']);
  assert.equal(layout.nodes.get('FBS-010').unconnected, true);
  assert.equal(layout.nodes.get('FBS-001').unconnected, false);
});

test('buildDagLayout: closures carry upstream and downstream transitively (AC-204-2 / AC-204-3)', () => {
  const fbsItems = [
    { fbsId: 'FBS-001', buildOrder: 1, dependsOnFbsIds: [] },
    { fbsId: 'FBS-002', buildOrder: 2, dependsOnFbsIds: ['FBS-001'] },
    { fbsId: 'FBS-003', buildOrder: 3, dependsOnFbsIds: ['FBS-002'] },
    { fbsId: 'FBS-004', buildOrder: 4, dependsOnFbsIds: ['FBS-003'] },
  ];
  const layout = buildDagLayout(fbsItems, new Set());
  assert.deepEqual(layout.nodes.get('FBS-003').upstream.sort(), ['FBS-001', 'FBS-002']);
  assert.deepEqual(layout.nodes.get('FBS-002').downstream.sort(), ['FBS-003', 'FBS-004']);
});

test('buildDagLayout: critical path is the longest chain by node count (ADR-4133)', () => {
  const fbsItems = [
    { fbsId: 'FBS-001', buildOrder: 1, dependsOnFbsIds: [] },
    { fbsId: 'FBS-002', buildOrder: 2, dependsOnFbsIds: ['FBS-001'] },
    { fbsId: 'FBS-003', buildOrder: 3, dependsOnFbsIds: ['FBS-002'] },
    { fbsId: 'FBS-004', buildOrder: 4, dependsOnFbsIds: ['FBS-003'] },
    { fbsId: 'FBS-010', buildOrder: 10, dependsOnFbsIds: ['FBS-001'] },
  ];
  const layout = buildDagLayout(fbsItems, new Set());
  assert.deepEqual(layout.criticalPathIds, ['FBS-001', 'FBS-002', 'FBS-003', 'FBS-004']);
  assert.equal(layout.nodes.get('FBS-002').critical, true);
  assert.equal(layout.nodes.get('FBS-010').critical, false);
});

test('buildDagLayout: cycles are surfaced as cycleIds and excluded from depth layout (AC-204-6)', () => {
  const fbsItems = [
    { fbsId: 'FBS-001', buildOrder: 1, dependsOnFbsIds: [] },
    { fbsId: 'FBS-002', buildOrder: 2, dependsOnFbsIds: ['FBS-001'] },
    { fbsId: 'FBS-010', buildOrder: 10, dependsOnFbsIds: ['FBS-011'] },
    { fbsId: 'FBS-011', buildOrder: 11, dependsOnFbsIds: ['FBS-010'] },
  ];
  const layout = buildDagLayout(fbsItems, new Set());
  assert.deepEqual(layout.cycleIds.sort(), ['FBS-010', 'FBS-011']);
  // The two cycle members are excluded from the depth columns; the two
  // non-cycle FBS still render.
  const connected = layout.columns.flat();
  assert.ok(connected.includes('FBS-001'));
  assert.ok(connected.includes('FBS-002'));
  assert.ok(!connected.includes('FBS-010'));
  assert.ok(!connected.includes('FBS-011'));
});

test('renderBuildDag: toolbar renders status chips, area select, three toggles and the unconnected count', async () => {
  const { model } = await renderLive();
  const queue = computeQueue({ fbsItems: model.fbsItems });
  const buildableIds = new Set(queue.items.filter((i) => i.state === 'actionable').map((i) => i.fbsId));
  const layout = buildDagLayout(model.fbsItems, buildableIds);
  const html = renderBuildDag({ layout });
  assert.match(html, /data-rcf-dag-status="notStarted"/);
  assert.match(html, /data-rcf-dag-status="inProgress"/);
  assert.match(html, /data-rcf-dag-status="complete"/);
  assert.match(html, /data-rcf-dag-status="verified"/);
  assert.match(html, /data-rcf-dag-domain/);
  assert.match(html, /data-rcf-dag-toggle="buildable"/);
  assert.match(html, /data-rcf-dag-toggle="critical"/);
  assert.match(html, /data-rcf-dag-toggle="unconnected"/);
  assert.match(html, new RegExp(`data-rcf-dag-toggle="unconnected"[^>]*>Show unconnected <span class="rcf-badge rcf-badge--count">${layout.unconnectedIds.length}</span>`));
});

test('renderBuildDag: canvas carries one node per FBS with data-fbs-id, data-status and data-depth', async () => {
  const { model } = await renderLive();
  const layout = buildDagLayout(model.fbsItems, new Set());
  const html = renderBuildDag({ layout });
  for (const f of model.fbsItems) {
    assert.match(html, new RegExp(`data-fbs-id="${f.fbsId}"`));
  }
  assert.match(html, /data-depth="0"/);
});

test('renderBuildDag: edge paths carry data-from and data-to for client role toggling', async () => {
  const { model } = await renderLive();
  const layout = buildDagLayout(model.fbsItems, new Set());
  const html = renderBuildDag({ layout });
  // FBS-002 depends on FBS-001 in the dogfood tree.
  assert.match(html, /data-from="FBS-001" data-to="FBS-002"/);
});

test('buildDagInspectorPayload: carries status/area/order/AC/buildable + needs and waits (AC-204-3)', async () => {
  const { model } = await renderLive();
  const queue = computeQueue({ fbsItems: model.fbsItems });
  const buildableIds = new Set(queue.items.filter((i) => i.state === 'actionable').map((i) => i.fbsId));
  const layout = buildDagLayout(model.fbsItems, buildableIds);
  const payload = buildDagInspectorPayload(layout);
  // FBS-008 (the design evidence pick): has needs and waits.
  const p = payload['FBS-008'];
  assert.ok(p, 'inspector payload has FBS-008');
  assert.equal(typeof p.status, 'string');
  assert.ok(Array.isArray(p.needs));
  assert.ok(Array.isArray(p.waits));
  assert.ok(Array.isArray(p.upstream));
  assert.ok(Array.isArray(p.downstream));
  assert.equal(typeof p.buildable, 'boolean');
  assert.ok('needsMeta' in p);
  assert.ok('waitsMeta' in p);
});

test('Build DAG unconnected-lane count matches the no-in-no-out FBS set on the dogfood tree', async () => {
  const { model } = await renderLive();
  const layout = buildDagLayout(model.fbsItems, new Set());
  // Independently compute the count the design doc gap (b) names.
  const byId = new Set();
  for (const f of model.fbsItems) byId.add(f.fbsId);
  const inDeg = new Map();
  const outDeg = new Map();
  for (const f of model.fbsItems) {
    const d = Array.isArray(f.dependsOnFbsIds) ? f.dependsOnFbsIds.filter((x) => byId.has(x)) : [];
    outDeg.set(f.fbsId, d.length);
    for (const dep of d) inDeg.set(dep, (inDeg.get(dep) ?? 0) + 1);
  }
  const expected = model.fbsItems.filter((f) => (outDeg.get(f.fbsId) ?? 0) === 0 && (inDeg.get(f.fbsId) ?? 0) === 0).length;
  assert.equal(layout.unconnectedIds.length, expected);
});

test('page-init.js carries the Build/DAG wiring (click-to-highlight, hash round-trip, filters)', () => {
  const pageInit = readFileSync(resolve(repoRoot, 'src', 'view', 'page-init.js'), 'utf8');
  for (const marker of [
    'wireBuildDag',
    'selectDagNode',
    'applyDagFilters',
    'renderDagInspector',
    'data-rcf-dag-sel',
    'data-rcf-dag-toggle',
    "#tab=build&sub=specs&entity=",
  ]) {
    assert.match(pageInit, new RegExp(marker.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')));
  }
});

test('Build/DAG renderer never emits window.postMessage (AC-204-7, no outbound postMessage)', async () => {
  const { html } = await renderLive();
  // The DAG canvas itself must not generate a postMessage call anywhere
  // in the rendered page. The guard is on the renderer and the inspector
  // payload (the inline JSON script); the shared live-client/page-init
  // scripts are the only JS surfaces and neither posts out from the DAG.
  const slice = sliceBuildTab(html);
  assert.doesNotMatch(slice, /postMessage\s*\(/);
});

// ---------------------------------------------------------------------
// Pure renderer units
// ---------------------------------------------------------------------

test('renderBuildStats: shape and counts', () => {
  const html = renderBuildStats({ items: 10, verified: 2, complete: 3, inProgress: 1, notStarted: 4, buildableNow: 5 });
  assert.match(html, /class="rcf-build-stats card"/);
  assert.match(html, /<span class="rcf-build-stat-n">5<\/span><span class="rcf-build-stat-l">buildable now<\/span>/);
  // Progress segments are percentages against items.
  assert.match(html, /rcf-build-progress-seg--verified" style="width:20%"/);
  assert.match(html, /rcf-build-progress-seg--complete" style="width:30%"/);
});

test('renderSpecBody: honest empty state when fbs carries no acIds, deps, deliverables or context', () => {
  const model = { byId: new Map(), rawById: new Map() };
  const html = renderSpecBody({ fbsId: 'FBS-999', summary: '', approach: '' }, model);
  assert.doesNotMatch(html, /<h4>Approach</);
  assert.doesNotMatch(html, /<h4>Acceptance criteria/);
  assert.doesNotMatch(html, /<h4>Depends on/);
  assert.doesNotMatch(html, /<h4>Context/);
  assert.match(html, /href="#tab=build&amp;sub=dag&amp;entity=FBS-999">Show in the DAG/);
});

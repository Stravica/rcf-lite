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

test('Build DAG sub-panel is an empty state naming PR 6', async () => {
  const { html } = await renderLive();
  const slice = sliceBuildTab(html);
  assert.match(slice, /id="build-sub-dag"[^>]*data-rcf-subpanel="dag"[^>]*hidden/);
  assert.match(slice, /DAG lands in viewer UI refresh PR 6/);
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

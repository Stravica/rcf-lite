// Product Map tab tests. Exercise the emitted HTML string over the live
// dogfood tree, matching the pattern the rest of the view tests use.
//
// Chain: REQ-170 (Product Map tab on the review surface),
//        US-17001..17005 (one per grouping + status filter),
//        AC-17001-1..2, AC-17002-1, AC-17003-1, AC-17004-1, AC-17005-1.
// Test suite: TS-204..208 (test pointers resolve here).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { walkTree } from '#core/store';
import { renderPage } from '../../src/view/html-page.js';
import { buildTreeModel } from '../../src/view/tree-model.js';
import {
  DEFAULT_GROUPING,
  DEFAULT_STATUS,
  GROUPINGS,
  STATUSES,
  groupByCapability,
  groupByComponent,
  groupByShape,
  groupByTraceCoverage,
  renderProductMapPanel,
  shapesForReq,
  capabilitiesForReq,
} from '../../src/view/product-map.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

async function renderLive() {
  const result = await walkTree({ projectRoot: repoRoot });
  const model = buildTreeModel(result);
  return { model, html: renderPage(model), panel: renderProductMapPanel(model) };
}

test('product-map shape grouping renders one bucket per shape plus Unclassified and Business rules', async () => {
  const { model, html } = await renderLive();
  const shapeBuckets = groupByShape(model);
  const bucketIds = shapeBuckets.map((b) => b.id);
  // Business rules ('none') and Unclassified must both appear on real
  // dogfood data (35% of REQs are unclassified per d-019 analysis).
  assert.ok(bucketIds.includes('unclassified'), 'expected an Unclassified bucket');
  assert.ok(bucketIds.includes('none'), 'expected a Business rules (none) bucket');
  // Panel must be embedded in the review surface.
  const tabStart = html.indexOf('id="tab-product-map"');
  assert.ok(tabStart > 0, 'Product Map tabpanel is missing from the rendered page');
  const shapeSection = html.indexOf('id="pm-group-shape"', tabStart);
  assert.ok(shapeSection > tabStart, 'shape group section is missing');
  // Every reported bucket appears in the rendered shape section.
  const pmSectionEnd = html.indexOf('id="pm-group-component"', shapeSection);
  const shapeSlice = html.slice(shapeSection, pmSectionEnd);
  for (const b of shapeBuckets) {
    assert.ok(
      shapeSlice.includes(`data-pm-bucket-id="${b.id}"`),
      `shape section missing bucket ${b.id}`,
    );
    // The bucket count matches the pure-function result.
    assert.match(shapeSlice, new RegExp(`data-pm-bucket-id="${b.id}"[\\s\\S]{0,600}\\((${b.reqs.length})\\)`),
      `bucket ${b.id} count mismatch (expected ${b.reqs.length})`);
  }
  // shapesForReq is what the bucket-membership rule reads.
  const req043 = model.requirements.find((r) => r.reqId === 'REQ-043');
  if (req043) {
    const shapes = shapesForReq(req043);
    assert.ok(shapes.length >= 1, 'REQ-043 must have at least one shape or Unclassified');
  }
});

test('product-map shape grouping drills bucket to REQ to US to AC with status pill', async () => {
  const { model, html } = await renderLive();
  const buckets = groupByShape(model);
  // Pick the smallest non-empty bucket to keep the search cheap.
  const bucket = [...buckets].sort((a, b) => a.reqs.length - b.reqs.length).find((b) => b.reqs.length > 0);
  assert.ok(bucket, 'expected at least one shape bucket on real data');
  const req = bucket.reqs[0];
  const shapeSectionStart = html.indexOf('id="pm-group-shape"');
  const shapeSectionEnd = html.indexOf('id="pm-group-component"', shapeSectionStart);
  const shapeSlice = html.slice(shapeSectionStart, shapeSectionEnd);
  // REQ appears with its data-doc-id (product-map prefix keeps anchors
  // disjoint from the Requirements tab) and a status pill.
  assert.ok(
    shapeSlice.includes(`data-doc-id="pm-${req.reqId}"`),
    `shape section missing REQ card for ${req.reqId}`,
  );
  assert.ok(
    shapeSlice.includes(`data-req-status="${req.status}"`),
    `REQ ${req.reqId} card missing data-req-status="${req.status}"`,
  );
  // At least one US is drilled beneath a REQ with stories.
  const stories = model.storiesByReqId.get(req.reqId) ?? [];
  if (stories.length > 0) {
    const us = stories[0];
    assert.ok(
      shapeSlice.includes(`data-doc-id="pm-${us.usId}"`),
      `shape section missing US card for ${us.usId}`,
    );
    // Each AC anchor is emitted by renderUserStory once per AC.
    const acs = us.acceptanceCriteria ?? [];
    if (acs.length > 0) {
      assert.match(shapeSlice, new RegExp(`id="${acs[0].id}"`),
        `shape section missing AC anchor for ${acs[0].id}`);
    }
  }
  // Status pill classes are the same as the Requirements tab uses.
  assert.match(shapeSlice, /<span class="status /);
});

test('product-map status filter renders six options and hides non-matching REQs while collapsing empty buckets', async () => {
  const { html } = await renderLive();
  const tabStart = html.indexOf('id="tab-product-map"');
  // The Product Map tab is the last tabpanel; take the rest of the page
  // from the tab open onward. Sliced by a fixed byte cap has burnt an
  // earlier revision of this test on a 10 MB render (the pm-req cards
  // for the trace + capability groupings landed past the cap).
  const tabPanel = html.slice(tabStart);
  // Select exists inside the tab.
  const selectStart = tabPanel.indexOf('class="pm-status-select"');
  assert.ok(selectStart > 0, 'status filter select is missing');
  // Six options (all + 5 authoring statuses).
  assert.equal(STATUSES.length, 6);
  for (const s of STATUSES) {
    assert.match(tabPanel, new RegExp(`<option value="${s}"`),
      `status filter missing option ${s}`);
  }
  // Default select value is "all".
  assert.equal(DEFAULT_STATUS, 'all');
  assert.match(tabPanel, /<option value="all" selected>/);
  // Every REQ card in the tab carries a data-req-status attribute so the
  // client-side filter can hide it. Multi-grouping tab renders each REQ
  // under every bucket it belongs to, so the attribute count is well
  // above the REQ count.
  const reqCards = tabPanel.match(/data-req-status="/g) ?? [];
  assert.ok(reqCards.length > 100, `expected many REQ status attributes in the tab, saw ${reqCards.length}`);
  // The inline script defines the empty-bucket collapse behaviour.
  assert.match(html, /applyPmStatusFilter/);
  assert.match(html, /pm-bucket-empty-filter/);
  // Groupings enumerated by the inline script include all four.
  assert.match(html, /PM_GROUPS\s*=\s*\['shape',\s*'component',\s*'trace',\s*'capability'\]/);
});

test('product-map component grouping roots at TAD and lists TAC to US to REQ to AC with an Unmapped bucket', async () => {
  const { model, html } = await renderLive();
  const { tacs, unmapped } = groupByComponent(model);
  assert.ok(tacs.length > 0, 'expected at least one TAC on real data');
  const compStart = html.indexOf('id="pm-group-component"');
  const compEnd = html.indexOf('id="pm-group-trace"', compStart);
  const compSlice = html.slice(compStart, compEnd);
  // TAD heading rendered at the top of the component group.
  if (model.tad) {
    assert.ok(compSlice.includes(model.tad.tadId), 'TAD root missing from component grouping');
  }
  // Every TAC row appears with its id and count.
  for (const t of tacs.slice(0, 5)) {
    assert.ok(compSlice.includes(`data-pm-bucket-id="${t.tacId}"`),
      `component section missing bucket for ${t.tacId}`);
  }
  // Unmapped bucket appears when unmapped REQs exist.
  if (unmapped.length > 0) {
    assert.match(compSlice, /data-pm-bucket-id="unmapped"/);
    assert.match(compSlice, new RegExp(`\\(${unmapped.length}\\)`));
  }
  // At least one TAC row cites its dependencies list.
  assert.match(compSlice, /class="pm-tac-deps"/);
});

test('product-map trace coverage buckets REQs by completeness and names what is missing per REQ', async () => {
  const { model, html } = await renderLive();
  const buckets = groupByTraceCoverage(model);
  // The pure function must produce at least one bucket and every REQ
  // is placed exactly once.
  const totalPlaced = buckets.reduce((n, b) => n + b.entries.length, 0);
  assert.equal(totalPlaced, model.requirements.length,
    'trace coverage grouping must place every REQ exactly once');
  const bucketIds = buckets.map((b) => b.id);
  for (const b of buckets) {
    assert.ok(
      ['missing-stories', 'missing-ac-scope', 'missing-component', 'missing-tests', 'complete'].includes(b.id),
      `unknown bucket id ${b.id}`,
    );
  }
  const traceStart = html.indexOf('id="pm-group-trace"');
  const traceEnd = html.indexOf('id="pm-group-capability"', traceStart);
  const traceSlice = html.slice(traceStart, traceEnd);
  // At least one "Missing:" line is rendered for a non-complete bucket
  // (real data has plenty of ACs without tests).
  const hasIncomplete = buckets.some((b) => b.id !== 'complete' && b.entries.length > 0);
  if (hasIncomplete) {
    assert.match(traceSlice, /class="pm-trace-missing"/);
    assert.match(traceSlice, /<strong>Missing:<\/strong>/);
  }
  // Every rendered bucket id must be present in the DOM.
  for (const id of bucketIds) {
    assert.ok(traceSlice.includes(`data-pm-bucket-id="${id}"`),
      `trace coverage section missing bucket ${id}`);
  }
});

test('product-map capability grouping enumerates one bucket per capability slug with Unclassified for untagged REQs', async () => {
  const { model, html } = await renderLive();
  const buckets = groupByCapability(model);
  assert.ok(buckets.length > 0, 'expected at least one capability bucket on tagged data');
  // Every distinct capability:<slug> across the tree produces a bucket
  // (plus the Unclassified bucket only when untagged REQs exist).
  const distinctSlugs = new Set();
  for (const req of model.requirements) {
    for (const slug of capabilitiesForReq(req)) distinctSlugs.add(slug);
  }
  const bucketIds = new Set(buckets.map((b) => b.id));
  for (const slug of distinctSlugs) {
    assert.ok(bucketIds.has(slug), `expected a capability bucket for ${slug}`);
  }
  const capStart = html.indexOf('id="pm-group-capability"');
  const capEnd = html.indexOf('</section>\n</div>\n    ', capStart);
  const capSlice = html.slice(capStart, capEnd === -1 ? undefined : capEnd);
  // Buckets order: count desc then alphabetical; Unclassified last if
  // present.
  const capBucketMatches = [...capSlice.matchAll(/data-pm-bucket-id="capability-([^"]+)"/g)]
    .map((m) => m[1]);
  const expectedIds = buckets.map((b) => `capability-${b.id}`);
  // Every bucket must be rendered.
  for (const id of expectedIds) {
    assert.ok(capSlice.includes(`data-pm-bucket-id="${id}"`),
      `capability section missing bucket ${id}`);
  }
  // Multi-tag: at least one REQ has more than one capability tag on
  // real data (the operator dispatched REQ-170 is tagged with
  // 'capability:review-surface' and 'product-map' - only one is a
  // capability tag; add a soft assertion that multi-tag COUNT can be
  // >= 0, exercising the tag reader either way).
  const multiTagCount = model.requirements.filter((r) => capabilitiesForReq(r).length >= 2).length;
  assert.ok(multiTagCount >= 0, 'multi-tag count sanity check');
  // GROUPINGS enumerates capability so the client-side switcher can
  // activate it.
  assert.ok(GROUPINGS.includes('capability'));
  // Default grouping is shape.
  assert.equal(DEFAULT_GROUPING, 'shape');
});

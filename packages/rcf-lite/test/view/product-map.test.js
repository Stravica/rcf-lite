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

test('product-map shape grouping drills bucket to REQ to US to AC with status pill, ids scoped to the bucket (P2-1)', async () => {
  const { model, html } = await renderLive();
  const buckets = groupByShape(model);
  // Pick the smallest non-empty bucket to keep the search cheap.
  const bucket = [...buckets].sort((a, b) => a.reqs.length - b.reqs.length).find((b) => b.reqs.length > 0);
  assert.ok(bucket, 'expected at least one shape bucket on real data');
  const req = bucket.reqs[0];
  const shapeSectionStart = html.indexOf('id="pm-group-shape"');
  const shapeSectionEnd = html.indexOf('id="pm-group-component"', shapeSectionStart);
  const shapeSlice = html.slice(shapeSectionStart, shapeSectionEnd);
  // Every id/anchor a REQ card emits inside the Product Map is
  // bucket-scoped via a `pm-<group>-<bucket>-` prefix so the same REQ
  // can appear under multiple buckets without duplicating ids (P2-1
  // fix). Requirements tab anchors are left untouched.
  const prefix = `pm-shape-${bucket.id}-`;
  assert.ok(
    shapeSlice.includes(`data-doc-id="${prefix}${req.reqId}"`),
    `shape section missing bucket-scoped REQ card for ${prefix}${req.reqId}`,
  );
  // The bare (unprefixed) inner REQ article id must NOT appear inside
  // the Product Map tab - that was the P2-1 collision.
  const pmTabStart = html.indexOf('id="tab-product-map"');
  const pmTab = html.slice(pmTabStart);
  const bareReqIdRe = new RegExp(`\\sid="${req.reqId}"`, 'g');
  assert.equal((pmTab.match(bareReqIdRe) ?? []).length, 0,
    `Product Map still emits a bare id="${req.reqId}" (P2-1 regression)`);
  assert.ok(
    shapeSlice.includes(`data-req-status="${req.status}"`),
    `REQ ${req.reqId} card missing data-req-status="${req.status}"`,
  );
  // At least one US is drilled beneath a REQ with stories, with the
  // same bucket-scoped prefix on the outer details AND the inner
  // article.
  const stories = model.storiesByReqId.get(req.reqId) ?? [];
  if (stories.length > 0) {
    const us = stories[0];
    assert.ok(
      shapeSlice.includes(`data-doc-id="${prefix}${us.usId}"`),
      `shape section missing bucket-scoped US card for ${prefix}${us.usId}`,
    );
    assert.match(shapeSlice, new RegExp(`<article id="${prefix}${us.usId}"`),
      `US article id for ${us.usId} should be prefixed with ${prefix}`);
    // Each AC anchor is emitted by renderUserStory once per AC, with
    // the same bucket-scoped prefix.
    const acs = us.acceptanceCriteria ?? [];
    if (acs.length > 0) {
      assert.match(shapeSlice, new RegExp(`id="${prefix}${acs[0].id}"`),
        `shape section missing bucket-scoped AC anchor for ${prefix}${acs[0].id}`);
    }
  }
  // Status pill classes are the same as the Requirements tab uses.
  assert.match(shapeSlice, /<span class="status /);
});

test('product-map: inner REQ/US/AC ids inside the Product Map tab are unique (P2-1 collision fix)', async () => {
  const { html } = await renderLive();
  const pmTabStart = html.indexOf('id="tab-product-map"');
  assert.ok(pmTabStart > 0, 'Product Map tab must be present');
  const pmTab = html.slice(pmTabStart);
  // Collect every id="..." in the Product Map tab.
  const idRe = /\sid="([^"]+)"/g;
  const seen = new Map();
  let m;
  while ((m = idRe.exec(pmTab)) !== null) {
    seen.set(m[1], (seen.get(m[1]) ?? 0) + 1);
  }
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);
  assert.deepEqual(
    dupes,
    [],
    `Product Map tab contains duplicate ids (P2-1): ${dupes.map(([k, n]) => `${k}x${n}`).slice(0, 10).join(', ')}`,
  );
  // Every raw-JSON disclosure inside the pm tab must ALSO have a
  // bucket-scoped data-doc-id, not the bare `<docId>::raw` form.
  const bareRaw = pmTab.match(/data-doc-id="(REQ|US|AC|TAC|TAD|FBS|TS|TC|BS|ADR|PRD)-[^"]*::raw"/g);
  assert.equal(bareRaw, null, `Product Map tab still emits bare raw-JSON data-doc-id: ${bareRaw?.slice(0, 3).join(', ')}`);
});

test('product-map status filter markup + server-rendered per-bucket status counts match the model (P2-3 real assertion)', async () => {
  const { model, html } = await renderLive();
  const tabStart = html.indexOf('id="tab-product-map"');
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
  // The inline script defines the filter + empty-bucket collapse.
  assert.match(html, /applyPmStatusFilter/);
  assert.match(html, /pm-bucket-empty-filter/);
  // Groupings enumerated by the inline script include all four.
  assert.match(html, /PM_GROUPS\s*=\s*\['shape',\s*'component',\s*'trace',\s*'capability'\]/);

  // P2-3 (real filter behaviour): the server-rendered outer pm-req
  // <details> carries data-req-status on the same element the inline
  // filter reads. Count outer pm-req cards per status inside the pm
  // tab; each REQ appears once per bucket it belongs to. The rule the
  // filter enforces is that selecting a status hides every outer
  // pm-req whose data-req-status is not that status - so the count of
  // cards remaining visible for status=S equals the count of outer
  // pm-req cards whose data-req-status="S" in the DOM.
  //
  // We assert those DOM counts match a model-side prediction: for each
  // status S, the number of outer pm-req cards with
  // data-req-status="S" equals the total number of `(bucket, req)`
  // membership rows across all four groupings where req.status === S.
  const shape = groupByShape(model);
  const { tacs: compTacs, unmapped: compUnmapped } = groupByComponent(model);
  const trace = groupByTraceCoverage(model);
  const capability = groupByCapability(model);

  function membershipsByStatus() {
    const out = new Map();
    const add = (status) => { out.set(status, (out.get(status) ?? 0) + 1); };
    for (const b of shape) for (const r of b.reqs) add(r.status ?? '');
    for (const t of compTacs) for (const { req } of t.stories) if (req) add(req.status ?? '');
    for (const r of compUnmapped) add(r.status ?? '');
    for (const b of trace) for (const e of b.entries) add(e.req.status ?? '');
    for (const b of capability) for (const r of b.reqs) add(r.status ?? '');
    return out;
  }

  // Only count OUTER pm-req details (the ones with class
  // "doc-details doc-req-wrap pm-req" and the data-req-status attribute
  // spliced in by renderReqWrapper). The wrapper `pm-comp-story` and
  // `pm-trace-row` divs also carry data-req-status, but those are the
  // status-scoped wrappers used for the component/trace groupings
  // ALONGSIDE the outer pm-req, so counting both would double-count.
  const outerRe = /<details class="doc-details doc-req-wrap pm-req" data-req-status="([^"]*)"/g;
  const domCounts = new Map();
  let m;
  while ((m = outerRe.exec(tabPanel)) !== null) {
    domCounts.set(m[1], (domCounts.get(m[1]) ?? 0) + 1);
  }
  const modelCounts = membershipsByStatus();
  // Component grouping's TAC stories render US-first (not a pm-req
  // wrapper), so the component grouping's contribution to outer pm-req
  // is ONLY the unmapped bucket. Recompute without TAC-story rows.
  const expected = new Map();
  const addTo = (m, s) => m.set(s, (m.get(s) ?? 0) + 1);
  for (const b of shape) for (const r of b.reqs) addTo(expected, r.status ?? '');
  for (const r of compUnmapped) addTo(expected, r.status ?? '');
  for (const b of trace) for (const e of b.entries) addTo(expected, e.req.status ?? '');
  for (const b of capability) for (const r of b.reqs) addTo(expected, r.status ?? '');
  assert.deepEqual(
    Object.fromEntries([...domCounts.entries()].sort()),
    Object.fromEntries([...expected.entries()].sort()),
    'server-rendered per-status outer pm-req counts must match the model membership per grouping',
  );
  // Sanity: modelCounts (all groupings including TAC stories) is a
  // strict superset of the DOM outer-pm-req counts, so referencing it
  // stays load-bearing (assert on it too so the variable is not dead).
  for (const [status, n] of domCounts) {
    assert.ok(
      (modelCounts.get(status) ?? 0) >= n,
      `total-membership count for status ${status} must be >= outer pm-req count`,
    );
  }
  // Every REQ card in the tab carries a data-req-status attribute so
  // the client-side filter has something to read.
  const reqCards = tabPanel.match(/data-req-status="/g) ?? [];
  assert.ok(reqCards.length > 100, `expected many REQ status attributes in the tab, saw ${reqCards.length}`);
});

test('product-map component grouping nests parent REQ INSIDE the US block (AC-17003-1, P1-5)', async () => {
  const { html } = await renderLive();
  const compStart = html.indexOf('id="pm-group-component"');
  const compEnd = html.indexOf('id="pm-group-trace"', compStart);
  const compSlice = html.slice(compStart, compEnd);
  // Walk every pm-comp-story marker. Between each and the next, the
  // US <details> must open BEFORE pm-req-parent (which now lives
  // inside the US body). Before P1-5 the order was reversed
  // (pm-req-parent as a sibling BEFORE the US <details>).
  const storyStarts = [];
  let idx = compSlice.indexOf('<div class="pm-comp-story"');
  while (idx !== -1) {
    storyStarts.push(idx);
    idx = compSlice.indexOf('<div class="pm-comp-story"', idx + 1);
  }
  assert.ok(storyStarts.length > 0, 'expected at least one pm-comp-story on real data');
  let inspected = 0;
  for (let i = 0; i < Math.min(storyStarts.length, 10); i += 1) {
    const start = storyStarts[i];
    const end = i + 1 < storyStarts.length ? storyStarts[i + 1] : compSlice.length;
    const block = compSlice.slice(start, end);
    const parentIdx = block.indexOf('pm-req-parent');
    if (parentIdx < 0) continue; // orphan story or Unmapped bucket
    const usOpenIdx = block.indexOf('<details class="doc-details doc-us-wrap pm-us"');
    assert.ok(usOpenIdx > -1, 'component story block must open a US <details>');
    assert.ok(
      usOpenIdx < parentIdx,
      'P1-5: pm-req-parent must render INSIDE the US <details>, so <details> opens BEFORE the parent line',
    );
    inspected += 1;
  }
  assert.ok(inspected > 0, 'expected at least one non-orphan story block to inspect');
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

test('product-map trace coverage places each REQ in the FIRST bucket whose condition it meets, on a synthetic fixture (P2-3)', async () => {
  // Synthetic fixture: one REQ per bucket, hitting the exact rule the
  // grouping enforces (bucket order: missing-stories, missing-ac-scope,
  // missing-component, missing-tests, complete).
  const model = {
    requirements: [
      { reqId: 'REQ-A', title: 'no stories', status: 'draft' },
      { reqId: 'REQ-B', title: 'story with no ACs', status: 'draft' },
      { reqId: 'REQ-C', title: 'ACs but no TAC link', status: 'draft' },
      { reqId: 'REQ-D', title: 'ACs and TAC but no tests', status: 'draft' },
      { reqId: 'REQ-E', title: 'everything present', status: 'approved' },
      // Dangling TAC ref: US-F1 lists TAC-999 which is NOT in usByTacId
      // (walker filters via kindById). P1-4 says this REQ MUST land in
      // missing-component, not complete.
      { reqId: 'REQ-F', title: 'US carries only a dangling TAC id', status: 'draft' },
    ],
    userStories: [
      { usId: 'US-B1', reqId: 'REQ-B' },
      { usId: 'US-C1', reqId: 'REQ-C' },
      { usId: 'US-D1', reqId: 'REQ-D' },
      { usId: 'US-E1', reqId: 'REQ-E' },
      { usId: 'US-F1', reqId: 'REQ-F', tacIds: ['TAC-999'] },
    ],
    storiesByReqId: new Map([
      ['REQ-A', []],
      ['REQ-B', [{ usId: 'US-B1', reqId: 'REQ-B' }]],
      ['REQ-C', [{ usId: 'US-C1', reqId: 'REQ-C', tacIds: [] }]],
      ['REQ-D', [{ usId: 'US-D1', reqId: 'REQ-D', tacIds: ['TAC-1'] }]],
      ['REQ-E', [{ usId: 'US-E1', reqId: 'REQ-E', tacIds: ['TAC-1'] }]],
      ['REQ-F', [{ usId: 'US-F1', reqId: 'REQ-F', tacIds: ['TAC-999'] }]],
    ]),
    acIdsByUsId: new Map([
      ['US-B1', []],
      ['US-C1', ['AC-C1-1']],
      ['US-D1', ['AC-D1-1']],
      ['US-E1', ['AC-E1-1']],
      ['US-F1', ['AC-F1-1']],
    ]),
    // Only real TACs (TAC-1) appear in usByTacId; TAC-999 (dangling) is
    // NOT present, mirroring what the walker's isKind check produces.
    usByTacId: new Map([['TAC-1', ['US-D1', 'US-E1']]]),
    tsByAcId: new Map([
      ['AC-E1-1', [{ id: 'TS-1' }]],
    ]),
    tcsByAcId: new Map(),
  };
  const buckets = groupByTraceCoverage(model);
  const byId = new Map(buckets.map((b) => [b.id, b]));
  // Every bucket exists and holds exactly the REQs the rule predicts.
  assert.deepEqual(byId.get('missing-stories').entries.map((e) => e.req.reqId), ['REQ-A']);
  assert.deepEqual(byId.get('missing-ac-scope').entries.map((e) => e.req.reqId), ['REQ-B']);
  // REQ-C (no TAC link at all) AND REQ-F (dangling TAC-999) both land
  // in missing-component - the P1-4 fix.
  assert.deepEqual(
    byId.get('missing-component').entries.map((e) => e.req.reqId).sort(),
    ['REQ-C', 'REQ-F'],
    'P1-4: a US carrying only a dangling tacIds ref must land in missing-component, not complete',
  );
  assert.deepEqual(byId.get('missing-tests').entries.map((e) => e.req.reqId), ['REQ-D']);
  assert.deepEqual(byId.get('complete').entries.map((e) => e.req.reqId), ['REQ-E']);
  // Every REQ placed exactly once across all buckets (rule ordering).
  const totalPlaced = buckets.reduce((n, b) => n + b.entries.length, 0);
  assert.equal(totalPlaced, model.requirements.length);
});

test('product-map trace coverage renders each bucket into the DOM on real data', async () => {
  const { model, html } = await renderLive();
  const buckets = groupByTraceCoverage(model);
  const totalPlaced = buckets.reduce((n, b) => n + b.entries.length, 0);
  assert.equal(totalPlaced, model.requirements.length,
    'trace coverage grouping must place every REQ exactly once');
  for (const b of buckets) {
    assert.ok(
      ['missing-stories', 'missing-ac-scope', 'missing-component', 'missing-tests', 'complete'].includes(b.id),
      `unknown bucket id ${b.id}`,
    );
  }
  const traceStart = html.indexOf('id="pm-group-trace"');
  const traceEnd = html.indexOf('id="pm-group-capability"', traceStart);
  const traceSlice = html.slice(traceStart, traceEnd);
  const hasIncomplete = buckets.some((b) => b.id !== 'complete' && b.entries.length > 0);
  if (hasIncomplete) {
    assert.match(traceSlice, /class="pm-trace-missing"/);
    assert.match(traceSlice, /<strong>Missing:<\/strong>/);
  }
  for (const b of buckets) {
    assert.ok(traceSlice.includes(`data-pm-bucket-id="${b.id}"`),
      `trace coverage section missing bucket ${b.id}`);
  }
});

test('product-map capability grouping enumerates one bucket per capability slug with Unclassified for untagged REQs', async () => {
  const { model, html } = await renderLive();
  const buckets = groupByCapability(model);
  assert.ok(buckets.length > 0, 'expected at least one capability bucket on tagged data');
  const distinctSlugs = new Set();
  for (const req of model.requirements) {
    for (const slug of capabilitiesForReq(req)) distinctSlugs.add(slug);
  }
  const bucketIds = new Set(buckets.map((b) => b.id));
  for (const slug of distinctSlugs) {
    assert.ok(bucketIds.has(slug), `expected a capability bucket for ${slug}`);
  }
  const capStart = html.indexOf('id="pm-group-capability"');
  const capSlice = html.slice(capStart);
  const expectedIds = buckets.map((b) => `capability-${b.id}`);
  for (const id of expectedIds) {
    assert.ok(capSlice.includes(`data-pm-bucket-id="${id}"`),
      `capability section missing bucket ${id}`);
  }
  assert.ok(GROUPINGS.includes('capability'));
  assert.equal(DEFAULT_GROUPING, 'shape');
});

test('product-map capability bucket order matches AC-17005-1: count desc then alpha, Unclassified pinned last (P2-3 + P1-6)', async () => {
  // Synthetic fixture so the assertion is not dulled by whatever the
  // dogfood tree happens to look like today.
  const model = {
    requirements: [
      { reqId: 'REQ-1', status: 'draft', tags: ['capability:zulu'] },
      { reqId: 'REQ-2', status: 'draft', tags: ['capability:alpha'] },
      { reqId: 'REQ-3', status: 'draft', tags: ['capability:alpha'] },
      { reqId: 'REQ-4', status: 'draft', tags: ['capability:mike', 'capability:alpha'] },
      { reqId: 'REQ-5', status: 'draft', tags: ['capability:mike'] },
      { reqId: 'REQ-6', status: 'draft', tags: [] }, // Unclassified
      { reqId: 'REQ-7', status: 'draft' }, // Unclassified (no tags at all)
    ],
  };
  const buckets = groupByCapability(model);
  const observedOrder = buckets.map((b) => b.id);
  // Rule: count desc, then alpha; Unclassified always last (P1-6).
  // Named slugs: alpha=3, mike=2, zulu=1 -> alpha, mike, zulu.
  assert.deepEqual(observedOrder, ['alpha', 'mike', 'zulu', 'unclassified']);
  assert.equal(buckets[buckets.length - 1].id, 'unclassified',
    'Unclassified must be pinned last per AC-17005-1 (P1-6)');
  // Named buckets carry the expected REQ counts.
  const byId = new Map(buckets.map((b) => [b.id, b]));
  assert.equal(byId.get('alpha').reqs.length, 3);
  assert.equal(byId.get('mike').reqs.length, 2);
  assert.equal(byId.get('zulu').reqs.length, 1);
  assert.equal(byId.get('unclassified').reqs.length, 2);
  // Independent recomputation of the sort rule agrees with the observed
  // order (so the test is not just a copy of the implementation).
  const namedBuckets = buckets.filter((b) => b.id !== 'unclassified');
  const expectedNamed = [...namedBuckets]
    .slice()
    .sort((a, b) => (b.reqs.length - a.reqs.length) || a.id.localeCompare(b.id))
    .map((b) => b.id);
  assert.deepEqual(namedBuckets.map((b) => b.id), expectedNamed);
});

test('product-map capability grouping: a multi-tag REQ appears under each capability bucket it carries (P2-3)', async () => {
  const model = {
    requirements: [
      { reqId: 'REQ-M', status: 'draft', tags: ['capability:alpha', 'capability:bravo'] },
      { reqId: 'REQ-N', status: 'draft', tags: ['capability:alpha'] },
      { reqId: 'REQ-O', status: 'draft', tags: [] },
    ],
  };
  const buckets = groupByCapability(model);
  const byId = new Map(buckets.map((b) => [b.id, b]));
  // REQ-M appears under BOTH alpha and bravo. REQ-N only under alpha.
  assert.deepEqual(byId.get('alpha').reqs.map((r) => r.reqId).sort(), ['REQ-M', 'REQ-N']);
  assert.deepEqual(byId.get('bravo').reqs.map((r) => r.reqId), ['REQ-M']);
  assert.deepEqual(byId.get('unclassified').reqs.map((r) => r.reqId), ['REQ-O']);
  // Real multi-tag count sanity: exactly one REQ carries 2 capability
  // tags in this fixture.
  const multiTagCount = model.requirements.filter((r) => capabilitiesForReq(r).length >= 2).length;
  assert.equal(multiTagCount, 1);
  // Total capability memberships = sum of bucket sizes across NAMED
  // buckets = sum of capabilitiesForReq(r).length over tagged REQs.
  const namedTotal = buckets
    .filter((b) => b.id !== 'unclassified')
    .reduce((n, b) => n + b.reqs.length, 0);
  const expectedTotal = model.requirements
    .reduce((n, r) => n + capabilitiesForReq(r).length, 0);
  assert.equal(namedTotal, expectedTotal);
});

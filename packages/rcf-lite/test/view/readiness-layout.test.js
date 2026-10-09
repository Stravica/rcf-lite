// FBS-206 Readiness layout tests (US-18005 under REQ-180 / TAC-4135 /
// ADR-4139). Binds the eight ACs to real assertions against the
// rendered Readiness tab:
//
//   AC-18005-1 [happy]    stage grid: rows x (tree, delta) with
//                         pass/total/state and failing-count link
//   AC-18005-2 [happy]    SubTabStrip offers five keys; sub= writes
//                         to hash and router restores on load + SSE
//   AC-18005-3 [happy]    delta counts: six numbers; per-document
//                         list only when expanded
//   AC-18005-4 [happy]    engineer: no For-engineers DocRow and
//                         every engineer item still present
//   AC-18005-5 [happy]    freeze state: words naming failing gates
//                         / what resolves them; or words naming
//                         what a freeze would record
//   AC-18005-6 [edge]     acknowledged cell: state from stages[].state
//                         + reason from one helper, hover title
//   AC-18005-7 [must-not] embed + <720px: tables stack, strip stays
//   AC-18005-8 [failure]  unknown sub= drops to overview and is
//                         removed from the hash
//
// Node 24 built-ins only. No npm runtime deps. Where a test needs the
// browser-side router (sub= restore on SSE swap, unknown sub= drop),
// it reads the shipped page-init.js source and asserts the exact
// code path exists; combined with the pure helpers' tests here, that
// binds the AC without pulling jsdom. No test-skip, no todo flags.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { renderReadinessPanel, READINESS_SUBS } from '../../src/view/readiness.js';
import { buildCell, reasonForCell, renderVerdictGrid } from '../../src/view/readiness/grid.js';
import { foldCounts, renderDeltaCounts } from '../../src/view/readiness/delta-counts.js';

const PAGE_INIT_PATH = fileURLToPath(new URL('../../src/view/page-init.js', import.meta.url));
const PAGE_INIT_SRC = readFileSync(PAGE_INIT_PATH, 'utf8');
const STYLE_PATH = fileURLToPath(new URL('../../src/view/style.css', import.meta.url));
const STYLE_SRC = readFileSync(STYLE_PATH, 'utf8');

// ---- fixtures -----------------------------------------------------------

function stage({ id, gate, state = 'failing', treeFailing = 1, deltaFailing = 0, deltaTotal = 1, persona = 'engineer', reason }) {
  const checks = [];
  if (treeFailing > 0) {
    checks.push({
      name: `${id.toLowerCase()}:tree`,
      ok: false,
      over: 'tree',
      pass: 0,
      total: treeFailing,
      failing: Array.from({ length: treeFailing }, (_, i) => ({ id: `${id}:item${i + 1}`, why: 'why tree' })),
      persona,
      question: 'tree q',
    });
  } else {
    checks.push({
      name: `${id.toLowerCase()}:tree`,
      ok: true, over: 'tree', pass: 1, total: 1, failing: [], persona, question: 'tree q',
    });
  }
  checks.push({
    name: `${id.toLowerCase()}:delta`,
    ok: deltaFailing === 0,
    over: 'delta',
    pass: deltaFailing === 0 ? deltaTotal : Math.max(0, deltaTotal - deltaFailing),
    total: deltaTotal,
    failing: Array.from({ length: deltaFailing }, (_, i) => ({ id: `${id}:delta${i + 1}`, why: 'why delta' })),
    persona,
    question: 'delta q',
  });
  const s = { stage: id, gate, state, checks };
  if (reason) s.reason = reason;
  return s;
}

function readinessFixture({ freezeable = false, decisions = [] } = {}) {
  const stages = [
    stage({ id: 'D1', gate: 'define.brief', persona: 'productOwner', treeFailing: 1 }),
    stage({ id: 'D4', gate: 'define.stories', persona: 'productOwner', treeFailing: 0, deltaFailing: 1 }),
    stage({ id: 'D5', gate: 'define.crosscut', persona: 'engineer', treeFailing: 2 }),
    stage({ id: 'D6', gate: 'define.probe', state: 'acknowledged', persona: 'engineer', treeFailing: 0, deltaFailing: 0 }),
    stage({ id: 'D8', gate: 'define.freeze', state: 'notApplicable', persona: 'engineer', treeFailing: 0, deltaFailing: 0, deltaTotal: 0, reason: 'tree already freezable' }),
  ];
  // D8 has no delta checks; drop the auto-generated delta check so
  // its delta column is notApplicable.
  stages[4].checks = [
    { name: 'd8:tree', ok: true, over: 'tree', pass: 1, total: 1, failing: [], persona: 'engineer', question: 'q' },
  ];
  const blockedBy = [
    { stage: 'D1', gate: 'define.brief', check: 'd1:tree', persona: 'productOwner', over: 'tree', failingCount: 1, ids: ['D1:item1'], question: 'q' },
    { stage: 'D5', gate: 'define.crosscut', check: 'd5:tree', persona: 'engineer', over: 'tree', failingCount: 2, ids: ['D5:item1', 'D5:item2'], question: 'q' },
  ];
  const result = {
    tree: { treeHash: 'abc', currentTreeHash: 'def', frozenTreeHash: 'abc' },
    stages,
    delta: {
      changed: ['REQ-010'],
      added: ['REQ-011'],
      removed: [],
      briefSince: [1, 2, 3],
      impacted: ['AC-18005-1'],
      impactedFbs: ['FBS-206'],
      currentDocHashes: { 'REQ-010': 'hash10', 'REQ-011': 'hash11' },
    },
    levels: {
      intentComplete: { ok: freezeable, blockedBy: freezeable ? [] : blockedBy.filter((b) => b.persona === 'productOwner'), nextAction: null },
      readyToBuild: { ok: freezeable, blockedBy: freezeable ? [] : blockedBy, nextAction: null },
    },
    personas: {
      productOwner: { blockers: [], nextAction: null },
      engineer: { blockers: [], nextAction: null },
    },
    coverage: {
      tree: {
        totals: { requirements: 2, covered: 1, coveredUnresolved: 0, uncovered: 1 },
        requirements: [{ id: 'REQ-010', coverageClass: 'covered' }, { id: 'REQ-011', coverageClass: 'uncovered' }],
        unresolvedTestPointers: [],
      },
    },
    questions: [],
    decisions,
  };
  return result;
}

// ---- AC-18005-1 ---------------------------------------------------------

test('AC-18005-1 happy: stage grid renders rows x (tree, delta) with pass/total/state and failing-count link', () => {
  const result = readinessFixture();
  const html = renderVerdictGrid({ stages: result.stages, freezeRecord: null });
  assert.match(html, /data-rcf-table="verdict-grid"/);
  assert.match(html, /data-scope="tree"/);
  assert.match(html, /data-scope="delta"/);
  for (const s of result.stages) {
    assert.match(html, new RegExp(`data-rcf-stage="${s.stage}"`));
  }
  // D1 tree cell: 0/1, failing, link to blocking filtered to D1 (ampersand HTML-escaped).
  assert.match(html, /data-rcf-stage="D1"[\s\S]*?data-rcf-cell-state="failing"[\s\S]*?data-rcf-cell-scope="tree"[\s\S]*?data-rcf-cell-pass="0"[\s\S]*?data-rcf-cell-total="1"[\s\S]*?data-rcf-cell-failing="1"[\s\S]*?href="#tab=readiness&amp;sub=blocking&amp;stage=D1"/);
  // D4 delta cell is failing on its own (tree passed on D4).
  assert.match(html, /data-rcf-stage="D4"[\s\S]*?data-rcf-cell-state="failing"[\s\S]*?data-rcf-cell-scope="delta"/);
  // buildCell shape (direct unit assertion)
  const d1Tree = buildCell(result.stages[0], 'tree', null);
  assert.equal(d1Tree.pass, 0);
  assert.equal(d1Tree.total, 1);
  assert.equal(d1Tree.state, 'failing');
  assert.equal(d1Tree.failing, 1);
  assert.ok(d1Tree.href && d1Tree.href.includes('stage=D1'));
});

// ---- AC-18005-2 ---------------------------------------------------------

test('AC-18005-2 happy: the SubTabStrip offers five keys, activeSub is reflected, and the router restores sub= on load and after an SSE swap', () => {
  const html = renderReadinessPanel(readinessFixture(), { profile: null, activeSub: 'overview' });
  // Strip markup
  assert.match(html, /data-rcf-subtabstrip="readiness"/);
  // Five keys in authoring order
  assert.deepEqual(READINESS_SUBS, ['overview', 'questions', 'blocking', 'coverage', 'trace']);
  for (const key of READINESS_SUBS) {
    assert.match(html, new RegExp(`data-sub="${key}"`), `missing sub=${key}`);
    assert.match(html, new RegExp(`data-rcf-subpanel="${key}"`), `missing subpanel=${key}`);
  }
  // Overview active, the rest hidden on first paint with activeSub=overview
  assert.match(html, /data-sub="overview"[^>]*aria-selected="true"/);
  for (const key of ['questions', 'blocking', 'coverage', 'trace']) {
    assert.match(html, new RegExp(`data-rcf-subpanel="${key}"[^>]*hidden`), `${key} should be hidden on initial render`);
  }
  // activeSub flips the hidden attribute: a server-rendered sub=blocking
  // paints with blocking visible and overview hidden.
  const htmlBlocking = renderReadinessPanel(readinessFixture(), { profile: null, activeSub: 'blocking' });
  assert.match(htmlBlocking, /data-sub="blocking"[^>]*aria-selected="true"/);
  assert.match(htmlBlocking, /data-rcf-subpanel="overview"[^>]*hidden/);
  assert.doesNotMatch(htmlBlocking, /data-rcf-subpanel="blocking"[^>]*hidden/);

  // Router: page-init.js's resolveHash fast path calls applyReadinessHash
  // on #tab=readiness; applyReadinessHash activates the sub-tab from
  // params.sub. The SSE swap re-runs onReady, which re-wires the strip
  // and calls resolveHash(window.location.hash) - the hash is read back
  // from the URL and the sub re-activated.
  assert.ok(/if \(tab === 'readiness' && readinessSubTabStrip\(\)\) \{\s*applyReadinessHash\(params\);/.test(PAGE_INIT_SRC), 'router calls applyReadinessHash for the readiness tab');
  assert.ok(/function applyReadinessHash\(params\)/.test(PAGE_INIT_SRC), 'applyReadinessHash defined');
  assert.ok(/activateReadinessSub\(sub\);/.test(PAGE_INIT_SRC), 'applyReadinessHash activates the right sub');
  // onReady wires the strip and resolves the hash (SSE re-init path).
  assert.ok(/wireReadinessSubTabStrip\(\);\s*resolveHash\(window.location.hash\);/.test(PAGE_INIT_SRC), 'onReady wires the strip and resolves the hash on each init (SSE re-init path)');
});

// ---- AC-18005-3 ---------------------------------------------------------

test('AC-18005-3 happy: delta counts render six numbers; per-document list only after expand', () => {
  const result = readinessFixture();
  const html = renderDeltaCounts({ delta: result.delta, freezeRecord: null, expanded: false });
  const expected = foldCounts(result.delta);
  for (const key of ['changed', 'added', 'removed', 'briefSince', 'impacted', 'impactedFbs']) {
    assert.match(html, new RegExp(`data-rcf-count="${key}"[^>]*data-rcf-count-value="${expected[key]}"`), `tile for ${key}`);
  }
  // <details> is NOT open by default.
  assert.ok(/<details class="rcf-readiness-delta-counts__details"(?!\s*open)/.test(html), 'details element not open on first paint');
  // Expanded form shows the per-document list with doc ids present.
  const htmlOpen = renderDeltaCounts({ delta: result.delta, freezeRecord: null, expanded: true });
  assert.ok(/<details class="rcf-readiness-delta-counts__details"\s*open/.test(htmlOpen), 'details open attribute set when expanded');
  assert.ok(htmlOpen.includes('REQ-010'), 'changed doc id present when expanded');
  assert.ok(htmlOpen.includes('REQ-011'), 'added doc id present when expanded');
  // Closed form has the summary line (shown by the browser when details is closed)
  // but NOT the per-document list markup outside the details element.
  const beforeDetails = html.slice(0, html.indexOf('<details'));
  assert.ok(!beforeDetails.includes('REQ-010'), 'doc id must only live inside details');
  assert.ok(!beforeDetails.includes('REQ-011'), 'doc id must only live inside details');
});

// ---- AC-18005-4 ---------------------------------------------------------

test('AC-18005-4 happy: engineer register has no For-engineers DocRow wrapper and every engineer item is present in a named block', () => {
  const result = readinessFixture();
  const html = renderReadinessPanel(result, { profile: 'register: engineer' });
  // No For-engineers DocRow wrapper, no stage chips, no stage detail.
  assert.doesNotMatch(html, /class="rcf-po-engineer"/);
  assert.doesNotMatch(html, /class="rcf-readiness-chips"/);
  assert.doesNotMatch(html, /class="rcf-readiness-stage-detail"/);
  // Every engineer id (from the fixture's readyToBuild blockedBy) is in the DOM.
  const engBlockers = result.levels.readyToBuild.blockedBy.filter((b) => b.persona === 'engineer');
  for (const b of engBlockers) {
    for (const id of b.ids) {
      assert.ok(html.includes(id), `engineer id ${id} present in panel`);
    }
  }
  // Named blocks: a stage grid (overview), a blocking table (sub-panel),
  // a coverage sub-panel, decisions, freeze-state.
  assert.match(html, /data-rcf-table="verdict-grid"/);
  assert.match(html, /data-rcf-subpanel="blocking"/);
  assert.match(html, /data-rcf-subpanel="coverage"/);
  assert.match(html, /class="rcf-readiness-decisions"/);
  assert.match(html, /class="rcf-readiness-freeze-state"/);
});

// ---- AC-18005-5 ---------------------------------------------------------

test('AC-18005-5 happy: freeze state words - names failing gates when not ready; names what a freeze records when ready', () => {
  const notReady = readinessFixture({ freezeable: false });
  const ready = readinessFixture({ freezeable: true });
  const notReadyHtml = renderReadinessPanel(notReady, { profile: 'register: productOwner' });
  const readyHtml = renderReadinessPanel(ready, { profile: 'register: productOwner' });
  // Not ready: block names failing gates in plain words with a per-gate row.
  assert.match(notReadyHtml, /data-rcf-freezeable="no"/);
  for (const b of notReady.levels.readyToBuild.blockedBy) {
    assert.ok(notReadyHtml.includes(`data-rcf-gate="${b.gate}"`), `gate ${b.gate} listed`);
  }
  assert.match(notReadyHtml, /On me/);
  assert.match(notReadyHtml, /On engineers/);
  // No freeze button; no CLI command text in the readiness panel.
  assert.doesNotMatch(notReadyHtml, /rcf-readiness-freeze-now__btn/);
  assert.doesNotMatch(notReadyHtml, /Freeze now/);
  assert.doesNotMatch(notReadyHtml, /pnpm rcf/);
  assert.doesNotMatch(notReadyHtml, /rcf define/);
  // Ready: states what a freeze would record (hash, timestamp, note, counts, acked gates)
  assert.match(readyHtml, /data-rcf-freezeable="yes"/);
  assert.match(readyHtml, /Ready to freeze/);
  assert.match(readyHtml, /tree hash/);
  assert.match(readyHtml, /timestamp/);
  assert.match(readyHtml, /counts/);
  assert.match(readyHtml, /acknowledged gates/);
  assert.doesNotMatch(readyHtml, /rcf-readiness-freeze-now__btn/);
});

// ---- AC-18005-6 ---------------------------------------------------------

test('AC-18005-6 edge: acknowledged cell state comes from stages[].state and the ack reason via one helper', () => {
  const stages = readinessFixture().stages;
  const freezeRecord = { gates: { 'define.probe': { reason: 'risk accepted at a854a5fc' } } };
  const d6 = stages.find((s) => s.stage === 'D6');
  const treeCell = buildCell(d6, 'tree', freezeRecord);
  assert.equal(treeCell.state, 'acknowledged', 'tree cell is acknowledged');
  assert.equal(treeCell.reason, 'risk accepted at a854a5fc', 'reason from freezeRecord.gates via helper');
  // reasonForCell is the single helper the grid uses - direct call matches.
  assert.equal(reasonForCell(d6, 'acknowledged', freezeRecord), 'risk accepted at a854a5fc');
  // Non-acknowledged / non-notApplicable states return no reason.
  assert.equal(reasonForCell(d6, 'passed', freezeRecord), undefined);
  assert.equal(reasonForCell(d6, 'failing', freezeRecord), undefined);
  // notApplicable reads stages[].reason, not freezeRecord.
  const d8 = stages.find((s) => s.stage === 'D8');
  assert.equal(reasonForCell(d8, 'notApplicable', freezeRecord), 'tree already freezable');
  // Render: reason surfaces as the cell's title (hover).
  const html = renderVerdictGrid({ stages, freezeRecord });
  assert.ok(/data-rcf-stage="D6"[\s\S]*?data-rcf-cell-state="acknowledged"[\s\S]*?title="risk accepted at a854a5fc"/.test(html), 'acknowledged cell carries the reason as a title');
});

// ---- AC-18005-7 ---------------------------------------------------------

test('AC-18005-7 must-not: embed + <720px keeps tables stacked and SubTabStrip inside the panel', () => {
  // The server-rendered markup puts the SubTabStrip INSIDE the readiness
  // panel wrapper <div.rcf-readiness-panel>, not above the tabs row.
  const html = renderReadinessPanel(readinessFixture(), { profile: null });
  const panelStart = html.indexOf('<div class="rcf-readiness-panel"');
  assert.ok(panelStart !== -1, 'readiness-panel wrapper present');
  const stripIdx = html.indexOf('data-rcf-subtabstrip="readiness"');
  assert.ok(stripIdx > panelStart, 'SubTabStrip sits inside the readiness panel wrapper');
  // CSS: narrow-width rule stacks the grid table and keeps the strip
  // horizontally scrollable within the panel.
  assert.ok(/@media \(max-width: 720px\)[\s\S]*?#tab-readiness \.rcf-subtabs[\s\S]*?overflow-x: auto/.test(STYLE_SRC), 'narrow stack rule for the sub-tab strip');
  assert.ok(/@media \(max-width: 720px\)[\s\S]*?\.rcf-readiness-grid__table thead \{\s*display: none/.test(STYLE_SRC), 'narrow stacks the grid table');
  // Embed rule: same stack rules fire under data-embed="1" regardless
  // of width (viewer embedded in a host side-panel).
  assert.ok(/\[data-embed="1"\] #tab-readiness \.rcf-subtabs[\s\S]*?overflow-x: auto/.test(STYLE_SRC), 'embed stacks the strip');
  assert.ok(/\[data-embed="1"\] \.rcf-readiness-grid__table thead \{\s*display: none/.test(STYLE_SRC), 'embed stacks the grid table');
  // Delta tiles collapse from 6 columns to 2 under both branches.
  assert.ok(/@media \(max-width: 720px\)[\s\S]*?\.rcf-readiness-delta-counts__tiles \{ grid-template-columns: repeat\(2/.test(STYLE_SRC), 'narrow collapses the delta tiles');
  assert.ok(/\[data-embed="1"\] \.rcf-readiness-delta-counts__tiles[\s\S]*?grid-template-columns: repeat\(2/.test(STYLE_SRC), 'embed collapses the delta tiles');
});

// ---- AC-18005-8 ---------------------------------------------------------

test('AC-18005-8 failure: unknown sub= drops to overview and is removed from the hash', () => {
  // The applyReadinessHash branch in page-init.js:
  //   - treats an unknown sub= as "overview"
  //   - rewrites the hash in place (history.replaceState) so sub=<junk>
  //     is removed from the URL after the fallback.
  // readinessHashFragment() emits only `#tab=readiness` for overview
  // (sub= is omitted when sub === 'overview'), which is how the drop
  // takes effect.
  const src = PAGE_INIT_SRC;
  // The known list is READINESS_SUBS; unknown falls back to overview.
  assert.ok(/var sub = known \? raw : 'overview';/.test(src), 'unknown sub= falls back to overview');
  // activateReadinessSub coerces unknown to overview defensively.
  assert.ok(/if \(READINESS_SUBS\.indexOf\(sub\) === -1\) sub = 'overview';/.test(src), 'activateReadinessSub defends against unknown sub keys');
  // The hash is rewritten in place (replaceState) when the input had
  // an unknown sub so the junk value never persists.
  assert.ok(/if \(!known && params && params\.sub\) \{\s*try \{\s*if \(window\.history && typeof window\.history\.replaceState === 'function'\)/.test(src), 'replaceState rewrites the hash when sub= was unknown');
  // readinessHashFragment emits `#tab=readiness` (no sub=) for overview,
  // so a replaceState with that fragment removes sub= from the URL.
  assert.ok(/if \(sub && sub !== 'overview'\) parts\.push\('sub=' \+ encodeURIComponent\(sub\)\);/.test(src), 'overview is encoded without a sub= slot');
});

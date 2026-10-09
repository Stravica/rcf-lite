// FBS-205 (US-18004 under REQ-180, TAC-4135, ADR-4139). TS-238
// binds one TC per AC-18004-* to the test cases below. The suite is
// unit (pure HTML-string renders over handcrafted and real
// readiness/tree inputs) and the TC descriptions are the full AC text
// verbatim (issue 327, Dave constraint 2).
//
// Node 24 built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  renderCoverageSummary,
  computeCoverageSummary,
  familyCounts,
  COVERAGE_UNAVAILABLE_TEXT,
} from '../../src/view/readiness/coverage-summary.js';
import {
  renderThinReqsTable,
  buildThinReqRows,
  THIN_REASONS,
} from '../../src/view/readiness/thin-reqs.js';
import { renderReadinessPO } from '../../src/view/readiness/po-layer.js';
import { renderModelToPage } from '../../src/view/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = resolve(here, '..', '..');

/** Build a minimal readiness fixture with the shape coverage really has. */
function readinessWithRealCoverage({ requirements = 10, covered = 7, coveredUnresolved = 2, uncovered = 1, unresolved = [] } = {}) {
  return {
    tree: { frozen: false, frozenAt: null, treeHash: null, currentTreeHash: 'sha256:abc', buildAt: null, fbsTotal: 0 },
    delta: { changed: [], added: [], removed: [], briefSince: [], impacted: [], impactedFbs: [] },
    stages: [],
    nextAction: null,
    coverage: {
      tree: {
        totals: { requirements, covered, coveredUnresolved, uncovered },
        requirements: Array.from({ length: requirements }, (_, i) => ({ id: `REQ-${String(100 + i).padStart(3, '0')}`, covered: i < covered, coverageClass: i < covered ? 'covered' : (i < covered + coveredUnresolved ? 'covered-unresolved' : 'uncovered'), acs: [{ id: `AC-${100 + i}-1`, covered: i < covered, testCases: [], unresolvedTestCases: [] }] })),
        unresolvedTestPointers: unresolved,
      },
      delta: [],
    },
    decisions: [],
    freezeable: false,
    levels: {
      intentComplete: { ok: true, blockedBy: [], nextAction: null },
      readyToBuild: { ok: true, blockedBy: [], nextAction: null },
    },
    personas: {
      productOwner: { blockers: [], nextAction: null },
      engineer: { blockers: [], nextAction: null },
    },
  };
}

function treeFixture() {
  return {
    requirements: Array.from({ length: 5 }, (_, i) => ({ id: `REQ-${100 + i}` })),
    userStories: [
      { id: 'US-10001', usId: 'US-10001', reqId: 'REQ-100', acceptanceCriteria: [{ id: 'AC-10001-1' }, { id: 'AC-10001-2' }] },
      { id: 'US-10002', usId: 'US-10002', reqId: 'REQ-100', acceptanceCriteria: [{ id: 'AC-10002-1' }] },
      { id: 'US-10003', usId: 'US-10003', reqId: 'REQ-101', acceptanceCriteria: [] },
    ],
    testSuites: [
      { id: 'TS-100', testCases: [{ id: 'TC-100-1' }, { id: 'TC-100-2' }] },
      { id: 'TS-101', testCases: [{ id: 'TC-101-1' }] },
    ],
    fbsItems: [
      { fbsId: 'FBS-100' },
      { fbsId: 'FBS-101' },
    ],
  };
}

// -----------------------------------------------------------------------
// TC-238-18004-1-happy
// AC-18004-1 [happy] Given readiness.coverage.tree carries totals, when the
//   coverage sub-view renders, then CoverageSummary.totals shows requirements,
//   covered, coveredUnresolved and uncovered as numbers and
//   CoverageSummary.percentCovered as a percentage, never a blank value.
// -----------------------------------------------------------------------
test('AC-18004-1 happy: readinesscoveragetree carries totals', () => {
  const summary = computeCoverageSummary({ totals: { requirements: 10, covered: 7, coveredUnresolved: 2, uncovered: 1 } });
  assert.equal(summary.available, true);
  for (const slot of ['requirements', 'covered', 'coveredUnresolved', 'uncovered']) {
    assert.equal(typeof summary.totals[slot], 'number', `${slot} is a number`);
    assert.ok(String(summary.totals[slot]).length > 0, `${slot} not blank`);
  }
  assert.match(summary.percentCovered, /^\d+%$/, 'percentCovered is a percentage');
  const html = renderCoverageSummary({ coverage: { tree: { totals: { requirements: 10, covered: 7, coveredUnresolved: 2, uncovered: 1 } } }, tree: {} });
  // Every slot is rendered with a number and no empty <strong>
  assert.match(html, /data-rcf-slot="requirements"[^>]*>Requirements: <strong>10<\/strong>/);
  assert.match(html, /data-rcf-slot="covered"[^>]*>Covered: <strong>7<\/strong>/);
  assert.match(html, /data-rcf-slot="coveredUnresolved"[^>]*>Covered-unresolved: <strong>2<\/strong>/);
  assert.match(html, /data-rcf-slot="uncovered"[^>]*>Uncovered: <strong>1<\/strong>/);
  assert.match(html, /data-rcf-slot="percentCovered"[^>]*>\d+%<\/span>/);
  assert.doesNotMatch(html, /<strong>\s*<\/strong>/, 'no empty strong tags');
});

// -----------------------------------------------------------------------
// TC-238-18004-2-happy
// AC-18004-2 [happy] Given the tree model, when the coverage sub-view
//   renders, then CoverageSummary.families lists the document counts per
//   family (requirements, stories, criteria, suites, cases, build specs)
//   as stat tiles and one stacked bar whose three widths are the three
//   class totals, using only the --sv-success, --sv-warning and --sv-danger
//   tokens on --sv-surface.
// -----------------------------------------------------------------------
test('AC-18004-2 happy: the tree model', async () => {
  const tree = treeFixture();
  const tiles = familyCounts(tree);
  const keys = tiles.map((t) => t.key);
  assert.deepEqual(keys, ['requirements', 'stories', 'criteria', 'suites', 'cases', 'buildSpecs']);
  const by = Object.fromEntries(tiles.map((t) => [t.key, t.count]));
  assert.equal(by.requirements, 5);
  assert.equal(by.stories, 3);
  assert.equal(by.criteria, 3); // 2 + 1 + 0
  assert.equal(by.suites, 2);
  assert.equal(by.cases, 3);
  assert.equal(by.buildSpecs, 2);

  const readiness = readinessWithRealCoverage({ requirements: 10, covered: 6, coveredUnresolved: 3, uncovered: 1 });
  const html = renderCoverageSummary({ coverage: readiness.coverage, tree });
  // Tiles: six rendered with their family label.
  assert.match(html, /data-rcf-family="requirements"/);
  assert.match(html, /data-rcf-family="stories"/);
  assert.match(html, /data-rcf-family="criteria"/);
  assert.match(html, /data-rcf-family="suites"/);
  assert.match(html, /data-rcf-family="cases"/);
  assert.match(html, /data-rcf-family="buildSpecs"/);
  // Stacked bar: three segments.
  assert.match(html, /rcf-cov-summary__bar-seg--covered/);
  assert.match(html, /rcf-cov-summary__bar-seg--unresolved/);
  assert.match(html, /rcf-cov-summary__bar-seg--uncovered/);
  // Widths: percentages that sum close to 100.
  const widths = [...html.matchAll(/rcf-cov-summary__bar-seg[^>]+width:\s*([\d.]+)%/g)].map((m) => Number(m[1]));
  assert.equal(widths.length, 3);
  const sum = widths.reduce((a, b) => a + b, 0);
  assert.ok(sum >= 99.9 && sum <= 100.1, `bar segment widths sum to ~100 (got ${sum})`);

  // CSS uses only --sv-success, --sv-warning, --sv-danger over --sv-surface
  // (no new tokens). Read the stylesheet and assert the bar rules target
  // only those tokens.
  const css = await readFile(resolve(PACKAGE_ROOT, 'src/view/style.css'), 'utf8');
  const barRules = css.match(/\.rcf-cov-summary__bar-seg--(covered|unresolved|uncovered)[^{]*\{[^}]*\}/g) || [];
  assert.equal(barRules.length, 3, 'three bar segment rules');
  const used = new Set();
  for (const rule of barRules) {
    const m = rule.match(/var\(--sv-([a-z]+)\)/);
    assert.ok(m, `rule names --sv-* token: ${rule}`);
    used.add(m[1]);
  }
  const expected = new Set(['success', 'warning', 'danger']);
  assert.deepEqual(new Set([...used]), expected);
  // The container background is --sv-surface
  const container = css.match(/\.rcf-cov-summary__bar\s*\{[^}]*\}/);
  assert.ok(container, 'bar container rule exists');
  assert.match(container[0], /background:\s*var\(--sv-surface\)/);
});

// -----------------------------------------------------------------------
// TC-238-18004-3-happy
// AC-18004-3 [happy] Given coverage.tree.unresolvedTestPointers is
//   non-empty, when the coverage sub-view renders, then an
//   unresolved-pointers table lists each pointer with its suite id as a
//   link, its case id, the pointer text and the reason word the CLI prints
//   (for example "test-missing" or "file-missing").
// -----------------------------------------------------------------------
test('AC-18004-3 happy: coveragetreeunresolvedtestpointers is nonempty', () => {
  const unresolved = [
    { tsId: 'TS-200', tcId: 'TC-200-happy', testPointer: 'test/view/x.test.js::happy', reason: 'test-missing' },
    { tsId: 'TS-201', tcId: 'TC-201-edge', testPointer: 'test/view/y.test.js::edge', reason: 'file-missing' },
  ];
  const readiness = readinessWithRealCoverage({ unresolved });
  const html = renderCoverageSummary({ coverage: readiness.coverage, tree: {} });
  assert.match(html, /rcf-cov-summary__unresolved/);
  // Each suite id a link
  assert.match(html, /<a href="#tab=testing&amp;entity=TS-200" data-rcf-ts="TS-200">TS-200<\/a>/);
  assert.match(html, /<a href="#tab=testing&amp;entity=TS-201" data-rcf-ts="TS-201">TS-201<\/a>/);
  // Case id in a code cell
  assert.match(html, /<code>TC-200-happy<\/code>/);
  assert.match(html, /<code>TC-201-edge<\/code>/);
  // Pointer text present
  assert.ok(html.includes('test/view/x.test.js::happy'));
  assert.ok(html.includes('test/view/y.test.js::edge'));
  // Reason word matches what the CLI prints
  assert.ok(html.includes('test-missing'));
  assert.ok(html.includes('file-missing'));
});

// -----------------------------------------------------------------------
// TC-238-18004-4-happy
// AC-18004-4 [happy] Given a requirement that fails at least one thin
//   reason from the list [no story | zero criteria on a story | a criterion
//   with no resolving test | a story failing the D4 floors | no plain
//   description], when the thin-requirements table renders, then it carries
//   one ThinReqRow for that requirement with ThinReqRow.stories,
//   ThinReqRow.criteria, ThinReqRow.covered, ThinReqRow.thinReason,
//   ThinReqRow.openHref and ThinReqRow.traceHref.
// -----------------------------------------------------------------------
test('AC-18004-4 happy: a requirement that fails at least one thin reaso', () => {
  const tree = {
    userStories: [
      // REQ-900 has a story with zero criteria -> triggers zeroCriteria
      { id: 'US-900', usId: 'US-900', reqId: 'REQ-900', acceptanceCriteria: [] },
      // REQ-901 has one story with ACs; a floors failure sits on US-901
      { id: 'US-901', usId: 'US-901', reqId: 'REQ-901', acceptanceCriteria: [{ id: 'AC-901-1' }] },
      // REQ-902 has a story with ACs; coverage.tree reports an uncovered AC
      { id: 'US-902', usId: 'US-902', reqId: 'REQ-902', acceptanceCriteria: [{ id: 'AC-902-1' }] },
      // REQ-903 fires skeleton:reqIntent (no plain description)
      { id: 'US-903', usId: 'US-903', reqId: 'REQ-903', acceptanceCriteria: [{ id: 'AC-903-1' }] },
      // REQ-904 has no stories at all -> reqHasUs
    ],
  };
  const readiness = {
    stages: [
      {
        stage: 'D2',
        gate: 'define.skeleton',
        state: 'failing',
        checks: [
          { name: 'skeleton:reqIntent', ok: false, over: 'tree', pass: 0, total: 1, failing: [{ id: 'REQ-903', why: 'no plain description' }], persona: 'productOwner', question: '' },
        ],
      },
      {
        stage: 'D4',
        gate: 'define.stories',
        state: 'failing',
        checks: [
          { name: 'stories:reqHasUs', ok: false, over: 'tree', pass: 0, total: 1, failing: [{ id: 'REQ-904', why: 'no owning user story' }], persona: 'productOwner', question: '' },
          { name: 'stories:usFloors', ok: false, over: 'tree', pass: 0, total: 1, failing: [{ id: 'US-901', why: 'no [failure] class AC' }], persona: 'productOwner', question: '' },
        ],
      },
    ],
    coverage: {
      tree: {
        totals: { requirements: 5, covered: 2, coveredUnresolved: 0, uncovered: 3 },
        requirements: [
          { id: 'REQ-900', coverageClass: 'uncovered', acs: [] },
          { id: 'REQ-901', coverageClass: 'uncovered', acs: [{ id: 'AC-901-1', covered: false }] },
          { id: 'REQ-902', coverageClass: 'uncovered', acs: [{ id: 'AC-902-1', covered: false }] },
          { id: 'REQ-903', coverageClass: 'uncovered', acs: [{ id: 'AC-903-1', covered: true }] },
          { id: 'REQ-904', coverageClass: 'uncovered', acs: [] },
        ],
        unresolvedTestPointers: [],
      },
    },
  };
  const rows = buildThinReqRows(readiness, tree);
  const byId = Object.fromEntries(rows.map((r) => [r.reqId, r]));
  // All five REQs are present.
  assert.deepEqual(Object.keys(byId).sort(), ['REQ-900', 'REQ-901', 'REQ-902', 'REQ-903', 'REQ-904']);
  // Each row carries the six documented fields.
  for (const r of rows) {
    assert.equal(typeof r.stories, 'number');
    assert.equal(typeof r.criteria, 'number');
    assert.equal(typeof r.covered, 'boolean');
    assert.ok(Array.isArray(r.thinReason) && r.thinReason.length > 0);
    assert.equal(typeof r.openHref, 'string');
    assert.equal(typeof r.traceHref, 'string');
  }
  // Each distinct reason surfaces on at least one row.
  const reasons = new Set(rows.flatMap((r) => r.thinReason));
  for (const key of ['reqHasUs', 'zeroCriteria', 'uncoveredAc', 'usFloors', 'reqIntent']) {
    assert.ok(reasons.has(key), `reason ${key} present (keys: ${[...reasons].join(',')})`);
  }
  // ThinReqRow.covered reflects the coverage.tree row.
  assert.equal(byId['REQ-902'].covered, false);
  // Hrefs are the hashes the viewer expects.
  assert.equal(byId['REQ-900'].openHref, '#tab=requirements&entity=REQ-900');
  assert.equal(byId['REQ-900'].traceHref, '#tab=readiness&sub=trace&entity=REQ-900');
  // Rendered table: one <tr> per row with the id.
  const html = renderThinReqsTable({ rows });
  for (const id of ['REQ-900', 'REQ-901', 'REQ-902', 'REQ-903', 'REQ-904']) {
    assert.match(html, new RegExp(`data-rcf-req="${id}"`));
  }
  assert.match(html, /#tab=requirements&amp;entity=REQ-900/);
  assert.match(html, /#tab=readiness&amp;sub=trace&amp;entity=REQ-900/);
});

// -----------------------------------------------------------------------
// TC-238-18004-5-happy
// AC-18004-5 [happy] Given the two verdict cards, when the overview
//   sub-view renders, then the question count on the Ready for engineers
//   card is a link to the questions table, the engineer item count on the
//   Ready to build card is a link to the blocking table, and the former
//   What happens next paragraph is folded into the cards as one sentence
//   each.
// -----------------------------------------------------------------------
test('AC-18004-5 happy: the two verdict cards', () => {
  const readiness = {
    tree: { frozen: false, frozenAt: null, treeHash: null, currentTreeHash: 'sha256:deadbeef', buildAt: null, fbsTotal: 0 },
    delta: { changed: [], added: [], removed: [], briefSince: [], impacted: [], impactedFbs: [] },
    stages: [
      {
        stage: 'D1', gate: 'define.brief', state: 'failing',
        checks: [{ name: 'brief:sinceFreeze', ok: false, over: 'tree', pass: 0, total: 1, failing: [{ id: 'brief:ledger', why: 'brief ledger holds no statements' }], persona: 'productOwner', question: 'Has the owner captured a brief yet?' }],
      },
    ],
    coverage: { tree: { totals: { requirements: 0, covered: 0, coveredUnresolved: 0, uncovered: 0 }, requirements: [], unresolvedTestPointers: [] }, delta: [] },
    decisions: [],
    freezeable: false,
    levels: {
      intentComplete: {
        ok: false,
        blockedBy: [{ stage: 'D1', gate: 'define.brief', check: 'brief:sinceFreeze', persona: 'productOwner', over: 'tree', failingCount: 1, ids: ['brief:ledger'], question: 'Has the owner captured a brief yet?' }],
        nextAction: null,
      },
      readyToBuild: {
        ok: false,
        blockedBy: [
          { stage: 'D1', gate: 'define.brief', check: 'brief:sinceFreeze', persona: 'productOwner', over: 'tree', failingCount: 1, ids: ['brief:ledger'], question: 'Has the owner captured a brief yet?' },
          { stage: 'D5', gate: 'define.crosscut', check: 'crosscut:securityArchitecture', persona: 'engineer', over: 'tree', failingCount: 1, ids: ['TAD-001:security'], question: 'Is the TAD security architecture written?' },
        ],
        nextAction: null,
      },
    },
    personas: { productOwner: { blockers: [], nextAction: null }, engineer: { blockers: [], nextAction: null } },
  };
  const html = renderReadinessPO(readiness, { persona: 'productOwner', engineerBody: '', tree: null });
  // Count links present with the right targets.
  const intentCardMatch = html.match(/<article class="rcf-po-verdict rcf-po-verdict--intent">[\s\S]*?<\/article>/);
  assert.ok(intentCardMatch, 'intent card rendered');
  const intentCard = intentCardMatch[0];
  assert.match(intentCard, /<a[^>]+href="#tab=readiness&amp;sub=questions"[^>]*data-rcf-link="questions"[^>]*>/);
  assert.match(intentCard, /<p class="rcf-po-verdict__next"[^>]*>[^<]+<\/p>/, 'intent card carries one next-step sentence');

  const buildCardMatch = html.match(/<article class="rcf-po-verdict rcf-po-verdict--build">[\s\S]*?<\/article>/);
  assert.ok(buildCardMatch, 'build card rendered');
  const buildCard = buildCardMatch[0];
  assert.match(buildCard, /<a[^>]+href="#tab=readiness&amp;sub=blocking"[^>]*data-rcf-link="blocking"[^>]*>/);
  assert.match(buildCard, /<p class="rcf-po-verdict__next"[^>]*>[^<]+<\/p>/, 'build card carries one next-step sentence');

  // Standalone "What happens next" section no longer rendered.
  assert.doesNotMatch(html, /class="rcf-po-next"/);
  assert.doesNotMatch(html, /<h2[^>]*>What happens next<\/h2>/);
});

// -----------------------------------------------------------------------
// TC-238-18004-6-failure
// AC-18004-6 [failure] Given a coverage result with no totals (a partial
//   tree or an older compute), when the coverage sub-view renders, then it
//   shows the words "coverage unavailable" and the rest of the panel still
//   renders.
// -----------------------------------------------------------------------
test('AC-18004-6 failure: a coverage result with no totals a partial tree', () => {
  // No coverage.tree.totals at all (an older compute).
  const html1 = renderCoverageSummary({ coverage: { tree: {} }, tree: treeFixture() });
  assert.ok(html1.includes('coverage unavailable'), 'coverage unavailable text appears');
  // The tiles and heading still render after the unavailable text.
  assert.match(html1, /id="rcf-readiness-coverage-heading"/);
  assert.match(html1, /data-rcf-family="requirements"/);
  // No numeric placeholder leaked out as a blank number.
  assert.doesNotMatch(html1, /<strong><\/strong>/);
  // Partial compute (totals present but one slot missing): the missing
  // slot shows the unavailable text, the slots that are present still
  // show their numbers, and the rest of the sub-view renders.
  const html2 = renderCoverageSummary({ coverage: { tree: { totals: { requirements: 10, covered: 7 /* no coveredUnresolved, no uncovered */ } } }, tree: treeFixture() });
  assert.ok(html2.includes('coverage unavailable'));
  assert.match(html2, /data-rcf-slot="requirements"[^>]*>Requirements: <strong>10<\/strong>/);
  assert.match(html2, /data-rcf-family="requirements"/);
});

// -----------------------------------------------------------------------
// TC-238-18004-7-mustnot
// AC-18004-7 [must-not] Given any tree, when the coverage sub-view
//   renders, then it never prints an empty number: a value the coverage
//   result does not carry renders as "coverage unavailable", not as a
//   blank.
// -----------------------------------------------------------------------
test('AC-18004-7 must-not: any tree', async () => {
  // In-process render against the live rcf-lite tree. The old
  // renderCoverage printed "pass  / " because the compute never has
  // `coverage.tree.pass` or `coverage.tree.total`; the new sub-view
  // must never print such a pair.
  const r = await renderModelToPage({ projectRoot: PACKAGE_ROOT });
  const html = r.contentHtml;
  const readinessStart = html.indexOf('id="tab-readiness"');
  const readinessEnd = html.indexOf('<section id="tab-overview"');
  assert.ok(readinessStart >= 0 && readinessEnd > readinessStart);
  const section = html.slice(readinessStart, readinessEnd);
  // No empty <strong></strong> number slots in the coverage summary.
  const summaryStart = section.indexOf('class="rcf-cov-summary"');
  const summaryEnd = section.indexOf('</section>', summaryStart) + '</section>'.length;
  assert.ok(summaryStart > 0, 'coverage summary rendered');
  const summary = section.slice(summaryStart, summaryEnd);
  assert.doesNotMatch(summary, /<strong>\s*<\/strong>/, 'no empty <strong> in summary');
  // No "pass  /" blank markup from the old renderCoverage.
  assert.doesNotMatch(summary, /pass\s*\/\s*</);
  // Every rendered summary slot has a non-empty value (a number or the
  // unavailable word).
  const slots = [...summary.matchAll(/data-rcf-slot="([^"]+)"[^>]*>[^<]*<strong>([^<]*)<\/strong>/g)];
  assert.ok(slots.length >= 4, `four slots rendered (got ${slots.length})`);
  for (const [, name, value] of slots) {
    assert.notEqual(value.trim(), '', `slot ${name} is not blank`);
  }
  // Percent slot is non-blank.
  const pct = summary.match(/data-rcf-slot="percentCovered"[^>]*>([^<]+)<\/span>/);
  assert.ok(pct, 'percent slot rendered');
  assert.notEqual(pct[1].trim(), '', 'percent slot not blank');
  // The sentinel word is the one from the module (so a drift gets caught).
  assert.equal(COVERAGE_UNAVAILABLE_TEXT, 'coverage unavailable');
  // THIN_REASONS keys are stable: the five reasons from AC-18004-4 plus
  // the retained resolvedBy signal.
  assert.deepEqual(Object.keys(THIN_REASONS).sort(), ['reqHasUs', 'reqIntent', 'resolvedBy', 'uncoveredAc', 'usFloors', 'zeroCriteria'].sort());
});

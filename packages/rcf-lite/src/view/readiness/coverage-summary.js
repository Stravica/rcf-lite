// Readiness coverage summary (FBS-205, US-18004 under REQ-180,
// TAC-4135-readiness-command-page, ADR-4139-readiness-tables-read-only-no-commands).
//
// Replaces renderCoverage. The old block read `coverage.tree.pass`
// and `coverage.tree.total`, which never exist on the real compute
// (coverage.tree carries `totals.{requirements, covered,
// coveredUnresolved, uncovered}` and `requirements[].coverageClass`
// plus `unresolvedTestPointers[]`). The result rendered as "pass  /
// " blanks on every real tree. This module reads the fields that
// coverage actually produces and prints a stat line, one stacked
// bar, a family tiles row and (when non-empty) an unresolved-
// pointers table. Every value renders as either a number or the
// words "coverage unavailable"; a blank never leaves the page.
//
// Pure HTML-string render. No scripts, no commands, no write
// controls. Tokens stay on --sv-* (contrast-aa.test.js) and no new
// token is introduced.

import { escapeHtml } from '../doc-renderers/helpers.js';

const UNAVAILABLE = 'coverage unavailable';

/**
 * @typedef {object} CoverageTreeTotals
 * @property {number} requirements
 * @property {number} covered
 * @property {number} coveredUnresolved
 * @property {number} uncovered
 */

/**
 * @typedef {object} CoverageSummary
 * @property {object} totals - the four totals and percentCovered as strings or UNAVAILABLE
 * @property {object[]} families - per-family tile data
 */

/**
 * Shape the family counts stat tiles from the walker's tree model.
 * The spec names six families: requirements, stories, criteria,
 * suites, cases, build specs. Each count is derived without a
 * separate compute - the walker already carries each list.
 *
 * @param {object | null | undefined} tree
 * @returns {Array<{key: string, label: string, count: number|null}>}
 */
export function familyCounts(tree) {
  if (!tree || typeof tree !== 'object') {
    return SIX_FAMILIES.map((f) => ({ key: f.key, label: f.label, count: null }));
  }
  const reqs = Array.isArray(tree.requirements) ? tree.requirements.length : null;
  const stories = Array.isArray(tree.userStories) ? tree.userStories.length : null;
  let criteria = 0;
  if (Array.isArray(tree.userStories)) {
    for (const us of tree.userStories) {
      if (Array.isArray(us && us.acceptanceCriteria)) criteria += us.acceptanceCriteria.length;
    }
  } else {
    criteria = null;
  }
  const suites = Array.isArray(tree.testSuites) ? tree.testSuites.length : null;
  let cases = 0;
  if (Array.isArray(tree.testSuites)) {
    for (const ts of tree.testSuites) {
      if (Array.isArray(ts && ts.testCases)) cases += ts.testCases.length;
    }
  } else {
    cases = null;
  }
  const fbsItems = Array.isArray(tree.fbsItems) ? tree.fbsItems.length : null;
  return [
    { key: 'requirements', label: 'Requirements', count: reqs },
    { key: 'stories', label: 'Stories', count: stories },
    { key: 'criteria', label: 'Criteria', count: criteria },
    { key: 'suites', label: 'Suites', count: suites },
    { key: 'cases', label: 'Cases', count: cases },
    { key: 'buildSpecs', label: 'Build specs', count: fbsItems },
  ];
}

const SIX_FAMILIES = [
  { key: 'requirements', label: 'Requirements' },
  { key: 'stories', label: 'Stories' },
  { key: 'criteria', label: 'Criteria' },
  { key: 'suites', label: 'Suites' },
  { key: 'cases', label: 'Cases' },
  { key: 'buildSpecs', label: 'Build specs' },
];

/**
 * Compute the four numeric slots + percent as either numbers or the
 * UNAVAILABLE sentinel. AC-18004-6 and AC-18004-7 bind: no slot ever
 * renders as a blank; a missing total renders the words
 * "coverage unavailable".
 */
export function computeCoverageSummary(coverageTree) {
  const t = coverageTree && typeof coverageTree === 'object' ? coverageTree.totals : null;
  if (!t || typeof t !== 'object') {
    return {
      totals: {
        requirements: UNAVAILABLE,
        covered: UNAVAILABLE,
        coveredUnresolved: UNAVAILABLE,
        uncovered: UNAVAILABLE,
      },
      percentCovered: UNAVAILABLE,
      available: false,
    };
  }
  const reqs = numOrUnavail(t.requirements);
  const covered = numOrUnavail(t.covered);
  const coveredUnresolved = numOrUnavail(t.coveredUnresolved);
  const uncovered = numOrUnavail(t.uncovered);
  const reqsN = typeof reqs === 'number' ? reqs : null;
  const coveredN = typeof covered === 'number' ? covered : null;
  const percent = (reqsN === null || coveredN === null || reqsN === 0)
    ? (reqsN === 0 ? '0%' : UNAVAILABLE)
    : `${Math.round((coveredN / reqsN) * 100)}%`;
  const available = reqs !== UNAVAILABLE && covered !== UNAVAILABLE
    && coveredUnresolved !== UNAVAILABLE && uncovered !== UNAVAILABLE;
  return {
    totals: {
      requirements: reqs,
      covered,
      coveredUnresolved,
      uncovered,
    },
    percentCovered: percent,
    available,
  };
}

function numOrUnavail(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return UNAVAILABLE;
  return v;
}

/**
 * Render the coverage sub-view: a stat line, a stacked bar on
 * --sv-success / --sv-warning / --sv-danger over --sv-surface, a
 * family tiles row, and (when non-empty) an unresolved-pointers
 * table. AC-18004-1/-2/-3/-6/-7.
 *
 * @param {object} args
 * @param {object | null | undefined} args.coverage - readiness.coverage
 * @param {object | null | undefined} args.tree - the walker tree model
 * @returns {string}
 */
export function renderCoverageSummary(args) {
  const coverage = args && args.coverage ? args.coverage : null;
  const tree = args && args.tree ? args.tree : null;
  const treeCov = coverage ? coverage.tree : null;
  const summary = computeCoverageSummary(treeCov);
  const tiles = familyCounts(tree);
  const totalsText = renderTotals(summary);
  const bar = renderBar(summary, treeCov);
  const tilesHtml = renderTiles(tiles);
  const unresolved = renderUnresolvedPointers(treeCov);
  const dataAvailable = summary.available ? 'yes' : 'no';
  return `<section class="rcf-cov-summary" data-rcf-coverage-available="${dataAvailable}" aria-labelledby="rcf-readiness-coverage-heading">
  <header class="rcf-cov-summary__head"><h3 id="rcf-readiness-coverage-heading">Coverage</h3></header>
  ${totalsText}
  ${bar}
  ${tilesHtml}
  ${unresolved}
</section>`;
}

function renderTotals(summary) {
  // AC-18004-7: a value the coverage result does not carry renders as
  // "coverage unavailable", not as a blank. We always render the four
  // slots; each one shows either its number or the unavailable word.
  const t = summary.totals;
  const slot = (name, label) => {
    const v = t[name];
    const text = typeof v === 'number' ? String(v) : UNAVAILABLE;
    const data = typeof v === 'number' ? 'no' : 'yes';
    return `<span class="rcf-cov-summary__slot" data-rcf-slot="${name}" data-rcf-unavailable="${data}">${escapeHtml(label)}: <strong>${escapeHtml(text)}</strong></span>`;
  };
  const unavailAll = summary.available ? '' : ' rcf-cov-summary__totals--unavailable';
  return `<p class="rcf-cov-summary__totals${unavailAll}">
    ${slot('requirements', 'Requirements')}
    ${slot('covered', 'Covered')}
    ${slot('coveredUnresolved', 'Covered-unresolved')}
    ${slot('uncovered', 'Uncovered')}
    <span class="rcf-cov-summary__slot" data-rcf-slot="percentCovered" data-rcf-unavailable="${summary.percentCovered === UNAVAILABLE ? 'yes' : 'no'}">${escapeHtml(summary.percentCovered)}</span>
  </p>`;
}

function renderBar(summary, treeCov) {
  if (!summary.available) {
    return `<div class="rcf-cov-summary__bar" data-rcf-bar-empty="yes" role="img" aria-label="${escapeHtml(UNAVAILABLE)}"></div>`;
  }
  const t = treeCov && treeCov.totals ? treeCov.totals : null;
  const total = t ? (Number(t.requirements) || 0) : 0;
  const covered = t ? (Number(t.covered) || 0) : 0;
  const coveredUnresolved = t ? (Number(t.coveredUnresolved) || 0) : 0;
  const uncovered = t ? (Number(t.uncovered) || 0) : 0;
  // Three widths. Over --sv-surface. --sv-success / --sv-warning / --sv-danger.
  const safeTotal = total > 0 ? total : (covered + coveredUnresolved + uncovered) || 1;
  const w1 = pct(covered, safeTotal);
  const w2 = pct(coveredUnresolved, safeTotal);
  const w3 = pct(uncovered, safeTotal);
  const label = `covered ${covered}, covered-unresolved ${coveredUnresolved}, uncovered ${uncovered} out of ${total}`;
  return `<div class="rcf-cov-summary__bar" role="img" aria-label="${escapeHtml(label)}">
    <span class="rcf-cov-summary__bar-seg rcf-cov-summary__bar-seg--covered" data-rcf-seg="covered" style="width: ${w1};" title="Covered: ${escapeHtml(String(covered))}"></span>
    <span class="rcf-cov-summary__bar-seg rcf-cov-summary__bar-seg--unresolved" data-rcf-seg="unresolved" style="width: ${w2};" title="Covered-unresolved: ${escapeHtml(String(coveredUnresolved))}"></span>
    <span class="rcf-cov-summary__bar-seg rcf-cov-summary__bar-seg--uncovered" data-rcf-seg="uncovered" style="width: ${w3};" title="Uncovered: ${escapeHtml(String(uncovered))}"></span>
  </div>`;
}

function pct(part, total) {
  if (!total) return '0%';
  const n = Math.max(0, Math.min(100, (part / total) * 100));
  return `${n.toFixed(2)}%`;
}

function renderTiles(tiles) {
  const cells = tiles.map((f) => {
    const value = typeof f.count === 'number' ? String(f.count) : UNAVAILABLE;
    const unavail = typeof f.count !== 'number';
    return `<li class="rcf-cov-summary__tile" data-rcf-family="${escapeHtml(f.key)}" data-rcf-unavailable="${unavail ? 'yes' : 'no'}">
      <span class="rcf-cov-summary__tile-count">${escapeHtml(value)}</span>
      <span class="rcf-cov-summary__tile-label">${escapeHtml(f.label)}</span>
    </li>`;
  }).join('');
  return `<ul class="rcf-cov-summary__tiles" aria-label="Document counts per family">${cells}</ul>`;
}

// Each reason word the compute emits for an unresolved pointer has a
// plain-English resolution: what has to change in the test tree to
// clear the row. digest-review rule: rows carry id + plain-
// English ask + chain location + link + what resolved looks like.
const UNRESOLVED_RESOLVED = {
  'test-missing': 'resolved by: add a test case in the pointer file whose name matches the testPointer slot',
  'file-missing': 'resolved by: create the test file at the pointer path and add the matching test case',
  'pointer-malformed': 'resolved by: fix the testPointer on the TC so it names a file and a case name',
  'ambiguous': 'resolved by: narrow the testPointer so one and only one test case matches it',
};

function resolvedForUnresolved(reason) {
  if (!reason) return 'resolved by: add a resolving test case for this pointer';
  if (UNRESOLVED_RESOLVED[reason]) return UNRESOLVED_RESOLVED[reason];
  return `resolved by: fix the pointer so the "${reason}" condition clears`;
}

function renderUnresolvedPointers(treeCov) {
  const items = treeCov && Array.isArray(treeCov.unresolvedTestPointers) ? treeCov.unresolvedTestPointers : [];
  if (items.length === 0) {
    return '';
  }
  const rows = items.map((p) => {
    const tsId = typeof p.tsId === 'string' ? p.tsId : '';
    const tcId = typeof p.tcId === 'string' ? p.tcId : '';
    const pointer = typeof p.testPointer === 'string' && p.testPointer.length > 0 ? p.testPointer : UNAVAILABLE;
    const reason = typeof p.reason === 'string' && p.reason.length > 0 ? p.reason : UNAVAILABLE;
    const resolved = resolvedForUnresolved(typeof p.reason === 'string' ? p.reason : '');
    // `#entity=<TS-id>` without a tab key resolves through the viewer's
    // bare-entity path (page-init.js resolveHash): it finds the TS node,
    // activates its owning tab (Architecture) and scrolls to it. The
    // former `#tab=testing&entity=...` href pointed at a tab that does
    // not exist (TABS: readiness, overview, requirements, architecture,
    // build, product-map) and fell through to Readiness, so clicking a
    // row did not land on its suite.
    const tsCell = tsId
      ? `<a href="#entity=${escapeHtml(tsId)}" data-rcf-ts="${escapeHtml(tsId)}">${escapeHtml(tsId)}</a>`
      : `<em>${escapeHtml(UNAVAILABLE)}</em>`;
    const tcCell = tcId ? `<code>${escapeHtml(tcId)}</code>` : `<em>${escapeHtml(UNAVAILABLE)}</em>`;
    // FBS-208 (AC-209-3): the suite id in the row carries a Trace
    // action that lands on the Trace sub-tab for the id.
    const traceCell = tsId
      ? `<a class="rcf-trace-action" data-rcf-trace-for="${escapeHtml(tsId)}" href="#tab=readiness&amp;sub=trace&amp;entity=${encodeURIComponent(tsId)}">Trace</a>`
      : `<span class="rcf-trace-action rcf-trace-action--na" data-rcf-trace="no" aria-label="No trace available for this item">-</span>`;
    return `<tr>
  <td>${tsCell}</td>
  <td>${tcCell}</td>
  <td><code>${escapeHtml(pointer)}</code></td>
  <td>${escapeHtml(reason)}</td>
  <td class="rcf-cov-summary__unresolved-resolved">${escapeHtml(resolved)}</td>
  <td>${traceCell}</td>
</tr>`;
  }).join('');
  return `<section class="rcf-cov-summary__unresolved" aria-labelledby="rcf-readiness-coverage-unresolved-heading">
  <h4 id="rcf-readiness-coverage-unresolved-heading">Unresolved test pointers <span class="rcf-badge rcf-badge--count">${items.length}</span></h4>
  <table class="rcf-cov-summary__unresolved-table">
    <thead><tr><th>Suite</th><th>Case</th><th>Pointer</th><th>Reason</th><th>What resolves it</th><th><span class="rcf-sr-only">Trace this id</span></th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
</section>`;
}

export const UNRESOLVED_POINTER_RESOLVED = UNRESOLVED_RESOLVED;

export const COVERAGE_UNAVAILABLE_TEXT = UNAVAILABLE;

// Readiness thin-requirements table (FBS-205, US-18004 under REQ-180,
// TAC-4135-readiness-command-page, ADR-4139-readiness-tables-read-only-no-commands).
//
// Replaces the old `buildReqWorkRows` helper with `buildThinReqRows`,
// which widens the PO-side filter to the five thin reasons bound by
// AC-18004-4:
//   1. no story under the REQ (stories:reqHasUs)
//   2. zero criteria on a story under the REQ (D4 floors or the walker)
//   3. a criterion with no resolving test (coverage.tree)
//   4. a story failing a D4 floor (stories:usFloors)
//   5. no plain description on the REQ (skeleton:reqIntent)
// plus the old skeleton:resolvedBy signal, retained so the sweep is
// strictly wider than before. Every row carries ThinReqRow.stories,
// ThinReqRow.criteria, ThinReqRow.covered, ThinReqRow.thinReason,
// ThinReqRow.openHref and ThinReqRow.traceHref.

import { escapeHtml } from '../doc-renderers/helpers.js';

const REASONS = {
  reqHasUs: 'no story yet: who uses this, and what do they do with it',
  // src/query/gates.js stories:usFloors fires on four floor failures
  // (missing [failure] class / opt-out, missing TAC refs, testability
  // floor, outstanding TODO on an AC): the reason text names them in
  // plain words rather than hard-coding only "[failure] class", which
  // mis-describes the other three floors.
  usFloors: 'a story under this requirement is failing a definition floor (missing a [failure] class or opt-out, missing TAC refs, failing the testability floor, or an outstanding TODO on an acceptance criterion)',
  reqIntent: 'needs a plain description: what must the product do here, and which part does it belong to',
  resolvedBy: 'a statement from the document may belong here; confirm it in the questions table',
  zeroCriteria: 'a story under this requirement has no acceptance criteria',
  uncoveredAc: 'at least one criterion under this requirement has no resolving test case',
};

// Each reason's "resolved" condition: a plain-English statement of
// what has to change in the chain for the row to clear. digest-review rule
// (digest-review): every thin row carries id + plain-English ask +
// chain location + link + what resolved looks like.
const RESOLVED = {
  reqHasUs: 'resolved by: add a user story under this requirement in the chain',
  usFloors: 'resolved by: fix the story so every acceptance criterion carries a [failure] class or an opt-out, carries its TAC refs, clears the testability floor and has no outstanding TODO',
  reqIntent: 'resolved by: write a plain description on this requirement that names what the product does and which part it belongs to',
  resolvedBy: 'resolved by: confirm or remove the resolvedBy pointer on the matching question in the questions table',
  zeroCriteria: 'resolved by: write at least one acceptance criterion under the story',
  uncoveredAc: 'resolved by: add a test case under a suite whose testPointer resolves the uncovered acceptance criterion',
};

/**
 * @typedef {object} ThinReqRow
 * @property {string} reqId
 * @property {number} stories - count of user stories under the REQ
 * @property {number} criteria - count of acceptance criteria under the REQ
 * @property {boolean} covered - all criteria have resolving TC coverage
 * @property {string[]} thinReason - keys of the triggered reasons, in a stable order
 * @property {string} openHref - requirements tab hash on the REQ
 * @property {string} traceHref - readiness/trace hash on the REQ (FBS-208 fills the sub-view)
 */

/**
 * Build the thin-requirement rows from the live readiness result and
 * the walker's tree model. The function is pure: no fs, no fetch.
 * Pass in the shape the view already has on hand (readiness carries
 * stages and coverage.tree; tree carries requirements + userStories +
 * acceptanceCriteria).
 *
 * @param {object | null | undefined} readiness
 * @param {object | null | undefined} tree
 * @returns {ThinReqRow[]}
 */
export function buildThinReqRows(readiness, tree) {
  /** @type {Map<string, Set<string>>} */
  const reasonsByReq = new Map();
  const addReason = (reqId, key) => {
    if (!reqId || !key) return;
    const bare = reqId.split(':')[0];
    if (!/^REQ-\d+/.test(bare)) return;
    let set = reasonsByReq.get(bare);
    if (!set) {
      set = new Set();
      reasonsByReq.set(bare, set);
    }
    set.add(key);
  };

  const stages = Array.isArray(readiness && readiness.stages) ? readiness.stages : [];
  for (const s of stages) {
    if (!s || !Array.isArray(s.checks)) continue;
    for (const c of s.checks) {
      if (!c || c.ok) continue;
      const failing = Array.isArray(c.failing) ? c.failing : [];
      if (c.name === 'stories:reqHasUs') {
        for (const f of failing) addReason(idOf(f), 'reqHasUs');
      } else if (c.name === 'skeleton:reqIntent') {
        for (const f of failing) addReason(idOf(f), 'reqIntent');
      } else if (c.name === 'skeleton:resolvedBy') {
        for (const f of failing) addReason(idOf(f), 'resolvedBy');
      } else if (c.name === 'stories:usFloors') {
        for (const f of failing) {
          const id = idOf(f);
          const reqId = reqIdForUs(id, tree);
          if (reqId) addReason(reqId, 'usFloors');
        }
      }
    }
  }

  // Zero-criteria stories (walked from the tree model so the row
  // lands even when no D4 check named this story explicitly) and
  // uncovered ACs (from coverage.tree).
  if (tree && Array.isArray(tree.userStories)) {
    for (const us of tree.userStories) {
      if (!us || typeof us !== 'object') continue;
      const criteria = Array.isArray(us.acceptanceCriteria) ? us.acceptanceCriteria : [];
      if (criteria.length === 0) {
        const reqId = typeof us.reqId === 'string' && us.reqId.length > 0 ? us.reqId : null;
        if (reqId) addReason(reqId, 'zeroCriteria');
      }
    }
  }
  const coverageReqs = readiness && readiness.coverage && readiness.coverage.tree
    ? (Array.isArray(readiness.coverage.tree.requirements) ? readiness.coverage.tree.requirements : [])
    : [];
  for (const r of coverageReqs) {
    if (!r || typeof r !== 'object') continue;
    const acs = Array.isArray(r.acs) ? r.acs : [];
    const anyUncovered = acs.some((a) => a && a.covered === false);
    if (anyUncovered) addReason(r.id, 'uncoveredAc');
  }

  const rows = [];
  const stable = Array.from(reasonsByReq.keys()).sort((a, b) => a.localeCompare(b));
  for (const reqId of stable) {
    const reasons = Array.from(reasonsByReq.get(reqId) || []).sort();
    const { stories, criteria, covered } = reqMetrics(reqId, readiness, tree);
    rows.push({
      reqId,
      stories,
      criteria,
      covered,
      thinReason: reasons,
      openHref: `#tab=requirements&entity=${reqId}`,
      traceHref: `#tab=readiness&sub=trace&entity=${reqId}`,
    });
  }
  return rows;
}

function idOf(f) {
  return (f && typeof f.id === 'string') ? f.id : '';
}

function reqIdForUs(id, tree) {
  const base = id ? id.split(':')[0] : '';
  if (!/^US-/.test(base)) return null;
  if (!tree || !Array.isArray(tree.userStories)) return null;
  // Walker tree model: `tree.userStories[].usId` is the id field
  // (src/core/store/walker.js uses sortById on 'usId'). An older
  // handcrafted fixture that only carries `.id` is accepted as a
  // fallback so the sub-view never breaks on a partial shape, but
  // the primary match is on `usId` because that is what the live
  // tree produces.
  const us = tree.userStories.find((u) => u && (u.usId === base || u.id === base));
  if (us && typeof us.reqId === 'string') return us.reqId;
  return null;
}

function reqMetrics(reqId, readiness, tree) {
  let stories = 0;
  let criteria = 0;
  if (tree && Array.isArray(tree.userStories)) {
    for (const us of tree.userStories) {
      if (!us || us.reqId !== reqId) continue;
      stories += 1;
      if (Array.isArray(us.acceptanceCriteria)) criteria += us.acceptanceCriteria.length;
    }
  }
  let covered = true;
  const coverageReqs = readiness && readiness.coverage && readiness.coverage.tree
    ? (Array.isArray(readiness.coverage.tree.requirements) ? readiness.coverage.tree.requirements : [])
    : [];
  const row = coverageReqs.find((r) => r && r.id === reqId);
  if (row) {
    if (row.coverageClass && row.coverageClass !== 'covered') covered = false;
    const acs = Array.isArray(row.acs) ? row.acs : [];
    if (acs.some((a) => a && a.covered === false)) covered = false;
  } else {
    // No coverage row for this REQ at all: the compute omitted it.
    // Treat as uncovered so the row's covered flag matches the
    // thinReason the row carries.
    covered = false;
  }
  return { stories, criteria, covered };
}

/**
 * Render the thin-requirements table or its empty state.
 *
 * @param {object} args
 * @param {ThinReqRow[]} args.rows
 * @returns {string}
 */
export function renderThinReqsTable(args) {
  const rows = args && Array.isArray(args.rows) ? args.rows : [];
  if (rows.length === 0) {
    return `<section class="rcf-thin-reqs" data-rcf-empty="yes" aria-labelledby="rcf-readiness-thin-heading">
  <header class="rcf-thin-reqs__head"><h3 id="rcf-readiness-thin-heading">Requirements that still need work</h3> <span class="rcf-badge rcf-badge--count">0</span></header>
  <p class="rcf-thin-reqs__empty">Every requirement has a plain description, a story, and resolving test coverage. Nothing is thin here.</p>
</section>`;
  }
  const body = rows.map((r) => {
    const reasonText = r.thinReason.map((k) => REASONS[k] || k).join('; ');
    const resolvedText = r.thinReason.map((k) => RESOLVED[k] || `resolved by: fix ${k}`).join('; ');
    const coveredLabel = r.covered ? 'yes' : 'no';
    return `<tr data-rcf-req="${escapeHtml(r.reqId)}" data-rcf-covered="${coveredLabel}">
  <td><code class="rcf-thin-reqs__id">${escapeHtml(r.reqId)}</code></td>
  <td>${escapeHtml(String(r.stories))}</td>
  <td>${escapeHtml(String(r.criteria))}</td>
  <td>${escapeHtml(coveredLabel)}</td>
  <td>${escapeHtml(reasonText)}</td>
  <td class="rcf-thin-reqs__resolved">${escapeHtml(resolvedText)}</td>
  <td><a href="${escapeHtml(r.openHref)}">Open</a> <a href="${escapeHtml(r.traceHref)}" class="rcf-thin-reqs__trace">Trace</a></td>
</tr>`;
  }).join('');
  return `<section class="rcf-thin-reqs" aria-labelledby="rcf-readiness-thin-heading">
  <header class="rcf-thin-reqs__head"><h3 id="rcf-readiness-thin-heading">Requirements that still need work</h3> <span class="rcf-badge rcf-badge--count">${rows.length}</span></header>
  <p class="rcf-thin-reqs__hint muted small">Each row names the reasons in plain words and what resolves them in the chain. Open opens the requirement; Trace lands on its chain.</p>
  <table class="rcf-thin-reqs__table">
    <thead><tr><th>Requirement</th><th>Stories</th><th>Criteria</th><th>Covered</th><th>Reasons</th><th>What resolves it</th><th></th></tr></thead>
    <tbody>${body}</tbody>
  </table>
</section>`;
}

// Exposed for the test and for other sub-views that want to render
// the "resolved" phrase alongside their own reason text (unresolved-
// pointers table in coverage-summary.js uses the same style).
export const THIN_RESOLVED = RESOLVED;

export const THIN_REASONS = REASONS;

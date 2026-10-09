// Readiness stage grid (FBS-206, TAC-4135-readiness-command-page,
// ADR-4139). Pure HTML string renderer: emits a two-column table
// (tree, delta) with one row per stage. Each VerdictGridCell carries
// pass/total/state and a failing-count link into the blocking table
// filtered to that stage.
//
// Viewer read-only (Dave constraint F7, ADR-4139): no command text,
// no write affordance. The failing count is a hash link
// (#tab=readiness&sub=blocking&stage=<D>) picked up by the blocking
// FilterBar wire (page-init.js).
//
// Acknowledgement source (AC-18005-6): stages[].state is the single
// source for the cell state ("acknowledged" when the pass-fold set
// it via a D8 freeze match). The reason reads from stages[].reason
// (notApplicable) or, for acknowledgements, from freezeRecord.gates
// via one helper (reasonForCell) so the grid never reads
// freezeRecord.gates directly from its row renderer.
//
// Node 24 ESM; no dependencies.

import { escapeHtml } from '../doc-renderers/helpers.js';
import { stageTitle } from './stage-legend.js';

/**
 * @typedef {object} VerdictGridCell
 * @property {number} pass
 * @property {number} total
 * @property {'passed'|'failing'|'acknowledged'|'notApplicable'} state
 * @property {number} failing       count of failing ids in that stage x scope
 * @property {string} [reason]      hover title (notApplicable or acknowledged)
 * @property {string} [href]        link target when failing>0
 */

/**
 * Build the cell shape for one (stage, scope) pair.
 *
 * @param {import('../../query/readiness.js').StageResult} s
 * @param {'tree'|'delta'} scope
 * @param {object | null | undefined} freezeRecord
 * @returns {VerdictGridCell}
 */
export function buildCell(s, scope, freezeRecord) {
  const checks = Array.isArray(s.checks) ? s.checks.filter((c) => c && c.over === scope) : [];
  let pass = 0;
  let total = 0;
  let failing = 0;
  for (const c of checks) {
    pass += Number.isFinite(c.pass) ? c.pass : 0;
    total += Number.isFinite(c.total) ? c.total : 0;
    if (!c.ok && Array.isArray(c.failing)) failing += c.failing.length;
  }
  const state = cellStateFromStage(s, checks);
  const reason = reasonForCell(s, state, freezeRecord);
  const cell = { pass, total, state, failing };
  if (reason) cell.reason = reason;
  if (failing > 0) {
    cell.href = `#tab=readiness&sub=blocking&stage=${encodeURIComponent(s.stage)}`;
  }
  return cell;
}

/**
 * Fold the per-scope cell state from stages[].state and the scope's
 * own checks. The stage-level state is authoritative for passed /
 * acknowledged / notApplicable (D8 and the acknowledge-sweep set it);
 * if the scope has no checks at all the cell is notApplicable; a
 * failing check in the scope flips the cell to failing even when the
 * other scope passed (so delta failures surface on their own column).
 *
 * @param {import('../../query/readiness.js').StageResult} s
 * @param {import('../../query/readiness.js').CheckResult[]} scopeChecks
 */
function cellStateFromStage(s, scopeChecks) {
  if (scopeChecks.length === 0) return 'notApplicable';
  // Stage-level acknowledgement wins over scope-specific failures:
  // foldState only sets state='acknowledged' when there is a failing
  // check and the gate is acked at the current tree hash, so the
  // acknowledged envelope is the authoritative verdict for both the
  // tree and delta columns.
  if (s.state === 'acknowledged') return 'acknowledged';
  if (scopeChecks.some((c) => !c.ok)) return 'failing';
  if (s.state === 'notApplicable') return 'notApplicable';
  return 'passed';
}

/**
 * Reason-helper: the hover title for a cell. notApplicable rows read
 * from stages[].reason; acknowledged rows read the ack-reason from
 * freezeRecord.gates[gate] (via this one function, not from the row
 * renderer); failing / passed rows return undefined (the stage-title
 * tooltip still fires at the <th> level).
 *
 * @param {import('../../query/readiness.js').StageResult} s
 * @param {VerdictGridCell['state']} state
 * @param {object | null | undefined} freezeRecord
 * @returns {string | undefined}
 */
export function reasonForCell(s, state, freezeRecord) {
  if (state === 'notApplicable') {
    return typeof s.reason === 'string' && s.reason.length > 0 ? s.reason : undefined;
  }
  if (state === 'acknowledged') {
    const gates = freezeRecord && typeof freezeRecord === 'object' ? freezeRecord.gates : null;
    const ack = gates && typeof gates === 'object' ? gates[s.gate] : null;
    // The freeze record writes the reason at gates[g].at.reason (see
    // src/cli/freeze.js buildGatesEntry / mergeAckedGates); the legacy
    // flat gates[g].reason is accepted as a fallback for older files.
    const at = ack && typeof ack === 'object' ? ack.at : null;
    if (at && typeof at === 'object' && typeof at.reason === 'string' && at.reason.length > 0) {
      return at.reason;
    }
    if (ack && typeof ack === 'object' && typeof ack.reason === 'string' && ack.reason.length > 0) {
      return ack.reason;
    }
    return undefined;
  }
  return undefined;
}

/**
 * Build the full stage-grid HTML (overview sub-view block).
 *
 * @param {object} args
 * @param {import('../../query/readiness.js').StageResult[]} args.stages
 * @param {object | null | undefined} [args.freezeRecord]
 * @returns {string}
 */
export function renderVerdictGrid({ stages, freezeRecord }) {
  const rows = Array.isArray(stages) ? stages : [];
  if (rows.length === 0) {
    return `<section class="rcf-readiness-grid" data-rcf-grid="verdict">`
      + `<p><em>No stages to render.</em></p>`
      + `</section>`;
  }
  const header = `<thead><tr>`
    + `<th scope="col">Stage</th>`
    + `<th scope="col" data-scope="tree">Tree</th>`
    + `<th scope="col" data-scope="delta">Delta</th>`
    + `</tr></thead>`;
  const body = rows.map((s) => {
    const title = stageTitle(s.stage) || s.stage;
    const tree = buildCell(s, 'tree', freezeRecord);
    const delta = buildCell(s, 'delta', freezeRecord);
    const stageCell = `<th scope="row" data-rcf-stage-ref="${escapeHtml(s.stage)}" title="${escapeHtml(title)}">`
      + `<span class="rcf-readiness-grid__stage-id">${escapeHtml(s.stage)}</span> `
      + `<code class="muted">${escapeHtml(s.gate)}</code>`
      + `</th>`;
    return `<tr data-rcf-stage="${escapeHtml(s.stage)}">`
      + stageCell
      + renderCellTd(s, 'tree', tree)
      + renderCellTd(s, 'delta', delta)
      + `</tr>`;
  }).join('\n');
  return `<section class="rcf-readiness-grid" data-rcf-grid="verdict">`
    + `<table class="rcf-readiness-grid__table rcf-cmd-table" data-rcf-table="verdict-grid">`
    + header
    + `<tbody>${body}</tbody>`
    + `</table>`
    + `</section>`;
}

function renderCellTd(s, scope, cell) {
  const stateClass = `rcf-readiness-grid__cell--${escapeHtml(cell.state)}`;
  const title = cell.reason ? ` title="${escapeHtml(cell.reason)}"` : '';
  const countsText = `${cell.pass}/${cell.total}`;
  const failingText = cell.failing > 0
    ? (cell.href
      ? ` <a class="rcf-readiness-grid__failing" href="${escapeHtml(cell.href)}" data-rcf-link="blocking-filtered" data-rcf-filter-stage="${escapeHtml(s.stage)}">${cell.failing} failing</a>`
      : ` <span class="rcf-readiness-grid__failing">${cell.failing} failing</span>`)
    : '';
  return `<td class="rcf-readiness-grid__cell ${stateClass}" data-rcf-cell-state="${escapeHtml(cell.state)}" data-rcf-cell-scope="${escapeHtml(scope)}" data-rcf-cell-pass="${cell.pass}" data-rcf-cell-total="${cell.total}" data-rcf-cell-failing="${cell.failing}"${title}>`
    + `<span class="rcf-readiness-grid__counts">${countsText}</span>`
    + failingText
    + `</td>`;
}

// Readiness tab renderer (REQ-180, TAC-4127-readiness-view, ADR-4127).
// Pure HTML string builder: takes the ReadinessResult (as produced by
// `computeReadiness` in `src/query/readiness.js`) and the operator
// profile text, emits the tabpanel body. Never recomputes readiness
// and never touches disk; the server loads the inputs once per
// rewalk (see `renderModelToPage`) so the Readiness tab and
// `rcf define readiness --json` cannot disagree for the same tree.
//
// Layout follows DEFINE step 2 spec section 5, top to bottom:
//   1 tree line; 2 verdict pills; 3 next-action per persona;
//   4 D1..D8 state chips; 5 blockers by persona; 6 delta list;
//   7 per-stage check detail; 8 retired (coverage sub-view, FBS-205);
//   9 decisions outstanding; 10 freeze state (plain words, FBS-204);
//  11 freeze record.

import { escapeHtml } from './doc-renderers/helpers.js';
import { formatTreeLine, formatVerdictLines, shortHash } from '../query/readiness.js';
import { pill } from './components/pill.js';
import { findingsList } from './components/findings-list.js';
import { diff } from './components/diff.js';
import { renderReadinessPO } from './readiness/po-layer.js';
import { renderStageLegend, stageTitle } from './readiness/stage-legend.js';

/**
 * @typedef {import('../query/readiness.js').ReadinessResult} ReadinessResult
 * @typedef {import('../query/readiness.js').StageResult} StageResult
 * @typedef {import('../query/readiness.js').CheckResult} CheckResult
 * @typedef {import('../query/readiness.js').Blocker} Blocker
 */

/**
 * Decide the register ordering from `profile.md` text. Same contract
 * as the CLI's `pickRegister` helper: first marker in the text wins;
 * absent / unrecognised yields `unstated`, which the tab orders as
 * productOwner-first (spec section 5).
 *
 * @param {string | null | undefined} text
 * @returns {'productOwner'|'engineer'|'unstated'}
 */
export function pickRegister(text) {
  if (typeof text !== 'string' || text.length === 0) return 'unstated';
  const markers = ['productOwner', 'engineer', 'unstated'];
  let best = null;
  let bestIdx = Infinity;
  for (const m of markers) {
    const idx = text.indexOf(m);
    if (idx !== -1 && idx < bestIdx) {
      bestIdx = idx;
      best = m;
    }
  }
  if (best === 'productOwner' || best === 'engineer') return best;
  return 'unstated';
}

/**
 * Build the full Readiness tabpanel inner HTML.
 *
 * @param {ReadinessResult | null} result - the computed readiness
 *   object, or null when the tree could not be computed
 * @param {object} [opts]
 * @param {string | null} [opts.profile] - profile.md text (register)
 * @param {object | null} [opts.freezeRecord] - loaded freeze record,
 *   for the Freeze record block (section 11)
 * @returns {string}
 */
export function renderReadinessPanel(result, opts = {}) {
  if (!result) {
    return '<p><em>Readiness could not be computed for this tree.</em></p>';
  }
  const register = pickRegister(opts.profile ?? null);
  const freezeRecord = opts.freezeRecord ?? null;
  const tree = opts.tree ?? null;
  const verdictLines = formatVerdictLines(result);

  // FBS-204 (ADR-4139): the engineer body no longer carries the blocker
  // cards (the top-level blocking table owns them) or renderFreezeNow
  // (a write control the GET-only server never wired). The next-action
  // block drops its CLI command text, and the freeze state is rendered
  // in plain words via renderFreezeState so the panel contains no shell
  // command text anywhere. renderStageDetail stays as the per-stage
  // breakdown, which keeps AC-18002-3 (no blocker id leaves the DOM)
  // true across the operator surface (the blocking table) and the
  // engineer surface (stage detail).
  //
  // FBS-205 (ADR-4139, AC-18004-*): the engineer body no longer carries
  // the standalone coverage block either; coverage is rendered by the
  // PO layer as the coverage sub-view (renderCoverageSummary) via the
  // numbers the compute actually produces (totals, unresolvedTest-
  // Pointers, requirements[].coverageClass), not the blank pass/total
  // the old renderCoverage read.
  const engineerBody = [
    renderTreeLine(result),
    renderVerdicts(result, verdictLines),
    renderNextActions(result, register),
    renderStageChips(result, freezeRecord),
    renderDelta(result, freezeRecord),
    renderStageDetail(result),
    renderDecisions(result),
    renderFreezeState(result),
    renderFreezeRecord(freezeRecord),
  ].join('\n');

  const poLayer = renderReadinessPO(result, { persona: register, engineerBody, tree });
  const legend = renderStageLegend();
  return `${poLayer}\n${legend}`;
}

// --- Block 1: tree line ------------------------------------------------

function renderTreeLine(result) {
  return `<div class="rcf-readiness-tree"><p>${escapeHtml(formatTreeLine(result))}</p></div>`;
}

// --- Block 2: verdict pills --------------------------------------------

function renderVerdicts(result, verdictLines) {
  const l = result.levels;
  const intentValue = l.intentComplete.ok ? 'yes' : 'no';
  const buildValue = l.readyToBuild.ok ? 'yes' : 'no';
  const intentPill = pill({
    value: verdictLines.intentComplete,
    variant: 'level-verdict-intent',
    title: `Intent complete: ${intentValue} (${l.intentComplete.blockedBy.length} blocker${l.intentComplete.blockedBy.length === 1 ? '' : 's'})`,
  });
  const buildPill = pill({
    value: verdictLines.readyToBuild,
    variant: 'level-verdict-build',
    title: `Ready to build: ${buildValue} (${l.readyToBuild.blockedBy.length} blocker${l.readyToBuild.blockedBy.length === 1 ? '' : 's'})`,
  });
  return `<div class="rcf-readiness-verdicts" data-rcf-intent-ok="${intentValue}" data-rcf-build-ok="${buildValue}">`
    + `<div class="rcf-readiness-verdict rcf-readiness-verdict--intent">${intentPill}`
    + ` <span class="rcf-readiness-verdict__count">${l.intentComplete.blockedBy.length}</span></div>`
    + `<div class="rcf-readiness-verdict rcf-readiness-verdict--build">${buildPill}`
    + ` <span class="rcf-readiness-verdict__count">${l.readyToBuild.blockedBy.length}</span></div>`
    + `</div>`;
}

// --- Block 3: next action per persona ----------------------------------

function renderNextActions(result, register) {
  const po = result.personas.productOwner.nextAction;
  const eng = result.personas.engineer.nextAction;
  const po_line = renderNextActionLine('product owner', po, 'productOwner');
  const eng_line = renderNextActionLine('engineer', eng, 'engineer');
  const order = register === 'engineer' ? [eng_line, po_line] : [po_line, eng_line];
  return `<div class="rcf-readiness-next-actions" data-rcf-register="${register}">`
    + order.join('')
    + `</div>`;
}

function renderNextActionLine(label, action, persona) {
  if (!action) {
    return `<p class="rcf-readiness-next-action rcf-readiness-next-action--${persona}">`
      + `<strong>Next action (${escapeHtml(label)}):</strong> none.`
      + `</p>`;
  }
  const ids = action.ids && action.ids.length > 0 ? ` on ${action.ids.join(', ')}` : '';
  const anchor = `#rcf-readiness-check-${encodeURIComponent(`${action.stage}:${action.check}`)}`;
  // FBS-204 (AC-18003-7, ADR-4139): no `Run <cmd>` line any more. The
  // owner acts in their agent session; the panel points at the chain
  // location and names what resolves the row in the blocking table.
  return `<p class="rcf-readiness-next-action rcf-readiness-next-action--${persona}">`
    + `<strong>Next action (${escapeHtml(label)}):</strong> `
    + `<a href="${escapeHtml(anchor)}">${escapeHtml(action.stage)} / ${escapeHtml(action.check)}</a>`
    + `${escapeHtml(ids)}.`
    + `</p>`;
}

// --- Block 4: stage chips D1..D8 ---------------------------------------

function renderStageChips(result, freezeRecord) {
  const chips = result.stages.map((s) => {
    const stateClass = chipStateClass(s.state);
    const legendTitle = stageTitle(s.stage);
    let title = `${s.stage} ${s.gate}: ${s.state}`;
    if (legendTitle && legendTitle !== s.stage) title = `${legendTitle} (${s.state})`;
    if (s.state === 'notApplicable' && s.reason) title = `${title} - ${s.reason}`;
    if (s.state === 'acknowledged' && freezeRecord && freezeRecord.gates && freezeRecord.gates[s.gate]) {
      const ack = freezeRecord.gates[s.gate];
      if (ack && typeof ack.reason === 'string' && ack.reason.length > 0) {
        title = `${title} - ${ack.reason}`;
      }
    }
    const label = `${s.stage}: ${s.state}`;
    return `<li class="rcf-readiness-chip rcf-readiness-chip--${stateClass}" data-rcf-stage-ref="${s.stage}">`
      + pill({ value: label, variant: 'gate-state', title })
      + `</li>`;
  }).join('');
  return `<ul class="rcf-readiness-chips">${chips}</ul>`;
}

function chipStateClass(state) {
  switch (state) {
    case 'passed':
      return 'green';
    case 'failing':
      return 'red';
    case 'acknowledged':
      return 'amber';
    case 'notApplicable':
      return 'grey';
    default:
      return 'grey';
  }
}

// --- Block 5 retired (FBS-204, ADR-4139): renderBlockersByPersona and
// its helpers (renderPersonaGroup, renderBlockerCard, buildIdWhyMap)
// are gone. The read-only blocking table in src/view/readiness/tables.js
// owns the per-item blocker surface for the operator, and the engineer
// surface is still carried below by renderStageDetail + the per-check
// findings-list. AC-18002-3 (no blocker id ever leaves the DOM) is
// preserved by that pair: every failing id in stages[].checks[].failing[]
// still appears in both tables.

// --- Block 6: delta list -----------------------------------------------

function renderDelta(result, freezeRecord) {
  const d = result.delta;
  const briefCount = Array.isArray(d.briefSince) ? d.briefSince.length : 0;
  const changedCount = (d.changed?.length ?? 0) + (d.added?.length ?? 0) + (d.removed?.length ?? 0);
  const frozenHashes = (freezeRecord && typeof freezeRecord === 'object' && freezeRecord.docHashes && typeof freezeRecord.docHashes === 'object')
    ? freezeRecord.docHashes
    : {};
  const currentHashes = (d && typeof d.currentDocHashes === 'object' && d.currentDocHashes !== null)
    ? d.currentDocHashes
    : {};
  const briefBlock = briefCount > 0
    ? `<section class="rcf-readiness-delta__group rcf-readiness-delta__group--brief">`
      + `<h4>Brief statements since freeze <span class="rcf-readiness-delta__count">${briefCount}</span></h4>`
      + `<ul>${d.briefSince.map((n) => `<li>#${escapeHtml(String(n))}</li>`).join('')}</ul>`
      + `</section>`
    : '';
  const changedBlock = changedCount > 0
    ? `<section class="rcf-readiness-delta__group rcf-readiness-delta__group--documents">`
      + `<h4>Documents changed <span class="rcf-readiness-delta__count">${changedCount}</span></h4>`
      + `<ul>`
      + (d.added ?? []).map((id) => `<li><a href="#${escapeHtml(id)}">${escapeHtml(id)}</a> <em>added</em>${renderDocDiff(id, frozenHashes, currentHashes, 'added')}</li>`).join('')
      + (d.changed ?? []).map((id) => `<li><a href="#${escapeHtml(id)}">${escapeHtml(id)}</a> <em>changed</em>${renderDocDiff(id, frozenHashes, currentHashes, 'changed')}</li>`).join('')
      + (d.removed ?? []).map((id) => `<li>${escapeHtml(id)} <em>removed</em>${renderDocDiff(id, frozenHashes, currentHashes, 'removed')}</li>`).join('')
      + `</ul>`
      + `</section>`
    : '';
  if (!briefBlock && !changedBlock) {
    return `<section class="rcf-readiness-delta"><p><em>No delta since the last freeze.</em></p></section>`;
  }
  return `<section class="rcf-readiness-delta">${briefBlock}${changedBlock}</section>`;
}

/**
 * Document-level hash diff for one changed / added / removed id.
 * Spec section 5 block 6 pins a real `diff` component here; section 10
 * decision 1 scopes 0.29.0 to document-level only (criterion-level
 * deferred). The freeze record does not persist document bodies in
 * 0.29.0 (freeze-record.js schema: `docHashes` only — no `docs` /
 * `snapshot` section), so this ships the hash-only variant: both
 * columns show the short-hash subtitle and the frozen side carries
 * a muted note stating the body was not captured. NOTES in the brief.
 */
function renderDocDiff(id, frozenHashes, currentHashes, kind) {
  const frozenHash = typeof frozenHashes?.[id] === 'string' ? frozenHashes[id] : null;
  const currentHash = typeof currentHashes?.[id] === 'string' ? currentHashes[id] : null;
  const beforeNote = 'frozen body not captured in freeze record 0.29.0';
  const before = kind === 'added'
    ? { note: 'not in the frozen tree' }
    : { hash: frozenHash ?? '', note: beforeNote };
  const after = kind === 'removed'
    ? { note: 'removed from the live tree' }
    : { hash: currentHash ?? '', note: 'current body available on the document tab' };
  return ` ${diff(before, after)}`;
}

// --- Block 7: per-stage check detail -----------------------------------

function renderStageDetail(result) {
  const stageBlocks = result.stages.map((s) => renderStage(s)).join('');
  return `<section class="rcf-readiness-stage-detail">`
    + `<h3>Stage detail</h3>`
    + stageBlocks
    + `</section>`;
}

/**
 * @param {StageResult} s
 */
function renderStage(s) {
  const chip = pill({ value: s.state, variant: 'gate-state', title: `${s.stage} ${s.gate}` });
  const checks = s.checks.map((c) => renderCheck(s, c)).join('');
  return `<section class="rcf-readiness-stage" id="rcf-readiness-stage-${escapeHtml(s.stage)}">`
    + `<h4>${escapeHtml(s.stage)} <code>${escapeHtml(s.gate)}</code> ${chip}</h4>`
    + checks
    + `</section>`;
}

/**
 * @param {StageResult} s
 * @param {CheckResult} c
 */
function renderCheck(s, c) {
  const checkId = `rcf-readiness-check-${encodeURIComponent(`${s.stage}:${c.name}`)}`;
  const personaPill = pill({
    value: c.persona === 'productOwner' ? 'PO' : 'eng',
    variant: 'persona',
    title: c.persona,
  });
  const statusLabel = c.ok ? 'ok' : 'fail';
  const items = c.ok
    ? ''
    : findingsList({
      heading: c.question,
      count: c.failing.length,
      items: c.failing.map((f) => ({ id: f.id, why: f.why, href: `#${f.id}` })),
    });
  return `<div class="rcf-readiness-check" id="${escapeHtml(checkId)}" data-rcf-check-ok="${c.ok ? 'yes' : 'no'}">`
    + `<div class="rcf-readiness-check__meta">`
    + `<strong>${escapeHtml(c.name)}</strong> ${personaPill} `
    + `<span class="rcf-readiness-check__over">over ${escapeHtml(c.over)}</span> `
    + `<span class="rcf-readiness-check__counts">${c.pass}/${c.total}</span> `
    + `<span class="rcf-readiness-check__status rcf-readiness-check__status--${statusLabel}">${statusLabel}</span>`
    + `</div>`
    + items
    + `</div>`;
}

// --- Block 8 retired (FBS-205) ----------------------------------------
//
// The former renderCoverage block read `coverage.tree.pass` and
// `coverage.tree.total`, which do not exist on the real compute
// (coverage.tree carries `totals.{...}` and
// `requirements[].coverageClass`). The result rendered as "pass /"
// blanks on every live tree. The PO layer now owns the coverage
// sub-view via renderCoverageSummary, which reads the fields
// coverage actually produces and never prints a blank number
// (AC-18004-1, AC-18004-6, AC-18004-7).

// --- Block 9: decisions outstanding ------------------------------------

function renderDecisions(result) {
  const items = Array.isArray(result.decisions) ? result.decisions : [];
  if (items.length === 0) {
    return `<section class="rcf-readiness-decisions"><h3>Decisions outstanding</h3><p><em>No open decisions.</em></p></section>`;
  }
  const list = items.map((d, idx) => {
    const n = typeof d.number === 'number' ? d.number : idx + 1;
    const q = typeof d.question === 'string' ? d.question : '(no question)';
    const def = typeof d.default === 'string' ? ` <em>default:</em> ${escapeHtml(d.default)}` : '';
    const options = Array.isArray(d.options) && d.options.length > 0
      ? ` <em>options:</em> ${d.options.map((o) => escapeHtml(String(o))).join(', ')}`
      : '';
    return `<li><strong>#${escapeHtml(String(n))}</strong> ${escapeHtml(q)}${options}${def}</li>`;
  }).join('');
  return `<section class="rcf-readiness-decisions"><h3>Decisions outstanding</h3><ol>${list}</ol></section>`;
}

// --- Block 10: freeze state --------------------------------------------
//
// Replaces renderFreezeNow (FBS-204, AC-18001-6 amended, AC-18003-7,
// ADR-4139). The viewer is read-only: no freeze control, no CLI
// command text. When readyToBuild is false the block names the
// failing gates from `levels.readyToBuild.blockedBy` in plain words
// so a reader can see which stages still need work. When
// readyToBuild is true the block names what a freeze would record
// (hash, timestamp, counts, acknowledged gates), without proposing
// to run anything from the page.

function renderFreezeState(result) {
  const ok = result.levels.readyToBuild.ok;
  const freezeableAttr = ok ? 'yes' : 'no';
  if (ok) {
    const shortCurrent = escapeHtml(shortHash(result.tree.currentTreeHash));
    return `<section class="rcf-readiness-freeze-state" data-rcf-freezeable="${freezeableAttr}">`
      + `<h3>Freeze state</h3>`
      + `<p>Ready to freeze. A freeze would record the current tree hash <code>${shortCurrent}</code>, the timestamp, the note, the counts and the acknowledged gates with their reasons.</p>`
      + `</section>`;
  }
  const gates = [...new Set(result.levels.readyToBuild.blockedBy.map((b) => b.gate).filter(Boolean))].sort();
  if (gates.length === 0) {
    return `<section class="rcf-readiness-freeze-state" data-rcf-freezeable="${freezeableAttr}">`
      + `<h3>Freeze state</h3>`
      + `<p>Not ready to freeze.</p>`
      + `</section>`;
  }
  const words = gates.length === 1
    ? `the <code>${escapeHtml(gates[0])}</code> gate`
    : `${gates.length} gates: ${gates.map((g) => `<code>${escapeHtml(g)}</code>`).join(', ')}`;
  return `<section class="rcf-readiness-freeze-state" data-rcf-freezeable="${freezeableAttr}">`
    + `<h3>Freeze state</h3>`
    + `<p>Not ready to freeze. The build is held by ${words}. The blocking table above names what resolves each failing item.</p>`
    + `</section>`;
}

// --- Block 11: freeze record -------------------------------------------

function renderFreezeRecord(freezeRecord) {
  if (!freezeRecord) {
    return `<section class="rcf-readiness-freeze-record"><h3>Freeze record</h3><p><em>No freeze record on disk.</em></p></section>`;
  }
  const hash = typeof freezeRecord.treeHash === 'string' ? shortHash(freezeRecord.treeHash) : '(no hash)';
  const when = typeof freezeRecord.frozenAt === 'string' ? freezeRecord.frozenAt : '(no timestamp)';
  const note = typeof freezeRecord.note === 'string' ? freezeRecord.note : '';
  const counts = freezeRecord.counts && typeof freezeRecord.counts === 'object'
    ? Object.entries(freezeRecord.counts)
      .map(([k, v]) => `<li>${escapeHtml(k)}: ${escapeHtml(String(v))}</li>`)
      .join('')
    : '';
  const gates = freezeRecord.gates && typeof freezeRecord.gates === 'object'
    ? Object.entries(freezeRecord.gates)
      .map(([k, v]) => `<li><code>${escapeHtml(k)}</code>: ${escapeHtml(v && typeof v === 'object' && typeof v.reason === 'string' ? v.reason : String(v ?? ''))}</li>`)
      .join('')
    : '';
  return `<section class="rcf-readiness-freeze-record">`
    + `<h3>Freeze record</h3>`
    + `<p><strong>Hash:</strong> <code>${escapeHtml(hash)}</code></p>`
    + `<p><strong>When:</strong> ${escapeHtml(when)}</p>`
    + (note ? `<p><strong>Note:</strong> ${escapeHtml(note)}</p>` : '')
    + (counts ? `<h4>Counts</h4><ul>${counts}</ul>` : '')
    + (gates ? `<h4>Acknowledged gates</h4><ul>${gates}</ul>` : '')
    + `</section>`;
}

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
//   7 per-stage check detail; 8 coverage tree-vs-delta;
//   9 decisions outstanding; 10 freeze-now control; 11 freeze record.

import { escapeHtml } from './doc-renderers/helpers.js';
import { formatTreeLine, formatVerdictLines, shortHash } from '../query/readiness.js';
import { pill } from './components/pill.js';
import { findingsList } from './components/findings-list.js';
import { diff } from './components/diff.js';

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
  const verdictLines = formatVerdictLines(result);

  return [
    renderTreeLine(result),
    renderVerdicts(result, verdictLines),
    renderNextActions(result, register),
    renderStageChips(result, freezeRecord),
    renderBlockersByPersona(result, register),
    renderDelta(result),
    renderStageDetail(result),
    renderCoverage(result),
    renderDecisions(result),
    renderFreezeNow(result),
    renderFreezeRecord(freezeRecord),
  ].join('\n');
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
  const ids = action.ids && action.ids.length > 0 ? ` ids: ${action.ids.join(', ')}` : '';
  const anchor = `#rcf-readiness-check-${encodeURIComponent(`${action.stage}:${action.check}`)}`;
  return `<p class="rcf-readiness-next-action rcf-readiness-next-action--${persona}">`
    + `<strong>Next action (${escapeHtml(label)}):</strong> `
    + `<a href="${escapeHtml(anchor)}">${escapeHtml(action.stage)} / ${escapeHtml(action.check)}</a>`
    + `${escapeHtml(ids)}. `
    + `Run <code>${escapeHtml(action.command)}</code> after editing.`
    + `</p>`;
}

// --- Block 4: stage chips D1..D8 ---------------------------------------

function renderStageChips(result, freezeRecord) {
  const chips = result.stages.map((s) => {
    const stateClass = chipStateClass(s.state);
    let title = `${s.stage} ${s.gate}: ${s.state}`;
    if (s.state === 'notApplicable' && s.reason) title = `${title} - ${s.reason}`;
    if (s.state === 'acknowledged' && freezeRecord && freezeRecord.gates && freezeRecord.gates[s.gate]) {
      const ack = freezeRecord.gates[s.gate];
      if (ack && typeof ack.reason === 'string' && ack.reason.length > 0) {
        title = `${title} - ${ack.reason}`;
      }
    }
    const label = `${s.stage}: ${s.state}`;
    return `<li class="rcf-readiness-chip rcf-readiness-chip--${stateClass}">`
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

// --- Block 5: blockers by persona --------------------------------------

function renderBlockersByPersona(result, register) {
  const po = result.personas.productOwner.blockers;
  const eng = result.personas.engineer.blockers;
  const poBlock = renderPersonaGroup('productOwner', 'Product owner', 'question', po, register, 'open');
  const engBlock = renderPersonaGroup('engineer', 'Engineer', 'check blocking', eng, register, 'closed');
  // When the register is engineer, the engineer group opens first and
  // the PO group collapses; `unstated` and `productOwner` keep PO open.
  const [first, second] = register === 'engineer'
    ? [renderPersonaGroup('engineer', 'Engineer', 'check blocking', eng, register, 'open'),
       renderPersonaGroup('productOwner', 'Product owner', 'question', po, register, 'closed')]
    : [poBlock, engBlock];
  return `<section class="rcf-readiness-blockers-by-persona" data-rcf-register="${register}">`
    + first + second
    + `</section>`;
}

/**
 * @param {'productOwner'|'engineer'} persona
 * @param {string} heading
 * @param {string} singular - 'question' | 'check blocking'
 * @param {Blocker[]} blockers
 * @param {'productOwner'|'engineer'|'unstated'} register
 * @param {'open'|'closed'} state
 */
function renderPersonaGroup(persona, heading, singular, blockers, register, state) {
  const plural = singular === 'question' ? 'questions' : 'checks blocking';
  const count = blockers.length;
  const noun = count === 1 ? singular : plural;
  const summary = `${heading}: ${count} ${noun}`;
  const openAttr = state === 'open' ? ' open' : '';
  if (count === 0) {
    return `<details class="rcf-readiness-persona rcf-readiness-persona--${persona}" data-rcf-persona-state="${state}"${openAttr}>`
      + `<summary><strong>${escapeHtml(heading)}:</strong> 0 ${plural}.</summary>`
      + `</details>`;
  }
  const items = blockers.map((b) => renderBlockerCard(b)).join('');
  return `<details class="rcf-readiness-persona rcf-readiness-persona--${persona}" data-rcf-persona-state="${state}"${openAttr}>`
    + `<summary><strong>${escapeHtml(summary)}</strong></summary>`
    + items
    + `</details>`;
}

/**
 * @param {Blocker} b
 */
function renderBlockerCard(b) {
  // Map ids to anchor items — each id is a document id and the hash
  // routing in html-page.js resolves `#<id>` to the right tab.
  const items = (b.ids ?? []).slice(0, 20).map((id) => ({
    id,
    why: '',
    href: `#${id}`,
  }));
  // The 'why' for each id lives on `stages[].checks[].failing[]` but
  // we do not have that here; this is a design question we noted —
  // the findings list carries the heading + id anchors, and the per-
  // stage detail block (section 7) carries the id + why pairs. The
  // readiness tab anchors to the per-check row for the fine detail.
  return `<div class="rcf-readiness-blocker" data-rcf-stage="${escapeHtml(b.stage)}" data-rcf-check="${escapeHtml(b.check)}" data-rcf-persona="${escapeHtml(b.persona)}">`
    + `<div class="rcf-readiness-blocker__meta">`
    + `<span class="rcf-readiness-blocker__stage">${escapeHtml(b.stage)}</span> `
    + `<span class="rcf-readiness-blocker__check">${escapeHtml(b.check)}</span> `
    + pill({ value: b.persona === 'productOwner' ? 'PO' : 'eng', variant: 'persona', title: b.persona })
    + ` <span class="rcf-readiness-blocker__over">over ${escapeHtml(b.over)}</span>`
    + `</div>`
    + findingsList({ heading: b.question, count: b.failingCount, items })
    + `</div>`;
}

// --- Block 6: delta list -----------------------------------------------

function renderDelta(result) {
  const d = result.delta;
  const briefCount = Array.isArray(d.briefSince) ? d.briefSince.length : 0;
  const changedCount = (d.changed?.length ?? 0) + (d.added?.length ?? 0) + (d.removed?.length ?? 0);
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
      + (d.added ?? []).map((id) => `<li><a href="#${escapeHtml(id)}">${escapeHtml(id)}</a> <em>added</em></li>`).join('')
      + (d.changed ?? []).map((id) => `<li><a href="#${escapeHtml(id)}">${escapeHtml(id)}</a> <em>changed</em>${renderDocDiff(id)}</li>`).join('')
      + (d.removed ?? []).map((id) => `<li>${escapeHtml(id)} <em>removed</em></li>`).join('')
      + `</ul>`
      + `</section>`
    : '';
  if (!briefBlock && !changedBlock) {
    return `<section class="rcf-readiness-delta"><p><em>No delta since the last freeze.</em></p></section>`;
  }
  return `<section class="rcf-readiness-delta">${briefBlock}${changedBlock}</section>`;
}

function renderDocDiff(_id) {
  // Document-level diff is deferred to the delta loader; keep the
  // component call-site here so the markup stays stable even when the
  // frozen snapshot wiring lands. 0.29.0 ships a placeholder render.
  return ` ${diff(null, null)}`;
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

// --- Block 8: coverage tree-vs-delta -----------------------------------

function renderCoverage(result) {
  const t = result.coverage?.tree ?? null;
  const d = result.coverage?.delta ?? [];
  const impactedCount = result.delta?.impacted?.length ?? 0;
  const impactedFbsCount = result.delta?.impactedFbs?.length ?? 0;
  const treeCol = t
    ? `<pre class="rcf-readiness-coverage__tree">pass ${escapeHtml(String(t.pass ?? ''))} / ${escapeHtml(String(t.total ?? ''))}</pre>`
    : `<p><em>No tree-wide coverage result.</em></p>`;
  const deltaRows = d.length > 0
    ? `<ul>${d.map((cv) => `<li>${escapeHtml(cv.reqId ?? cv.scope ?? 'delta')}: ${escapeHtml(String(cv.pass ?? ''))} / ${escapeHtml(String(cv.total ?? ''))}</li>`).join('')}</ul>`
    : `<p><em>No per-REQ delta coverage.</em></p>`;
  return `<section class="rcf-readiness-coverage">`
    + `<h3>Coverage</h3>`
    + `<div class="rcf-readiness-coverage__cols">`
    + `<div class="rcf-readiness-coverage__col rcf-readiness-coverage__col--tree"><h4>Tree</h4>${treeCol}</div>`
    + `<div class="rcf-readiness-coverage__col rcf-readiness-coverage__col--delta"><h4>Delta</h4>${deltaRows}</div>`
    + `</div>`
    + `<p class="rcf-readiness-coverage__counts">`
    + `re-verify: ${impactedCount} &middot; re-execute: ${impactedFbsCount}`
    + `</p>`
    + `</section>`;
}

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

// --- Block 10: freeze now ----------------------------------------------

function renderFreezeNow(result) {
  const ok = result.levels.readyToBuild.ok;
  const disabledAttr = ok ? '' : ' disabled';
  const failingGates = ok
    ? []
    : [...new Set(result.levels.readyToBuild.blockedBy.map((b) => b.gate))].sort();
  const failingList = failingGates.length > 0
    ? ` <span class="rcf-readiness-freeze-now__failing">Failing gates: ${failingGates.map((g) => escapeHtml(g)).join(', ')}</span>`
    : '';
  const cmd = `rcf define freeze`;
  const willRecord = ok
    ? `<p>Will record: tree hash <code>${escapeHtml(shortHash(result.tree.currentTreeHash))}</code>, timestamp, note, counts and acknowledged gates with reasons.</p>`
    : '';
  return `<section class="rcf-readiness-freeze-now" data-rcf-freezeable="${ok ? 'yes' : 'no'}">`
    + `<h3>Freeze now</h3>`
    + `<button type="button" class="rcf-readiness-freeze-now__btn"${disabledAttr}>Freeze</button>`
    + ` <code>${escapeHtml(cmd)}</code>`
    + failingList
    + willRecord
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

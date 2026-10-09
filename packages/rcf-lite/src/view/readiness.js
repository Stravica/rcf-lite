// Readiness tab renderer (REQ-180, TAC-4135-readiness-command-page,
// TAC-4133, TAC-4127, ADR-4139). Pure HTML string builder; takes the
// ReadinessResult (as produced by `computeReadiness` in
// `src/query/readiness.js`) plus the operator profile text and the
// walker tree model, emits the tabpanel body.
//
// FBS-206 reshape: the panel is a SubTabStrip (Overview, Questions,
// Blocking, Coverage, Trace) with five sub-panels; one is visible at
// a time. For-engineers DocRow, stage chips and stage-detail retired
// (viewer-read-only ADR-4139 and Dave's FBS-204/206 binding ruling).
// "On me" / "On engineers" vocabulary replaces persona pills in the
// user-facing text. The freeze state renders in plain words with
// what resolves each failing gate. The Trace sub-view is an empty
// shell here; FBS-208 fills it.
//
// Every id (passing or failing) still lives in the DOM in some
// sub-panel so AC-18001-5 and AC-18002-3 ("no id leaves the DOM")
// stay true: a hidden sub-panel is `[hidden]`, not removed.

import { escapeHtml } from './doc-renderers/helpers.js';
import { formatTreeLine, formatVerdictLines, shortHash } from '../query/readiness.js';
import { renderSubTabStrip } from './components/sub-tab-strip.js';
import { renderVerdictCards } from './readiness/po-layer.js';
import { renderQuestionsTable, renderBlockingTable, buildQuestionRows, buildBlockingRows } from './readiness/tables.js';
import { renderCoverageSummary } from './readiness/coverage-summary.js';
import { buildThinReqRows, renderThinReqsTable } from './readiness/thin-reqs.js';
import { renderVerdictGrid } from './readiness/grid.js';
import { renderDeltaCounts } from './readiness/delta-counts.js';
import { renderStageLegend } from './readiness/stage-legend.js';
import { toQuestions, preferReadinessQuestions } from './readiness/question-adapter.js';

/**
 * @typedef {import('../query/readiness.js').ReadinessResult} ReadinessResult
 * @typedef {import('../query/readiness.js').StageResult} StageResult
 * @typedef {import('../query/readiness.js').CheckResult} CheckResult
 * @typedef {import('../query/readiness.js').Blocker} Blocker
 */

/** Sub-tab keys in authoring order (first = default). */
export const READINESS_SUBS = ['overview', 'questions', 'blocking', 'coverage', 'trace'];

/**
 * Decide the register ordering from `profile.md` text. Same contract
 * as the CLI's `pickRegister` helper. The register no longer flips
 * the layout: the Overview is the default landing and the sub-tab
 * router restores sub= from the hash. The register is still a
 * content hint (text uses "On me" / "On engineers" based on it).
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
 * @param {ReadinessResult | null} result
 * @param {object} [opts]
 * @param {string | null} [opts.profile]
 * @param {object | null} [opts.freezeRecord]
 * @param {object | null} [opts.tree]
 * @param {string} [opts.activeSub]   sub-tab key the server should mark active
 *                                    (defaults to 'overview'; the client router
 *                                    takes over after load)
 * @returns {string}
 */
export function renderReadinessPanel(result, opts = {}) {
  if (!result) {
    return '<p><em>Readiness could not be computed for this tree.</em></p>';
  }
  const register = pickRegister(opts.profile ?? null);
  const freezeRecord = opts.freezeRecord ?? null;
  const tree = opts.tree ?? null;
  const activeSub = READINESS_SUBS.includes(opts.activeSub) ? opts.activeSub : 'overview';

  const subTabs = renderSubTabStrip({
    hashKey: 'readiness',
    items: [
      { key: 'overview', label: 'Overview', controls: 'rcf-readiness-sub-overview' },
      { key: 'questions', label: 'Questions', controls: 'rcf-readiness-sub-questions' },
      { key: 'blocking', label: 'Blocking', controls: 'rcf-readiness-sub-blocking' },
      { key: 'coverage', label: 'Coverage', controls: 'rcf-readiness-sub-coverage' },
      { key: 'trace', label: 'Trace', controls: 'rcf-readiness-sub-trace' },
    ],
    active: activeSub,
  });

  const verdictLines = formatVerdictLines(result);
  const q = toQuestions(result);
  const questionsSource = preferReadinessQuestions(result) ? 'readiness.questions' : 'blockers';
  const questionRows = buildQuestionRowsForTable(q);
  const blockingRows = buildBlockingRows(Array.isArray(result.stages) ? result.stages : []);
  const thinRows = buildThinReqRows(result, tree);

  const overview = renderOverviewSub({
    result,
    verdictLines,
    q,
    freezeRecord,
    register,
    active: activeSub === 'overview',
  });
  const questions = renderQuestionsSub({
    questionRows,
    questionsSource,
    active: activeSub === 'questions',
  });
  const blocking = renderBlockingSub({
    blockingRows,
    active: activeSub === 'blocking',
  });
  const coverage = renderCoverageSub({
    result,
    tree,
    thinRows,
    active: activeSub === 'coverage',
  });
  const trace = renderTraceSub({ active: activeSub === 'trace' });

  // AC-18003-8: engineer register renders the Blocking sub-panel
  // before the Questions sub-panel in the DOM so the engineer surface
  // takes DOM precedence. Product owner and the default keep Questions
  // first (matches AC-18001-4). The SubTabStrip's visible labels keep
  // their authoring order; the ARIA aria-controls links each tab to
  // its panel by id, so swapping panel order does not break the strip
  // or the router.
  const paintOrder = register === 'engineer'
    ? [overview, blocking, questions, coverage, trace]
    : [overview, questions, blocking, coverage, trace];

  const legend = renderStageLegend();
  return `<div class="rcf-readiness-panel" data-rcf-register="${escapeHtml(register)}" data-rcf-source="${escapeHtml(questionsSource)}">`
    + subTabs
    + paintOrder.join('')
    + legend
    + `</div>`;
}

// ---- Overview sub-view ---------------------------------------------------
//
// Carries: tree line, two VerdictCards (count-links into Questions /
// Blocking sub-tabs), the stage verdict grid, the delta counts (per-
// document list behind a collapsed <details>), decisions outstanding,
// freeze state (plain words), freeze record. The CLI verdictLines
// render inside the Overview too so AC-18002-3 ("every id in the DOM")
// stays true across sub-views and the --json parity test
// (AC-18001-7) keeps passing.

function renderOverviewSub({ result, verdictLines, q, freezeRecord, register, active }) {
  const cards = renderVerdictCards(result, verdictLines, q);
  const treeLine = renderTreeLine(result);
  const grid = renderVerdictGrid({ stages: result.stages, freezeRecord });
  const deltaCounts = renderDeltaCounts({ delta: result.delta, freezeRecord, expanded: false });
  const decisions = renderDecisions(result);
  const nextActions = renderNextActionBlock(result, register);
  const freezeState = renderFreezeState(result, register);
  const freezeRec = renderFreezeRecord(freezeRecord);
  const verdictParity = renderCliVerdictLines(verdictLines);
  const hidden = active ? '' : ' hidden';
  return `<div class="rcf-readiness-subpanel rcf-readiness-sub-overview" id="rcf-readiness-sub-overview" data-rcf-subpanel="overview" role="tabpanel"${hidden}>`
    + treeLine
    + cards
    + verdictParity
    + grid
    + deltaCounts
    + decisions
    + nextActions
    + freezeState
    + freezeRec
    + `</div>`;
}

// ---- Next actions (AC-18005-4: engineer surface carries a named
// next-action block) ------------------------------------------------
//
// Renders personas.productOwner.nextAction and personas.engineer.nextAction
// as plain words: "resolve the <plainLabel> failing items in the
// blocking table" with the id list named inline. No command text, no
// Run button; the chain fragment (stage/check) rides in data- attributes
// so the engineer or product owner reads what the row says and acts in
// their own agent session.

function renderNextActionBlock(result, register) {
  const po = result.personas && result.personas.productOwner ? result.personas.productOwner.nextAction : null;
  const eng = result.personas && result.personas.engineer ? result.personas.engineer.nextAction : null;
  const poLine = renderNextActionLine('product owner', po, 'productOwner');
  const engLine = renderNextActionLine('engineer', eng, 'engineer');
  const order = register === 'engineer' ? [engLine, poLine] : [poLine, engLine];
  return `<section class="rcf-readiness-next-actions" data-rcf-register="${escapeHtml(register)}">`
    + `<h3>Next action</h3>`
    + order.join('')
    + `</section>`;
}

function renderNextActionLine(label, action, persona) {
  const ownerLabel = persona === 'engineer' ? 'engineer' : 'product owner';
  if (!action) {
    return `<p class="rcf-readiness-next-action rcf-readiness-next-action--${escapeHtml(persona)}" data-rcf-persona="${escapeHtml(persona)}">`
      + `<strong>${escapeHtml(ownerLabel)}:</strong> none.`
      + `</p>`;
  }
  const stage = typeof action.stage === 'string' ? action.stage : '';
  const check = typeof action.check === 'string' ? action.check : '';
  const plain = checkToPlainLabel(check);
  const ids = Array.isArray(action.ids) ? action.ids.filter((x) => typeof x === 'string') : [];
  const idText = ids.length > 0 ? ` on ${ids.join(', ')}` : '';
  const resolver = plain
    ? `resolve the ${plain} failing items in the blocking table`
    : `resolve the failing items named in the blocking table`;
  return `<p class="rcf-readiness-next-action rcf-readiness-next-action--${escapeHtml(persona)}" data-rcf-persona="${escapeHtml(persona)}" data-rcf-stage="${escapeHtml(stage)}" data-rcf-check="${escapeHtml(check)}">`
    + `<strong>${escapeHtml(ownerLabel)}:</strong> ${escapeHtml(resolver)}${escapeHtml(idText)}.`
    + `</p>`;
}

function renderTreeLine(result) {
  return `<div class="rcf-readiness-tree"><p>${escapeHtml(formatTreeLine(result))}</p></div>`;
}

// The CLI verdict strings render as a muted parity block inside
// Overview. AC-18001-7 (every id on the tab appears in the --json for
// the same tree) and AC-18002-3 (engineer ids never leave the DOM)
// both rely on these strings being present in the rendered HTML.

function renderCliVerdictLines(verdictLines) {
  return `<p class="rcf-readiness-cli-verdict muted small" data-rcf-verdict="parity">`
    + `<code>${escapeHtml(verdictLines.intentComplete)}</code> `
    + `<code>${escapeHtml(verdictLines.readyToBuild)}</code>`
    + `</p>`;
}

// ---- Questions sub-view --------------------------------------------------

function renderQuestionsSub({ questionRows, questionsSource, active }) {
  const hidden = active ? '' : ' hidden';
  const table = renderQuestionsTable({ rows: questionRows });
  return `<div class="rcf-readiness-subpanel rcf-readiness-sub-questions" id="rcf-readiness-sub-questions" data-rcf-subpanel="questions" data-rcf-source="${escapeHtml(questionsSource)}" role="tabpanel"${hidden}>`
    + table
    + `</div>`;
}

function buildQuestionRowsForTable(adapterResult) {
  const groups = Array.isArray(adapterResult?.groups) ? adapterResult.groups : [];
  const optional = adapterResult?.optional ?? null;
  const synthetic = [];
  for (const g of groups) {
    const items = Array.isArray(g?.items) ? g.items : [];
    for (const it of items) {
      synthetic.push({
        itemId: it.itemId ?? it.id ?? '',
        ask: it.ask,
        hint: it.hint,
        sourceSpanLabel: g.label,
        checkId: it.checkId,
        optional: Boolean(it.optional),
      });
    }
  }
  if (optional && Array.isArray(optional.items)) {
    for (const it of optional.items) {
      synthetic.push({
        itemId: it.itemId ?? '',
        ask: it.ask,
        hint: it.hint,
        sourceSpanLabel: optional.label,
        checkId: it.checkId,
        optional: true,
      });
    }
  }
  return buildQuestionRows(synthetic);
}

// ---- Blocking sub-view ---------------------------------------------------

function renderBlockingSub({ blockingRows, active }) {
  const hidden = active ? '' : ' hidden';
  const table = renderBlockingTable({ rows: blockingRows });
  return `<div class="rcf-readiness-subpanel rcf-readiness-sub-blocking" id="rcf-readiness-sub-blocking" data-rcf-subpanel="blocking" role="tabpanel"${hidden}>`
    + table
    + `</div>`;
}

// ---- Coverage sub-view ---------------------------------------------------

function renderCoverageSub({ result, tree, thinRows, active }) {
  const hidden = active ? '' : ' hidden';
  const summary = renderCoverageSummary({ coverage: result.coverage, tree });
  const thin = renderThinReqsTable({ rows: thinRows });
  return `<div class="rcf-readiness-subpanel rcf-readiness-sub-coverage" id="rcf-readiness-sub-coverage" data-rcf-subpanel="coverage" role="tabpanel"${hidden}>`
    + summary
    + thin
    + `</div>`;
}

// ---- Trace sub-view (shell; filled by FBS-208) ---------------------------

function renderTraceSub({ active }) {
  const hidden = active ? '' : ' hidden';
  return `<div class="rcf-readiness-subpanel rcf-readiness-sub-trace" id="rcf-readiness-sub-trace" data-rcf-subpanel="trace" role="tabpanel"${hidden}>`
    + `<section class="rcf-readiness-trace rcf-readiness-trace--shell">`
    + `<p><em>Trace matrix will land here with FBS-208 (US-209).</em></p>`
    + `</section>`
    + `</div>`;
}

// ---- Decisions outstanding -----------------------------------------------

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

// ---- Freeze state (plain words, no command, no control) -----------------
//
// AC-18005-5: readyToBuild=no names each failing gate with what
// resolves it; readyToBuild=yes states that the tree can be frozen
// and what a freeze would record. "On me" / "On engineers" vocab
// replaces persona pills.

function renderFreezeState(result, register) {
  const ok = result.levels.readyToBuild.ok;
  const freezeableAttr = ok ? 'yes' : 'no';
  if (ok) {
    const shortCurrent = escapeHtml(shortHash(result.tree.currentTreeHash));
    return `<section class="rcf-readiness-freeze-state" data-rcf-freezeable="${freezeableAttr}">`
      + `<h3>Freeze state</h3>`
      + `<p>Ready to freeze. A freeze would record the current tree hash <code>${shortCurrent}</code>, the timestamp, the note, the counts and the acknowledged gates with their reasons.</p>`
      + `</section>`;
  }
  const blockers = Array.isArray(result.levels.readyToBuild.blockedBy) ? result.levels.readyToBuild.blockedBy : [];
  const grouped = groupBlockersByGate(blockers);
  if (grouped.length === 0) {
    return `<section class="rcf-readiness-freeze-state" data-rcf-freezeable="${freezeableAttr}">`
      + `<h3>Freeze state</h3>`
      + `<p>Not ready to freeze.</p>`
      + `</section>`;
  }
  const items = grouped.map((g) => {
    const owner = g.ownerLabel;
    const resolver = resolverSentence(g.gate, g.checks);
    const stageWord = gateToPlainStage(g.gate);
    const lead = stageWord
      ? `the ${stageWord} stage is held`
      : 'this stage is held';
    // Each item leads with a plain-English sentence naming the stage
    // and what resolves it (AC-18005-5). The chain gate id follows
    // in <code> so an engineer scanning the block can jump into the
    // chain (AC-18001-6 pins this locator).
    return `<li data-rcf-gate="${escapeHtml(g.gate)}" data-rcf-owner="${escapeHtml(g.owner)}">`
      + `<span class="muted small">(${escapeHtml(owner)})</span> ${escapeHtml(lead)}: ${escapeHtml(resolver)} `
      + `<code>${escapeHtml(g.gate)}</code>`
      + `</li>`;
  }).join('');
  // The gate labels are fixed: 'On me' names the product owner's
  // own gates, 'On engineers' names the gates handed over. The lead
  // sentence states that invariant verbatim for both registers so
  // the vocabulary never flips when the engineer surface renders.
  const lead = 'The build is held by these gates. "On me" names the product owner\'s own gates, "On engineers" names the ones handed over.';
  return `<section class="rcf-readiness-freeze-state" data-rcf-freezeable="${freezeableAttr}">`
    + `<h3>Freeze state</h3>`
    + `<p>Not ready to freeze. ${escapeHtml(lead)}</p>`
    + `<ul class="rcf-readiness-freeze-state__gates">${items}</ul>`
    + `</section>`;
}

/** Group blockers by gate, folding owner (persona) to the shared label. */
function groupBlockersByGate(blockers) {
  const byGate = new Map();
  for (const b of blockers) {
    if (!b || typeof b !== 'object') continue;
    const gate = typeof b.gate === 'string' ? b.gate : '';
    if (!gate) continue;
    const slot = byGate.get(gate) || { gate, owners: new Set(), checks: new Set() };
    if (b.persona === 'productOwner' || b.persona === 'engineer') slot.owners.add(b.persona);
    if (typeof b.check === 'string') slot.checks.add(b.check);
    byGate.set(gate, slot);
  }
  const rows = [];
  for (const slot of byGate.values()) {
    const owners = Array.from(slot.owners);
    const owner = owners.length === 1 ? owners[0] : (owners.includes('productOwner') ? 'productOwner' : 'engineer');
    rows.push({
      gate: slot.gate,
      owner,
      ownerLabel: owner === 'productOwner' ? 'On me' : 'On engineers',
      checks: Array.from(slot.checks).sort(),
    });
  }
  rows.sort((a, b) => a.gate.localeCompare(b.gate));
  return rows;
}

/**
 * Plain-English sentence naming what resolves the gate, derived from
 * its failing checks. Keeps the viewer command-free: the engineer or
 * product owner reads what the row says and acts in their own agent
 * session.
 */
function resolverSentence(gate, checks) {
  if (checks.length === 0) return `the ${gate} gate still has failing items in the blocking table.`;
  const labels = checks.map(checkToPlainLabel).filter(Boolean);
  const uniq = Array.from(new Set(labels));
  if (uniq.length === 0) return `resolve the failing items for ${gate} named in the blocking table.`;
  if (uniq.length === 1) return `resolve the ${uniq[0]} failing items in the blocking table.`;
  const last = uniq.pop();
  return `resolve the ${uniq.join(', ')} and ${last} failing items in the blocking table.`;
}

function checkToPlainLabel(check) {
  if (typeof check !== 'string' || check.length === 0) return '';
  // e.g. "brief:sinceFreeze" -> "brief", "stories:usFloors" -> "stories",
  // "crosscut:securityArchitecture" -> "crosscut".
  const idx = check.indexOf(':');
  return idx === -1 ? check : check.slice(0, idx);
}

// Map a gate id ("define.brief", "define.stories", "define.crosscut",
// "define.probe", "define.freeze", ...) to a short plain-English stage
// word for the freeze-state items. Returns the second segment lowercased
// (or the full id when there is no separator) so the user-facing text
// reads "the brief stage is held" rather than citing a chain id.
function gateToPlainStage(gate) {
  if (typeof gate !== 'string' || gate.length === 0) return '';
  const idx = gate.indexOf('.');
  return idx === -1 ? gate : gate.slice(idx + 1);
}

// ---- Freeze record -------------------------------------------------------

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
      .map(([k, v]) => {
        const atReason = v && typeof v === 'object' && v.at && typeof v.at === 'object' && typeof v.at.reason === 'string' ? v.at.reason : null;
        const flatReason = v && typeof v === 'object' && typeof v.reason === 'string' ? v.reason : null;
        const reason = atReason !== null && atReason.length > 0 ? atReason : (flatReason !== null && flatReason.length > 0 ? flatReason : String(v ?? ''));
        return `<li><code>${escapeHtml(k)}</code>: ${escapeHtml(reason)}</li>`;
      })
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

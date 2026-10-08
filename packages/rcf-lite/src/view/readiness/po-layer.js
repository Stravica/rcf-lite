// Readiness tab PO layer (viewer UI refresh PR 8, TAC-4133, ADR-4135).
//
// Four blocks for the product owner (two VerdictCards at equal
// height, QuestionCards grouped by source span, a what-happens-next
// paragraph and a Requirements that still need work table) plus one
// collapsed "For engineers" DocRow at the foot that carries the full
// engineer rendering unchanged (never removed from the DOM; AC-18002-3).
//
// The PO layer is a server-rendered HTML string: no inline script
// goes to the page. Equal-height cards come from a CSS grid with
// `align-items: stretch` on the parent (see src/view/style.css,
// `.rcf-po-verdicts`), not scripted measurement (ADR-4135).

import { escapeHtml } from '../doc-renderers/helpers.js';
import { formatVerdictLines } from '../../query/readiness.js';
import { renderDocRow } from '../components/doc-row.js';
import { toQuestions, preferReadinessQuestions } from './question-adapter.js';
import { stageTitle } from './stage-legend.js';
import { renderQuestionsTable, renderBlockingTable, buildQuestionRows, buildBlockingRows } from './tables.js';

/**
 * @typedef {import('../../query/readiness.js').ReadinessResult} ReadinessResult
 * @typedef {import('../../query/readiness.js').Blocker} Blocker
 */

/**
 * Render the four PO blocks plus the For-engineers DocRow.
 *
 * @param {ReadinessResult | null} readiness
 * @param {object} [opts]
 * @param {'productOwner'|'engineer'|'unstated'} [opts.persona='productOwner']
 * @param {string} opts.engineerBody - rendered engineer-level HTML (the former renderReadinessPanel body)
 * @returns {string}
 */
export function renderReadinessPO(readiness, opts) {
  if (!readiness) {
    return '<p><em>Readiness could not be computed for this tree.</em></p>';
  }
  const persona = opts?.persona ?? 'productOwner';
  const engineerBody = typeof opts?.engineerBody === 'string' ? opts.engineerBody : '';
  const verdictLines = formatVerdictLines(readiness);
  const questionsSource = preferReadinessQuestions(readiness) ? 'readiness.questions' : 'blockers';
  const q = toQuestions(readiness);

  // FBS-204: the question cards and blocker cards are replaced by two
  // read-only command-page tables (TAC-4135 renderQuestionsTable /
  // renderBlockingTable, ADR-4139). Both tables are rendered on every
  // register and both carry every id (AC-18003-8, AC-18002-3: no id
  // leaves the DOM) - the register only controls the painting order so
  // the engineer lands on the blocking table first and the product
  // owner lands on the questions table first.
  const questionRows = buildQuestionRowsForTable(readiness, q);
  const blockingRows = buildBlockingRows(Array.isArray(readiness.stages) ? readiness.stages : []);
  const questionsTable = renderQuestionsTable({ rows: questionRows });
  const blockingTable = renderBlockingTable({ rows: blockingRows });
  const paintOrder = persona === 'engineer'
    ? [blockingTable, questionsTable]
    : [questionsTable, blockingTable];
  const tablesSection = `<div class="rcf-cmd-tables" data-rcf-register="${escapeHtml(persona)}" data-rcf-source="${escapeHtml(questionsSource)}">${paintOrder.join('\n')}</div>`;

  return [
    renderVerdictCards(readiness, verdictLines),
    tablesSection,
    renderNextStep(readiness, q),
    renderReqWorkTable(readiness),
    renderForEngineers(readiness, engineerBody, persona),
  ].join('\n');
}

/**
 * Shape the question source into rows the table renderer expects.
 *
 * The question-adapter (`toQuestions`) already handles both the real
 * `readiness.questions` shape and the blockers fallback, and folds
 * `readiness.questionOptional` (open decisions with a default) into
 * the dashed optional group. The table surface walks that folded
 * output so an open decision reaches a row even when
 * `readiness.questions` itself is empty.
 */
function buildQuestionRowsForTable(_readiness, adapterResult) {
  const groups = Array.isArray(adapterResult?.groups) ? adapterResult.groups : [];
  const optional = adapterResult?.optional ?? null;
  /** @type {Array<object>} */
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

// ---- block 1: two VerdictCards (equal height, chain term muted) --------

function renderVerdictCards(readiness, verdictLines) {
  const l = readiness.levels;
  const intentOk = l.intentComplete.ok;
  const buildOk = l.readyToBuild.ok;
  const intentCount = Array.isArray(l.intentComplete.blockedBy) ? l.intentComplete.blockedBy.length : 0;
  const buildBlockers = Array.isArray(l.readyToBuild.blockedBy) ? l.readyToBuild.blockedBy : [];
  const buildTotal = buildBlockers.length;
  const buildPo = buildBlockers.filter((b) => b && b.persona === 'productOwner').length;
  const buildEng = buildBlockers.filter((b) => b && b.persona === 'engineer').length;

  const intentValueLabel = intentOk ? 'Yes' : 'Not yet';
  const buildValueLabel = buildOk ? 'Yes' : 'Not yet';
  const intentCountLine = intentCount === 0
    ? '0 questions waiting for you'
    : `<strong>${intentCount} question${intentCount === 1 ? '' : 's'} waiting for you</strong>`;
  const buildCountLine = buildTotal === 0
    ? 'nothing waiting for engineers'
    : `<strong>${buildEng} item${buildEng === 1 ? '' : 's'} for engineers</strong>, ${buildPo === 0 ? 'none' : buildPo} for you`;

  return `<section class="rcf-po-verdicts" data-rcf-intent-ok="${intentOk ? 'yes' : 'no'}" data-rcf-build-ok="${buildOk ? 'yes' : 'no'}">
  <article class="rcf-po-verdict rcf-po-verdict--intent">
    <p class="rcf-po-verdict__eyebrow muted">Your requirements set</p>
    <h2 class="rcf-po-verdict__heading">Ready for engineers: <span class="rcf-pill rcf-pill--${intentOk ? 'ok' : 'warn'}">${escapeHtml(intentValueLabel)}</span> <span class="rcf-chain-term" title="What the chain calls this rung">intent-complete</span></h2>
    <p class="rcf-po-verdict__count">${intentCountLine}</p>
    <p class="rcf-po-verdict__verdict muted"><code>${escapeHtml(verdictLines.intentComplete)}</code></p>
  </article>
  <article class="rcf-po-verdict rcf-po-verdict--build">
    <p class="rcf-po-verdict__eyebrow muted">The build</p>
    <h2 class="rcf-po-verdict__heading">Ready to build: <span class="rcf-pill rcf-pill--${buildOk ? 'ok' : 'warn'}">${escapeHtml(buildValueLabel)}</span> <span class="rcf-chain-term" title="What the chain calls this rung">ready-to-build</span></h2>
    <p class="rcf-po-verdict__count">${buildCountLine}</p>
    <p class="rcf-po-verdict__verdict muted"><code>${escapeHtml(verdictLines.readyToBuild)}</code></p>
  </article>
</section>`;
}

// FBS-204 note: block 2 (QuestionCards grouped by source span) and the
// per-item renderers were retired on 2026-10-08 when ADR-4139 landed:
// the Readiness tab is read-only linked tables now (TAC-4135). The
// questions table lives in `./tables.js` and the composition in
// renderReadinessPO above swaps it in; AC-18002-1/2/3 and the empty
// state (intent-complete verdict line) hold through the table shape.
// `stageTitle` import is kept because renderNextStep and the engineer
// section still carry stage-legend hints into the tooltip layer.
void stageTitle;

// ---- block 3: What happens next ---------------------------------------

function renderNextStep(readiness, q) {
  const l = readiness.levels;
  const groups = Array.isArray(q.groups) ? q.groups : [];
  const total = groups.reduce((sum, g) => sum + (g.items?.length ?? 0), 0);
  const buildBlockers = Array.isArray(l.readyToBuild.blockedBy) ? l.readyToBuild.blockedBy : [];
  const engCount = buildBlockers.filter((b) => b && b.persona === 'engineer').length;
  const verdictLines = formatVerdictLines(readiness);

  const lines = [];
  if (total === 0 && l.intentComplete.ok) {
    lines.push(`<p><strong>Your requirements set is ready for engineers.</strong> This page will update as the engineer-level work moves along.</p>`);
  } else if (total === 0) {
    lines.push(`<p>Nothing on this tree needs your answer right now.</p>`);
  } else {
    lines.push(`<p><strong>Answer the ${total} question${total === 1 ? '' : 's'} above</strong> and your requirements set is ready for engineers.</p>`);
  }
  if (engCount > 0) {
    lines.push(`<p>Engineers then have <strong>${engCount} item${engCount === 1 ? '' : 's'}</strong> to settle before the build can start. You do not need to do anything for those.</p>`);
  } else if (l.readyToBuild.ok) {
    lines.push(`<p>Engineers have nothing waiting; the tree is ready to freeze.</p>`);
  }
  lines.push(`<p class="small muted">Verdict as the CLI prints it: <code>${escapeHtml(verdictLines.intentComplete)}</code></p>`);

  return `<section class="rcf-po-next">
  <h2>What happens next</h2>
  <div class="rcf-po-next__card">${lines.join('\n    ')}</div>
</section>`;
}

// ---- block 4: Requirements that still need work -----------------------

function renderReqWorkTable(readiness) {
  const rows = buildReqWorkRows(readiness);
  if (rows.length === 0) {
    return `<section class="rcf-po-reqwork" data-rcf-empty="yes">
  <h2>Requirements that still need work <span class="rcf-badge rcf-badge--count">0</span></h2>
  <p class="muted small">Each row says what is missing in plain words. Open a requirement to read it in the Requirements tab.</p>
  <p class="rcf-po-reqwork__empty">All requirements have a plain description, a home, and at least one story. Nothing is waiting on you here.</p>
</section>`;
  }
  const body = rows.map((r) => `<tr>
  <td><code class="rcf-po-reqwork__id">${escapeHtml(r.reqId)}</code></td>
  <td>${escapeHtml(r.reason)}</td>
  <td><a href="#tab=requirements&amp;entity=${escapeHtml(r.reqId)}">Open</a></td>
</tr>`).join('');
  return `<section class="rcf-po-reqwork">
  <h2>Requirements that still need work <span class="rcf-badge rcf-badge--count">${rows.length}</span></h2>
  <p class="muted small">Each row says what is missing in plain words. Open a requirement to read it in the Requirements tab.</p>
  <table class="rcf-po-reqwork__table">
    <thead><tr><th>Requirement</th><th>What is missing</th><th></th></tr></thead>
    <tbody>${body}</tbody>
  </table>
</section>`;
}

/**
 * The PO checks that name a REQ (`skeleton:reqIntent`,
 * `stories:reqHasUs`, `skeleton:resolvedBy` with REQ-shaped
 * suggestions). The Needs-work filter on the Requirements tab reads
 * from the same set.
 */
function buildReqWorkRows(readiness) {
  const stages = Array.isArray(readiness.stages) ? readiness.stages : [];
  /** @type {Map<string, string>} */
  const reasonById = new Map();
  const REASON = {
    'stories:reqHasUs': 'No story yet: who uses this, and what do they do with it?',
    'skeleton:reqIntent': 'Needs a plain description: what must the product do here, and which part does it belong to?',
    'skeleton:resolvedBy': 'A statement from your document may belong here; confirm in the questions above.',
  };
  for (const s of stages) {
    if (!s || !Array.isArray(s.checks)) continue;
    for (const c of s.checks) {
      if (!c || c.ok) continue;
      const reason = REASON[c.name];
      if (!reason) continue;
      const failing = Array.isArray(c.failing) ? c.failing : [];
      for (const f of failing) {
        if (!f || typeof f !== 'object') continue;
        const id = typeof f.id === 'string' ? f.id : '';
        if (!/^REQ-\d+/.test(id)) continue;
        const reqId = id.split(':')[0];
        if (!reasonById.has(reqId)) reasonById.set(reqId, reason);
      }
    }
  }
  return Array.from(reasonById.entries()).map(([reqId, reason]) => ({ reqId, reason }));
}

// ---- block 5: For engineers DocRow ------------------------------------

function renderForEngineers(readiness, engineerBody, persona) {
  const l = readiness.levels;
  const buildBlockers = Array.isArray(l.readyToBuild.blockedBy) ? l.readyToBuild.blockedBy : [];
  const engCount = buildBlockers.filter((b) => b && b.persona === 'engineer').length;
  const open = persona === 'engineer';
  const metaBits = [
    `<span class="rcf-badge rcf-badge--count">${engCount} item${engCount === 1 ? '' : 's'}</span>`,
  ].join(' ');
  return `<section class="rcf-po-engineer-section">${renderDocRow({
    id: 'For engineers',
    title: 'stage gates (with a D1 to D8 guide), findings by check, delta, coverage, decisions, freeze',
    body: engineerBody,
    className: 'rcf-po-engineer',
    open,
    dataDocId: 'rcf-readiness-engineer',
    meta: metaBits,
  })}</section>`;
}

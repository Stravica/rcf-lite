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
import { renderCoverageSummary } from './coverage-summary.js';
import { buildThinReqRows, renderThinReqsTable } from './thin-reqs.js';

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
 * @param {object | null} [opts.tree] - the walker tree model, for coverage tiles and thin rows (FBS-205)
 * @returns {string}
 */
export function renderReadinessPO(readiness, opts) {
  if (!readiness) {
    return '<p><em>Readiness could not be computed for this tree.</em></p>';
  }
  const persona = opts?.persona ?? 'productOwner';
  const engineerBody = typeof opts?.engineerBody === 'string' ? opts.engineerBody : '';
  const tree = opts && opts.tree ? opts.tree : null;
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

  // FBS-205 (US-18004): the "What happens next" block folds into the
  // verdict cards (one sentence per card), renderCoverage is replaced
  // by renderCoverageSummary, and the Requirements-that-still-need-work
  // table widens to the thin-requirements table with the five reasons
  // bound by AC-18004-4.
  const thinRows = buildThinReqRows(readiness, tree);
  return [
    renderVerdictCards(readiness, verdictLines, q),
    tablesSection,
    renderCoverageSummary({ coverage: readiness.coverage, tree }),
    renderThinReqsTable({ rows: thinRows }),
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
//
// FBS-205 (AC-18004-5): the count on each card is now a link to the
// matching table (intent -> questions, build -> blocking); the former
// "What happens next" paragraph (block 3, retired) is folded into
// each card as one sentence pulled from the same inputs.

const QUESTIONS_HREF = '#tab=readiness&sub=questions';
const BLOCKING_HREF = '#tab=readiness&sub=blocking';

function renderVerdictCards(readiness, verdictLines, q) {
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

  const questionGroups = Array.isArray(q && q.groups) ? q.groups : [];
  const questionTotal = questionGroups.reduce((sum, g) => sum + ((g && g.items && g.items.length) || 0), 0);
  const askTotal = Number.isFinite(questionTotal) ? questionTotal : intentCount;

  const intentCountLine = askTotal === 0
    ? `<a class="rcf-po-verdict__count-link" href="${escapeHtml(QUESTIONS_HREF)}" data-rcf-link="questions">0 questions waiting for you</a>`
    : `<a class="rcf-po-verdict__count-link" href="${escapeHtml(QUESTIONS_HREF)}" data-rcf-link="questions"><strong>${askTotal} question${askTotal === 1 ? '' : 's'} waiting for you</strong></a>`;
  const buildCountLine = buildTotal === 0
    ? `<a class="rcf-po-verdict__count-link" href="${escapeHtml(BLOCKING_HREF)}" data-rcf-link="blocking">nothing waiting for engineers</a>`
    : `<a class="rcf-po-verdict__count-link" href="${escapeHtml(BLOCKING_HREF)}" data-rcf-link="blocking"><strong>${buildEng} item${buildEng === 1 ? '' : 's'} for engineers</strong>, ${buildPo === 0 ? 'none' : buildPo} for you</a>`;

  const intentNext = intentNextSentence(intentOk, askTotal);
  const buildNext = buildNextSentence(buildOk, buildEng);

  return `<section class="rcf-po-verdicts" data-rcf-intent-ok="${intentOk ? 'yes' : 'no'}" data-rcf-build-ok="${buildOk ? 'yes' : 'no'}">
  <article class="rcf-po-verdict rcf-po-verdict--intent">
    <p class="rcf-po-verdict__eyebrow muted">Your requirements set</p>
    <h2 class="rcf-po-verdict__heading">Ready for engineers: <span class="rcf-pill rcf-pill--${intentOk ? 'ok' : 'warn'}">${escapeHtml(intentValueLabel)}</span> <span class="rcf-chain-term" title="What the chain calls this rung">intent-complete</span></h2>
    <p class="rcf-po-verdict__count">${intentCountLine}</p>
    <p class="rcf-po-verdict__next" data-rcf-next="intent">${intentNext}</p>
    <p class="rcf-po-verdict__verdict muted"><code>${escapeHtml(verdictLines.intentComplete)}</code></p>
  </article>
  <article class="rcf-po-verdict rcf-po-verdict--build">
    <p class="rcf-po-verdict__eyebrow muted">The build</p>
    <h2 class="rcf-po-verdict__heading">Ready to build: <span class="rcf-pill rcf-pill--${buildOk ? 'ok' : 'warn'}">${escapeHtml(buildValueLabel)}</span> <span class="rcf-chain-term" title="What the chain calls this rung">ready-to-build</span></h2>
    <p class="rcf-po-verdict__count">${buildCountLine}</p>
    <p class="rcf-po-verdict__next" data-rcf-next="build">${buildNext}</p>
    <p class="rcf-po-verdict__verdict muted"><code>${escapeHtml(verdictLines.readyToBuild)}</code></p>
  </article>
</section>`;
}

function intentNextSentence(ok, askTotal) {
  if (ok && askTotal === 0) {
    return 'Your requirements set is ready for engineers; this page updates as they move the build along.';
  }
  if (askTotal === 0) {
    return 'Nothing on this tree needs your answer right now.';
  }
  return `Answer the ${askTotal} question${askTotal === 1 ? '' : 's'} in the questions table and your requirements set is ready for engineers.`;
}

function buildNextSentence(ok, engCount) {
  if (ok) {
    return 'Engineers have nothing waiting; the tree is ready to freeze.';
  }
  if (engCount === 0) {
    return 'No engineer items are blocking the build right now.';
  }
  return `Engineers have ${engCount} item${engCount === 1 ? '' : 's'} to settle before the build can start; you do not need to do anything for those.`;
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

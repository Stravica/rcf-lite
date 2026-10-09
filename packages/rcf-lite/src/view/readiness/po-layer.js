// Readiness tab PO layer (viewer UI refresh PR 8, TAC-4133, ADR-4135;
// FBS-204 reshape and FBS-206 retire of the For-engineers DocRow).
//
// What remains here after FBS-206:
//   - renderVerdictCards: the two equal-height cards (Ready for
//     engineers / Ready to build) with count-links into the Questions
//     and Blocking sub-tabs. readiness.js imports and composes it
//     into the Overview sub-view.
//   - renderReadinessPO: a thin composition kept for the existing
//     AC-18002-1/-2 tests and the components fixture page; it emits
//     verdict cards + the two tables (same shape FBS-204 shipped).
//     The For-engineers DocRow is gone (AC-18005-4: no DocRow
//     wrapper; the sub-view structure in readiness.js owns the
//     engineer surface now).
//
// Barry viewer-read-only ruling and ADR-4139: no CLI command text,
// no write affordance. Dave constraint F2 and F4: no "Baz" / "Barry"
// in src/test/fixtures.

import { escapeHtml } from '../doc-renderers/helpers.js';
import { formatVerdictLines } from '../../query/readiness.js';
import { toQuestions, preferReadinessQuestions } from './question-adapter.js';
import { renderQuestionsTable, renderBlockingTable, buildQuestionRows, buildBlockingRows } from './tables.js';

/**
 * @typedef {import('../../query/readiness.js').ReadinessResult} ReadinessResult
 * @typedef {import('../../query/readiness.js').Blocker} Blocker
 */

/**
 * Thin composition kept for legacy tests and the components fixture:
 * verdict cards + the questions and blocking tables. The For-engineers
 * DocRow retired in FBS-206 (AC-18005-4) so this function no longer
 * carries an engineer wrapper; readiness.js owns the sub-view layout
 * now.
 *
 * @param {ReadinessResult | null} readiness
 * @param {object} [opts]
 * @param {'productOwner'|'engineer'|'unstated'} [opts.persona='productOwner']
 * @returns {string}
 */
export function renderReadinessPO(readiness, opts) {
  if (!readiness) {
    return '<p><em>Readiness could not be computed for this tree.</em></p>';
  }
  const persona = opts?.persona ?? 'productOwner';
  const verdictLines = formatVerdictLines(readiness);
  const questionsSource = preferReadinessQuestions(readiness) ? 'readiness.questions' : 'blockers';
  const q = toQuestions(readiness);
  const questionRows = buildQuestionRowsForTable(q);
  const blockingRows = buildBlockingRows(Array.isArray(readiness.stages) ? readiness.stages : []);
  const questionsTable = renderQuestionsTable({ rows: questionRows });
  const blockingTable = renderBlockingTable({ rows: blockingRows });
  const paintOrder = persona === 'engineer'
    ? [blockingTable, questionsTable]
    : [questionsTable, blockingTable];
  const tablesSection = `<div class="rcf-cmd-tables" data-rcf-register="${escapeHtml(persona)}" data-rcf-source="${escapeHtml(questionsSource)}">${paintOrder.join('\n')}</div>`;
  return [
    renderVerdictCards(readiness, verdictLines, q),
    tablesSection,
  ].join('\n');
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

// ---- VerdictCards (equal height, chain term muted) ---------------------
//
// FBS-205 (AC-18004-5): the count on each card is a link to the
// matching sub-tab (intent -> questions, build -> blocking); the
// "What happens next" sentence folds into the card from the same
// inputs. FBS-206 wires the sub-tab router so the links actually
// activate the target sub-view.

const QUESTIONS_HREF = '#tab=readiness&sub=questions';
const BLOCKING_HREF = '#tab=readiness&sub=blocking';

/**
 * Render the two VerdictCards.
 *
 * @param {ReadinessResult} readiness
 * @param {{ intentComplete: string, readyToBuild: string }} verdictLines
 * @param {ReturnType<typeof toQuestions>} q
 * @returns {string}
 */
export function renderVerdictCards(readiness, verdictLines, q) {
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

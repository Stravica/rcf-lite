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

  return [
    renderVerdictCards(readiness, verdictLines),
    renderQuestionCards(readiness, q, questionsSource),
    renderNextStep(readiness, q),
    renderReqWorkTable(readiness),
    renderForEngineers(readiness, engineerBody, persona),
  ].join('\n');
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

// ---- block 2: QuestionCards grouped by source span --------------------

function renderQuestionCards(readiness, q, source) {
  const l = readiness.levels;
  const groups = Array.isArray(q.groups) ? q.groups : [];
  const total = groups.reduce((sum, g) => sum + (g.items?.length ?? 0), 0);

  if (total === 0) {
    const verdictLines = formatVerdictLines(readiness);
    const line = l.intentComplete.ok
      ? verdictLines.intentComplete
      : 'Nothing waiting on you right now.';
    return `<section class="rcf-po-questions" data-rcf-source="${escapeHtml(source)}" data-rcf-empty="yes">
  <header class="rcf-po-questions__head"><h2>Questions for you</h2> <span class="rcf-badge rcf-badge--count">0</span></header>
  <p class="muted small">Nothing on this tree needs your answer right now; this page updates on its own as the tree changes.</p>
  <p class="rcf-po-questions__verdict"><code>${escapeHtml(line)}</code></p>
</section>`;
  }

  let n = 0;
  const groupHtml = groups.map((g) => {
    const items = (g.items ?? []).map((it) => {
      n += 1;
      return renderQuestionItem(it, n);
    }).join('');
    return `<article class="rcf-po-question-group" data-rcf-group-label="${escapeHtml(g.label)}">
  <header class="rcf-po-question-group__head"><h3>${escapeHtml(g.label)}</h3></header>
  ${items}
</article>`;
  }).join('\n');

  const optionalHtml = q.optional
    ? renderOptionalGroup(q.optional)
    : '';

  return `<section class="rcf-po-questions" data-rcf-source="${escapeHtml(source)}">
  <header class="rcf-po-questions__head"><h2>Questions for you</h2> <span class="rcf-badge rcf-badge--count">${total}</span></header>
  <p class="muted small">Answer these in your agent session; this page updates on its own. Nothing here needs an id or a command.</p>
  ${groupHtml}
  ${optionalHtml}
</section>`;
}

function renderQuestionItem(it, n) {
  const detailAttrs = buildStageAttrs(it.checkId);
  return `<div class="rcf-po-question" data-rcf-check="${escapeHtml(it.checkId)}">
  <div class="rcf-po-question__head"><span class="rcf-badge rcf-badge--q">Q${n}</span><h4 class="rcf-po-question__heading">${escapeHtml(it.heading)}</h4></div>
  <p class="rcf-po-question__ask">${escapeHtml(it.ask)}</p>
  <p class="rcf-po-question__hint muted small">${escapeHtml(it.hint)}</p>
  <details class="rcf-po-question__detail"><summary class="small muted">Show the detail (engineer view)</summary><p class="mono small"${detailAttrs}>${escapeHtml(it.detail)}</p></details>
</div>`;
}

function renderOptionalGroup(group) {
  const items = (group.items ?? []).map((it) => {
    return `<div class="rcf-po-question rcf-po-question--optional" data-rcf-check="${escapeHtml(it.checkId)}">
  <h4 class="rcf-po-question__heading">${escapeHtml(it.heading)}</h4>
  <p class="rcf-po-question__ask">${escapeHtml(it.ask)}</p>
  <p class="rcf-po-question__hint muted small">${escapeHtml(it.hint)}</p>
</div>`;
  }).join('');
  return `<article class="rcf-po-question-group rcf-po-question-group--optional">
  <header class="rcf-po-question-group__head"><h3>${escapeHtml(group.label)}</h3></header>
  ${items}
</article>`;
}

/**
 * Build the `data-rcf-stage-attrs` and `title` attribute pair for a
 * check id of the form `D1/brief:sinceFreeze` so the D-ref hover
 * title and the open-on-click wiring (page-init.js wireStageLegend)
 * both work.
 */
function buildStageAttrs(checkId) {
  const match = /^D([1-8])/.exec(checkId ?? '');
  if (!match) return '';
  const stage = `D${match[1]}`;
  return ` data-rcf-stage-ref="${stage}" title="${escapeHtml(stageTitle(stage))}"`;
}

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

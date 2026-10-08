// Readiness command-page tables (TAC-4135 renderQuestionsTable,
// renderBlockingTable, QuestionRow, BlockingRow, FilterBar; ADR-4139;
// FBS-204, US-18003 AC-18003-1..5, AC-18003-7, AC-18003-8).
//
// Two pure HTML-string renderers over the ReadinessResult the viewer
// already has, read-only: no CLI command text, no write control, no
// Freeze now (AC-18003-7, ADR-4139). Every row carries the item id,
// the plain-English ask or finding, the chain location, a link that
// opens the item in full context, and what resolved looks like
// (ADR-4139 decision line). Composite failing ids split on the first
// colon so every blocking link resolves through findByDocId (AC-18003-4).
//
// Shared with FBS-205..208: the questions and blocking tables are the
// "linked tables over the readiness object" the ADR pins. The
// Copy-for-your-agent handle (AC-18003-5) uses the shared toast helper
// in page-init.js; wiring sits there, markup here (data-rcf-copy-for).
//
// No em-dashes anywhere in this file. The strings are plain product
// words; nothing routes to a CLI command.

import { escapeHtml } from '../doc-renderers/helpers.js';
import { phrasebookEntry } from './phrasebook.js';
import { splitCompositeId } from './composite-id.js';

/**
 * @typedef {object} QuestionRow
 * @property {number} number           1-based row number across the table
 * @property {string} itemId           the failing item id (brief:ledger, profile:surface, REQ-012, ...)
 * @property {string} group            the source span label used for the group-column sort key
 * @property {string} ask              plain-English sentence the owner answers
 * @property {string} settles          what shape of answer resolves this row
 * @property {string} state            'open' | 'optional' (the chain's state for the question)
 * @property {string} locationHref     the hash: #tab=readiness&sub=questions&entity=<itemId>
 * @property {string} locationLabel    short human label naming the chain location
 * @property {string} briefHandle      one line "<itemId>: <ask>" with no command text
 * @property {string} checkId          '<stage>/<check>' for the hover title and stage-ref
 * @property {string} stage            Dn stage key
 */

/**
 * @typedef {object} BlockingRow
 * @property {string} stage            Dn stage key
 * @property {string} check            check name (brief:sinceFreeze, stories:reqHasUs, ...)
 * @property {string} rawId            the failing id as it appears on the chain (may be composite)
 * @property {string} docId            `splitCompositeId(rawId).docId`
 * @property {string} fragment         `splitCompositeId(rawId).fragment`
 * @property {string} href             `#<docId>` when docId is set, else `#rcf-readiness-row-<rawId-slug>`
 * @property {string} why              gate explanation from `stages[].checks[].failing[].why`
 * @property {string} resolved         plain words naming what the row looks like when it clears
 * @property {string} persona          'productOwner' | 'engineer'
 * @property {string} question         the check's question (surfaces as a readable tooltip)
 */

/**
 * @typedef {object} TablesOpts
 * @property {{stage?: string, persona?: string}} [filter]  optional FilterBar state for the blocking table
 * @property {object | null} [freezeRecord]                 freeze record on disk (for the freeze-state block)
 */

// Safe DOM-id token for an itemId that may hold colons, slashes,
// angle brackets or spaces (profile:surface, brief:openQuestions,
// TAC-4122-define-gates:checkPersona). Mirrors page-init.js
// slugifyEntity so the router can find the row by data-rcf-entity.
export function entityDomId(itemId) {
  const s = String(itemId ?? '');
  return `rcf-readiness-row-${s.replace(/[^A-Za-z0-9-]/g, '_')}`;
}

const SETTLES_FALLBACK = 'Answer the ask or record a decision; the row clears when the chain updates.';
const RESOLVED_FALLBACK = 'The gate passes when the named failing items clear on the chain.';

const RESOLVED_BY_CHECK = {
  'brief:sinceFreeze': 'A brief statement is written, or the operator records text for one.',
  'brief:kinds': 'Every statement carries a kind (capability, constraint, actor, record, system, surface, outOfScope, question).',
  'brief:openQuestions': 'Every open question in the brief is answered or promoted to a decision.',
  'brief:profile': 'The profile names a review surface and a register.',
  'brief:profile:surface': 'The profile names a review surface (viewer, runningApp or prDiff).',
  'brief:profile:register': 'The profile names a register (productOwner or engineer).',
  'skeleton:resolvedBy': 'The statement is placed under a requirement (new or existing) or marked outOfScope.',
  'skeleton:reqIntent': 'The requirement carries a plain description and an area.',
  'stories:reqHasUs': 'At least one user story is written under the requirement.',
  'stories:closedSets': 'The story set under the requirement is closed (no open hooks).',
  'stories:usFloors': 'The user story has the minimum acceptance criteria the chain requires.',
  'shapes:tacHasInterface': 'Every TAC carries at least one interface.',
  'shapes:pathsResolve': 'Every interface path resolves to a file on disk.',
  'shapes:tacComplete': 'Every TAC carries interfaces, responsibilities and dependencies.',
  'crosscut:securityArchitecture': 'The TAD security architecture is written.',
  'crosscut:performanceArchitecture': 'The TAD performance architecture is written.',
  'crosscut:observability': 'The TAD observability section is written.',
  'crosscut:operationalConcerns': 'The operational concerns section is complete.',
  'consistency:contradictions': 'The named contradictions in the chain are resolved.',
  'consistency:unsatisfiable': 'The unsatisfiable statement is rewritten or retired.',
  'decisions:wellFormed': 'Every open decision has two or more options and a named default.',
  'decisions:resolved': 'Every open decision is resolved.',
  'freeze:treeHash': 'The frozen tree hash matches the current tree hash.',
};

const SETTLES_BY_CHECK = {
  'brief:sinceFreeze': 'A document path or a few sentences.',
  'brief:kinds': 'Pick a kind for the statement.',
  'brief:openQuestions': 'Give an answer or list the options and a default.',
  'brief:profile:surface': 'Pick viewer, runningApp or prDiff.',
  'brief:profile:register': 'Pick productOwner or engineer.',
  'skeleton:resolvedBy': 'Say which requirement this belongs to, or mark it out of scope.',
  'skeleton:reqIntent': 'One or two plain sentences, and the area.',
  'stories:reqHasUs': 'One sentence: as a who, I want what, so that why.',
  'decisions:wellFormed': 'Two or more options and a named default.',
};

// Plain words for a stage's product name. Mirrors stage-legend titles
// so the row surface uses the same vocabulary readers already learned.
const STAGE_LABEL = {
  D1: 'Brief',
  D2: 'Skeleton',
  D3: 'Shapes',
  D4: 'Stories',
  D5: 'Crosscut',
  D6: 'Consistency',
  D7: 'Decisions',
  D8: 'Freeze',
};

function stageLabel(stage) {
  return STAGE_LABEL[stage] ?? stage;
}

function sourceSpanLabel(span) {
  if (typeof span !== 'string' || span.length === 0) return 'The tree';
  if (span === 'tree') return 'The tree';
  if (span.startsWith('brief:')) {
    const n = span.slice('brief:'.length);
    return /^\d+$/.test(n) ? `Brief statement ${n}` : 'Brief';
  }
  if (/^REQ-/.test(span)) return `Requirement ${span}`;
  if (/^US-/.test(span)) return `User story ${span}`;
  if (/^AC-/.test(span)) return `Acceptance criterion ${span}`;
  if (/^TAC-/.test(span)) return `Technical area ${span}`;
  return span;
}

function pickItemId(q) {
  if (!q || typeof q !== 'object') return '';
  if (typeof q.itemId === 'string' && q.itemId.length > 0) return q.itemId;
  if (typeof q.id === 'string' && /^(brief:|profile:|decision:|REQ-|AC-|TAC-|US-|TS-|TC-|FBS-|ADR-|TAD-)/.test(q.id)) return q.id;
  return '';
}

function pickGroupLabel(q) {
  if (!q || typeof q !== 'object') return 'The tree';
  if (typeof q.sourceSpanLabel === 'string' && q.sourceSpanLabel.length > 0) return q.sourceSpanLabel;
  const ctx = q.context && typeof q.context === 'object' ? q.context : null;
  const stmtSrc = ctx && typeof ctx.statement === 'object' && ctx.statement
    ? ctx.statement.source
    : null;
  const span = typeof q.sourceSpan === 'string' && q.sourceSpan.length > 0
    ? q.sourceSpan
    : (typeof stmtSrc === 'string' && stmtSrc.length > 0
      ? stmtSrc
      : (ctx && typeof ctx.sourceSpan === 'string' ? ctx.sourceSpan : ''));
  return sourceSpanLabel(span);
}

function pickState(q) {
  if (q && q.optional === true) return 'optional';
  const blocks = typeof q?.blocks === 'string' ? q.blocks : '';
  if (blocks === 'build') return 'open-build';
  return 'open';
}

function buildBriefHandle(itemId, ask) {
  const a = typeof ask === 'string' ? ask.trim() : '';
  const id = typeof itemId === 'string' ? itemId : '';
  if (!id) return a;
  if (!a) return id;
  return `${id}: ${a}`;
}

/**
 * Project `readiness.questions` into QuestionRow[]. Falls back to the
 * phrasebook when a question record is missing ask/heading (older
 * computeQuestions outputs or synthetic test fixtures).
 *
 * @param {Array<object>} questions
 * @returns {QuestionRow[]}
 */
export function buildQuestionRows(questions) {
  if (!Array.isArray(questions)) return [];
  /** @type {QuestionRow[]} */
  const rows = [];
  let n = 0;
  for (const raw of questions) {
    if (!raw || typeof raw !== 'object') continue;
    const q = /** @type {Record<string, unknown>} */ (raw);
    n += 1;
    const checkId = typeof q.checkId === 'string'
      ? q.checkId
      : (typeof q.check === 'string' ? q.check : '');
    const stage = typeof q.stage === 'string' ? q.stage : '';
    const itemId = pickItemId(q);
    const pb = phrasebookEntry(checkId, itemId);
    const ask = typeof q.ask === 'string' && q.ask.length > 0 ? q.ask : pb.ask;
    const settles = typeof q.hint === 'string' && q.hint.length > 0
      ? q.hint
      : (SETTLES_BY_CHECK[checkId] ?? pb.hint ?? SETTLES_FALLBACK);
    rows.push({
      number: n,
      itemId,
      group: pickGroupLabel(q),
      ask,
      settles,
      state: pickState(q),
      locationHref: `#tab=readiness&sub=questions&entity=${encodeURIComponent(itemId)}`,
      locationLabel: itemId || `${stage}/${checkId}`,
      briefHandle: buildBriefHandle(itemId, ask),
      checkId: stage && checkId ? `${stage}/${checkId}` : (checkId || stage),
      stage,
    });
  }
  return rows;
}

/**
 * Project every failing check across stages into BlockingRow[]. One
 * row per failing item (never capped; AC-18003-3). Rows carry the
 * composite split so the link resolves through findByDocId.
 *
 * @param {Array<object>} stages
 * @returns {BlockingRow[]}
 */
export function buildBlockingRows(stages) {
  if (!Array.isArray(stages)) return [];
  /** @type {BlockingRow[]} */
  const rows = [];
  for (const s of stages) {
    if (!s || typeof s !== 'object') continue;
    const stage = typeof s.stage === 'string' ? s.stage : '';
    const checks = Array.isArray(s.checks) ? s.checks : [];
    for (const c of checks) {
      if (!c || typeof c !== 'object' || c.ok) continue;
      const check = typeof c.name === 'string' ? c.name : '';
      const persona = typeof c.persona === 'string' ? c.persona : 'engineer';
      const question = typeof c.question === 'string' ? c.question : '';
      const failing = Array.isArray(c.failing) ? c.failing : [];
      for (const f of failing) {
        if (!f || typeof f !== 'object') continue;
        const rawId = typeof f.id === 'string' ? f.id : '';
        const why = typeof f.why === 'string' ? f.why : '';
        const split = splitCompositeId(rawId);
        const href = split.docId ? `#${split.docId}` : `#${entityDomId(rawId)}`;
        rows.push({
          stage,
          check,
          rawId,
          docId: split.docId,
          fragment: split.fragment,
          href,
          why,
          resolved: RESOLVED_BY_CHECK[check] ?? RESOLVED_FALLBACK,
          persona,
          question,
        });
      }
    }
  }
  return rows;
}

// ---- renderQuestionsTable ------------------------------------------

/**
 * Render the one questions table (AC-18003-1, -2, -5, -8). The caller
 * passes the already-projected rows (via `buildQuestionRows`) or raw
 * `readiness.questions` and `rows` wins when both are set.
 *
 * @param {object} args
 * @param {Array<object>} [args.questions]   raw readiness.questions[]
 * @param {QuestionRow[]} [args.rows]        pre-projected rows (test shim)
 * @returns {string}
 */
export function renderQuestionsTable(args = {}) {
  const rows = Array.isArray(args.rows) ? args.rows : buildQuestionRows(args.questions ?? []);
  const total = rows.length;
  const headerCount = `<span class="rcf-badge rcf-badge--count">${total}</span>`;
  if (total === 0) {
    return `<section class="rcf-cmd-table rcf-cmd-table--questions" data-rcf-table="questions" data-rcf-empty="yes" aria-labelledby="rcf-readiness-questions-heading">
  <header class="rcf-cmd-table__head"><h3 id="rcf-readiness-questions-heading">Questions for you</h3> ${headerCount}</header>
  <p class="muted small">Nothing on this tree needs your answer right now; this page updates on its own as the tree changes.</p>
</section>`;
  }
  const body = rows.map(renderQuestionRow).join('');
  return `<section class="rcf-cmd-table rcf-cmd-table--questions" data-rcf-table="questions" aria-labelledby="rcf-readiness-questions-heading">
  <header class="rcf-cmd-table__head"><h3 id="rcf-readiness-questions-heading">Questions for you</h3> ${headerCount}</header>
  <p class="muted small">Each row names an item the owner answers; the copy button hands your agent the id and the ask with no command text.</p>
  <table class="rcf-cmd-table__table" aria-describedby="rcf-readiness-questions-heading">
    <thead>
      <tr>
        <th scope="col" data-rcf-col="number" data-rcf-sortable="yes">#</th>
        <th scope="col" data-rcf-col="group" data-rcf-sortable="yes">Group</th>
        <th scope="col" data-rcf-col="ask">Ask</th>
        <th scope="col" data-rcf-col="location" data-rcf-sortable="yes">Chain location</th>
        <th scope="col" data-rcf-col="settles">What resolves it</th>
        <th scope="col" data-rcf-col="state" data-rcf-sortable="yes">State</th>
        <th scope="col" data-rcf-col="copy"><span class="rcf-sr-only">Copy for your agent</span></th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
</section>`;
}

function renderQuestionRow(r) {
  const stageAttr = r.stage ? ` data-rcf-stage="${escapeHtml(r.stage)}"` : '';
  const locationLink = `<a href="${escapeHtml(r.locationHref)}" data-rcf-location="${escapeHtml(r.itemId)}">${escapeHtml(r.locationLabel)}</a>`;
  const copyLabel = 'Copy for your agent';
  return `<tr id="${escapeHtml(entityDomId(r.itemId))}" data-rcf-entity="${escapeHtml(r.itemId)}" data-rcf-state="${escapeHtml(r.state)}" data-rcf-group="${escapeHtml(r.group)}"${stageAttr}>
  <td data-rcf-col="number">${r.number}</td>
  <td data-rcf-col="group">${escapeHtml(r.group)}</td>
  <td data-rcf-col="ask">${escapeHtml(r.ask)}</td>
  <td data-rcf-col="location">${locationLink}</td>
  <td data-rcf-col="settles">${escapeHtml(r.settles)}</td>
  <td data-rcf-col="state">${escapeHtml(r.state)}</td>
  <td data-rcf-col="copy"><button type="button" class="rcf-cmd-copy" data-rcf-copy-for="${escapeHtml(r.itemId)}" data-rcf-copy-text="${escapeHtml(r.briefHandle)}" title="${escapeHtml(copyLabel)}">${escapeHtml(copyLabel)}</button></td>
</tr>`;
}

// ---- renderBlockingTable -------------------------------------------

/**
 * Render the one blocking table (AC-18003-3, -4, -7, -8). FilterBar
 * state is markup only in this file; the wiring lives in page-init.js
 * and reads `data-rcf-stage` / `data-rcf-persona` on each row. Rows
 * are not capped (every failing id across every failing check is a row).
 *
 * @param {object} args
 * @param {Array<object>} [args.stages]      readiness.stages
 * @param {BlockingRow[]} [args.rows]        pre-projected rows (test shim)
 * @param {{stage?: string, persona?: string}} [args.filter]  initial FilterBar state
 * @returns {string}
 */
export function renderBlockingTable(args = {}) {
  const rows = Array.isArray(args.rows) ? args.rows : buildBlockingRows(args.stages ?? []);
  const total = rows.length;
  const filter = args.filter ?? {};
  const headerCount = `<span class="rcf-badge rcf-badge--count">${total}</span>`;
  if (total === 0) {
    return `<section class="rcf-cmd-table rcf-cmd-table--blocking" data-rcf-table="blocking" data-rcf-empty="yes" aria-labelledby="rcf-readiness-blocking-heading">
  <header class="rcf-cmd-table__head"><h3 id="rcf-readiness-blocking-heading">Blocking items</h3> ${headerCount}</header>
  <p class="muted small">No failing items; every check passed on the current tree.</p>
</section>`;
  }
  const stageOptions = Array.from(new Set(rows.map((r) => r.stage).filter(Boolean))).sort();
  const personaOptions = Array.from(new Set(rows.map((r) => r.persona).filter(Boolean))).sort();
  const stageSel = filter.stage && stageOptions.includes(filter.stage) ? filter.stage : '';
  const personaSel = filter.persona && personaOptions.includes(filter.persona) ? filter.persona : '';
  const body = rows.map((r) => renderBlockingRow(r, { stageSel, personaSel })).join('');
  return `<section class="rcf-cmd-table rcf-cmd-table--blocking" data-rcf-table="blocking" aria-labelledby="rcf-readiness-blocking-heading">
  <header class="rcf-cmd-table__head"><h3 id="rcf-readiness-blocking-heading">Blocking items</h3> ${headerCount}</header>
  <div class="rcf-cmd-filterbar" data-rcf-filterbar="readiness-blocking" role="search">
    <label class="rcf-cmd-filterbar__field">
      <span>Stage</span>
      <select data-filter-key="stage">
        <option value="">All</option>
        ${stageOptions.map((s) => `<option value="${escapeHtml(s)}"${s === stageSel ? ' selected' : ''}>${escapeHtml(stageLabel(s))} (${escapeHtml(s)})</option>`).join('')}
      </select>
    </label>
    <label class="rcf-cmd-filterbar__field">
      <span>Persona</span>
      <select data-filter-key="persona">
        <option value="">All</option>
        ${personaOptions.map((p) => `<option value="${escapeHtml(p)}"${p === personaSel ? ' selected' : ''}>${escapeHtml(p === 'productOwner' ? 'Product owner' : 'Engineer')}</option>`).join('')}
      </select>
    </label>
  </div>
  <table class="rcf-cmd-table__table" aria-describedby="rcf-readiness-blocking-heading">
    <thead>
      <tr>
        <th scope="col" data-rcf-col="stage">Stage</th>
        <th scope="col" data-rcf-col="check">Check</th>
        <th scope="col" data-rcf-col="docId">Item</th>
        <th scope="col" data-rcf-col="why">Why it is failing</th>
        <th scope="col" data-rcf-col="resolved">What resolves it</th>
        <th scope="col" data-rcf-col="persona">On</th>
      </tr>
    </thead>
    <tbody>${body}</tbody>
  </table>
</section>`;
}

function renderBlockingRow(r, { stageSel, personaSel }) {
  const hidden = (stageSel && stageSel !== r.stage) || (personaSel && personaSel !== r.persona);
  const hiddenAttr = hidden ? ' hidden' : '';
  const title = r.question ? ` title="${escapeHtml(r.question)}"` : '';
  const link = r.docId
    ? `<a href="${escapeHtml(r.href)}">${escapeHtml(r.docId)}</a>${r.fragment ? `<span class="rcf-cmd-table__fragment"> :${escapeHtml(r.fragment)}</span>` : ''}`
    : `<a href="${escapeHtml(r.href)}">${escapeHtml(r.rawId)}</a>`;
  const personaWord = r.persona === 'productOwner' ? 'On me' : 'On engineers';
  const stageAttr = r.stage ? ` data-rcf-stage="${escapeHtml(r.stage)}"` : '';
  const personaAttr = r.persona ? ` data-rcf-persona="${escapeHtml(r.persona)}"` : '';
  const stageText = r.stage ? `${stageLabel(r.stage)} (${r.stage})` : '';
  return `<tr${stageAttr}${personaAttr} data-rcf-raw-id="${escapeHtml(r.rawId)}" data-rcf-doc-id="${escapeHtml(r.docId)}"${hiddenAttr}${title}>
  <td data-rcf-col="stage">${escapeHtml(stageText)}</td>
  <td data-rcf-col="check">${escapeHtml(r.check)}</td>
  <td data-rcf-col="docId">${link}</td>
  <td data-rcf-col="why">${escapeHtml(r.why)}</td>
  <td data-rcf-col="resolved">${escapeHtml(r.resolved)}</td>
  <td data-rcf-col="persona">${escapeHtml(personaWord)}</td>
</tr>`;
}

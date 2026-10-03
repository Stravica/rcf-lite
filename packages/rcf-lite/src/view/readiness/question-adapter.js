// Readiness PO question adapter (viewer UI refresh PR 8, TAC-4133,
// ADR-4135). One pure module that returns the question groups the PO
// layer renders. Today it reads `personas.productOwner.blockers` and
// fills asks from the phrasebook. When DEFINE step 3 PR 2 ships
// `readiness.questions`, `preferReadinessQuestions(readiness)` flips
// the source: the call site in the tab reads only this module's
// output so no downstream edit is needed.
//
// Grouping follows design doc section 8: one group per source span.
// Brief checks group by `brief:<n>` on the failing item's `why`; the
// resolvedBy and reqIntent checks group by the REQ ancestor named on
// the failing item (REQ-N); stories:reqHasUs groups under
// "Requirements without a story yet". A conservative default groups
// by stage when no better key is available.
//
// Decisions-with-a-default (the phrasebook `optional` flag) sit in a
// dashed optional card and never hold up the hand-over.

import { phrasebookEntry } from './phrasebook.js';

/**
 * @typedef {object} AdapterItem
 * @property {string} heading
 * @property {string} ask
 * @property {string} hint
 * @property {string} detail       engineer-style one-line detail for the Show detail inner block
 * @property {string} checkId      stage/check for the hover title
 * @property {string} [itemId]     the failing item id when known
 * @property {boolean} [optional]
 */

/**
 * @typedef {object} AdapterGroup
 * @property {string} label        the source span heading, in plain words
 * @property {AdapterItem[]} items
 * @property {boolean} [optional]
 */

/**
 * Feature detect for DEFINE step 3 PR 2's `questions[]` shape on the
 * readiness result. When the compute lands, the adapter reads from
 * `readiness.questions` instead of from blockers.
 *
 * @param {object | null | undefined} readiness
 * @returns {boolean}
 */
export function preferReadinessQuestions(readiness) {
  if (!readiness || typeof readiness !== 'object') return false;
  const q = /** @type {{ questions?: unknown }} */ (readiness).questions;
  return Array.isArray(q);
}

/**
 * Pure projection of the readiness object into question groups for
 * the PO layer. Does not read disk, does not render HTML.
 *
 * @param {object | null | undefined} readiness
 * @returns {{ groups: AdapterGroup[], optional: AdapterGroup | null }}
 */
export function toQuestions(readiness) {
  if (!readiness || typeof readiness !== 'object') {
    return { groups: [], optional: null };
  }
  if (preferReadinessQuestions(readiness)) {
    return fromReadinessQuestions(readiness);
  }
  return fromBlockers(readiness);
}

// ---- source A: readiness.questions[] (DEFINE step 3 PR 2) --------------
//
// Accepts both shapes:
//   1. The real `computeQuestions` output: each question carries
//      `.id` (a Q-...-...), `.itemId` (brief:7 / REQ-012 / ...),
//      `.stage`, `.check`, `.heading`, `.ask`, and `.context` whose
//      `.sourceSpan` or nested `.statement.source` names the span.
//   2. A flattened test / adapter shape that pre-labels the group via
//      `.sourceSpanLabel` and names the item on `.id` directly.
// The group label falls back to a conservative prose sentence built
// from the source span key when no `sourceSpanLabel` is present.

function fromReadinessQuestions(readiness) {
  const q = /** @type {Array<unknown>} */ (readiness.questions);
  /** @type {Map<string, AdapterGroup>} */
  const byLabel = new Map();
  /** @type {AdapterItem[]} */
  const optionalItems = [];
  for (const raw of q) {
    if (!raw || typeof raw !== 'object') continue;
    const r = /** @type {Record<string, unknown>} */ (raw);
    const checkId = typeof r.checkId === 'string'
      ? r.checkId
      : (typeof r.check === 'string' ? r.check : '');
    const stage = typeof r.stage === 'string' ? r.stage : '';
    const itemId = pickItemId(r);
    const label = pickLabel(r, { checkId, itemId });
    const pb = phrasebookEntry(checkId, itemId);
    const heading = typeof r.heading === 'string' && r.heading.length > 0 ? r.heading : pb.heading;
    const ask = typeof r.ask === 'string' && r.ask.length > 0 ? r.ask : pb.ask;
    const hint = typeof r.hint === 'string' && r.hint.length > 0 ? r.hint : pb.hint;
    const optional = typeof r.optional === 'boolean' ? r.optional : Boolean(pb.optional);
    const why = typeof r.why === 'string' ? r.why : '';
    const detail = buildDetail({ stage, checkId, itemId, why });
    const item = { heading, ask, hint, detail, checkId: `${stage}/${checkId}`, itemId, optional };
    if (optional) {
      optionalItems.push(item);
      continue;
    }
    if (!byLabel.has(label)) byLabel.set(label, { label, items: [] });
    byLabel.get(label).items.push(item);
  }
  return {
    groups: Array.from(byLabel.values()),
    optional: optionalItems.length > 0
      ? { label: 'Optional: decisions with a default (they do not hold up the hand-over)', items: optionalItems, optional: true }
      : null,
  };
}

/**
 * Pick the human itemId from a question record. Prefers an explicit
 * `.itemId` (the real computeQuestions shape); falls back to `.id`
 * only when it looks like a bare itemId (brief:*, profile:*,
 * decision:*, REQ-*, AC-*), never a Q-... question id, so the
 * phrasebook sub-check keying still works.
 */
function pickItemId(r) {
  if (typeof r.itemId === 'string' && r.itemId.length > 0) return r.itemId;
  if (typeof r.id === 'string' && /^(brief:|profile:|decision:|REQ-|AC-)/.test(r.id)) return r.id;
  return undefined;
}

/**
 * Build the group label for a question. Honours an explicit
 * `.sourceSpanLabel` first; then uses `.sourceSpan` or
 * `.context.sourceSpan` / `.context.statement.source` (the real
 * computeQuestions shape); then falls back to a plain prose sentence
 * for brief:N / profile:* / REQ-* / stories:reqHasUs, matching the
 * blockers-path labels so the PO layer reads the same way in both
 * modes.
 */
function pickLabel(r, { checkId, itemId }) {
  if (typeof r.sourceSpanLabel === 'string' && r.sourceSpanLabel.length > 0) return r.sourceSpanLabel;
  const ctx = (r && typeof r.context === 'object' && r.context) ? r.context : null;
  const stmtSrc = ctx && typeof ctx === 'object' && ctx.statement && typeof ctx.statement === 'object'
    ? ctx.statement.source
    : null;
  const span = typeof r.sourceSpan === 'string' && r.sourceSpan.length > 0
    ? r.sourceSpan
    : (typeof stmtSrc === 'string' && stmtSrc.length > 0
      ? stmtSrc
      : (ctx && typeof ctx.sourceSpan === 'string' ? ctx.sourceSpan : ''));
  if (span.startsWith('brief:')) {
    const rest = span.slice('brief:'.length);
    return /^\d+$/.test(rest) ? `Your document, statement ${rest}` : 'Your document';
  }
  if (/^REQ-/.test(span)) return `Requirement ${span}`;
  // Fall back to the same mapping the blockers path uses, so the two
  // sources render identical group labels on the dogfood tree.
  return labelForBlocker({ stage: typeof r.stage === 'string' ? r.stage : '', check: checkId }, itemId);
}

// ---- source B: personas.productOwner.blockers (today's shape) ----------

/**
 * The source span label for a PO blocker. Brief checks name a brief
 * statement number (`brief:7`); resolvedBy and reqIntent name a REQ;
 * reqHasUs sits under "Requirements without a story yet"; everything
 * else falls back to the plain stage label.
 *
 * @param {{ stage: string, check: string }} b
 * @param {string} itemId
 * @returns {string}
 */
function labelForBlocker(b, itemId) {
  if (b.check === 'stories:reqHasUs') return 'Requirements without a story yet';
  if (typeof itemId === 'string' && itemId.startsWith('brief:')) {
    const n = itemId.slice('brief:'.length);
    return /^\d+$/.test(n) ? `Your document, statement ${n}` : 'Your document';
  }
  if (b.check === 'brief:sinceFreeze') return 'About this project';
  if (b.check === 'brief:profile') return 'How you want to review';
  if (b.check === 'brief:openQuestions') return 'Open questions in your document';
  if (b.check === 'brief:kinds') return 'Statements in your document';
  if (b.check === 'skeleton:resolvedBy') return 'Your document, statements without a home';
  if (b.check === 'skeleton:reqIntent') return 'Requirements that need a plain description';
  if (b.check === 'decisions:wellFormed') return 'Decisions without options yet';
  if (typeof itemId === 'string' && /^REQ-/.test(itemId)) return `Requirement ${itemId}`;
  return `Stage ${b.stage || 'other'}`;
}

/**
 * Build an engineer-style detail line for the inner "Show detail"
 * block (never shown as the PO ask). This stays private to the PO
 * layer; the For-engineers DocRow carries the full detail.
 */
function buildDetail({ stage, checkId, itemId, why }) {
  const parts = [];
  if (stage) parts.push(stage);
  if (checkId) parts.push(checkId);
  if (itemId) parts.push(`id ${itemId}`);
  if (why) parts.push(why);
  return parts.join(' / ');
}

function fromBlockers(readiness) {
  const po = /** @type {{ personas?: { productOwner?: { blockers?: Array<unknown> } } }} */ (readiness);
  const blockers = Array.isArray(po.personas?.productOwner?.blockers)
    ? po.personas.productOwner.blockers
    : [];
  const stages = Array.isArray(/** @type {{stages?:unknown}} */(readiness).stages)
    ? /** @type {Array<Record<string, unknown>>} */ (readiness.stages)
    : [];
  /** @type {Map<string, AdapterGroup>} */
  const byLabel = new Map();
  /** @type {AdapterItem[]} */
  const optionalItems = [];
  for (const raw of blockers) {
    if (!raw || typeof raw !== 'object') continue;
    const b = /** @type {Record<string, unknown>} */ (raw);
    const stage = typeof b.stage === 'string' ? b.stage : '';
    const checkId = typeof b.check === 'string' ? b.check : '';
    const ids = Array.isArray(b.ids) ? b.ids : [];
    const whyById = buildWhyById(stages, stage, checkId);
    const items = ids.length > 0 ? ids : [null];
    for (const idRaw of items) {
      const itemId = typeof idRaw === 'string' ? idRaw : undefined;
      const why = itemId && whyById[itemId] ? whyById[itemId] : '';
      const pb = phrasebookEntry(checkId, itemId);
      const label = labelForBlocker({ stage, check: checkId }, itemId);
      const optional = Boolean(pb.optional);
      const item = {
        heading: pb.heading,
        ask: pb.ask,
        hint: pb.hint,
        detail: buildDetail({ stage, checkId, itemId, why }),
        checkId: `${stage}/${checkId}`,
        itemId,
        optional,
      };
      if (optional) {
        optionalItems.push(item);
        continue;
      }
      if (!byLabel.has(label)) byLabel.set(label, { label, items: [] });
      byLabel.get(label).items.push(item);
    }
  }
  return {
    groups: Array.from(byLabel.values()),
    optional: optionalItems.length > 0
      ? { label: 'Optional: decisions with a default (they do not hold up the hand-over)', items: optionalItems, optional: true }
      : null,
  };
}

/**
 * Build an id -> why map by walking stages[stage].checks[check].failing[].
 */
function buildWhyById(stages, stage, checkName) {
  /** @type {Record<string, string>} */
  const out = {};
  const s = stages.find((row) => row && row.stage === stage);
  if (!s || !Array.isArray(s.checks)) return out;
  const c = s.checks.find((row) => row && row.name === checkName);
  if (!c || !Array.isArray(c.failing)) return out;
  for (const f of c.failing) {
    if (!f || typeof f !== 'object') continue;
    const id = typeof f.id === 'string' ? f.id : null;
    if (!id) continue;
    out[id] = typeof f.why === 'string' ? f.why : '';
  }
  return out;
}

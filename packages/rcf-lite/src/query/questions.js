// Questions compute (REQ-186; spec 2026-10-01 §1.1, §1.2, §1.4, §1.5).
//
// Pure composer over the readiness object: folds each failing PO (or
// engineer) check into one plain question per failing item, each
// carrying the exact write-back(s) that answer it. Ordering: D1, D2,
// D4, D7 then by source span (so the harness asks about one passage
// at a time). Ids are deterministic from stage, check and item id.
// Writes NOTHING under rcf/ (same guard readiness honours).
//
// Shape of the returned object matches spec §1.2 verbatim.

/** @typedef {'productOwner' | 'engineer'} Persona */

/** The accepted personas, named everywhere the usage error mentions them. */
export const PERSONAS = /** @type {const} */ (['productOwner', 'engineer']);

/** Ordering spec §1.2: PO stages in this order; later stages fall through. */
const PO_STAGE_ORDER = ['D1', 'D2', 'D4', 'D7'];
const ENG_STAGE_ORDER = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'];

/**
 * Compute the persona question set from a readiness result, the tree,
 * the four ledgers and the profile text.
 *
 * @param {import('./readiness.js').ReadinessResult} readiness
 * @param {object} args
 * @param {import('#core/store/walker.js').TreeModel} args.tree
 * @param {import('./delta.js').LedgerBundle | undefined} [args.ledgers]
 * @param {string | null | undefined} [args.profileText]
 * @param {Persona} [args.persona]
 * @returns {{
 *   treeHash: string | null,
 *   persona: Persona,
 *   level: 'intent' | 'build',
 *   ok: boolean,
 *   remaining: number,
 *   groups: Array<{ key: string, label: string, questionIds: string[] }>,
 *   questions: Array<ReturnType<typeof makeQuestion>>,
 *   optional: Array<{ id: string, ask: string, blocks: 'build' }>,
 *   engineer?: { blockers: number, nextAction: object | null },
 * }}
 */
export function computeQuestions(readiness, args = {}) {
  const persona = args.persona ?? 'productOwner';
  if (!PERSONAS.includes(persona)) {
    throw new Error(
      `questions: unknown persona '${persona}' (expected one of ${PERSONAS.join(' | ')})`,
    );
  }

  const { tree, ledgers = {} } = args;
  const brief = /** @type {any} */ (ledgers?.brief);
  const briefStatements = Array.isArray(brief?.statements) ? brief.statements : [];
  const decisions = /** @type {any} */ (ledgers?.decisions);
  const decisionEntries = Array.isArray(decisions?.decisions) ? decisions.decisions : [];

  const level = persona === 'engineer' ? 'build' : 'intent';
  const blocks = persona === 'engineer' ? 'build' : 'intent';
  const blockers = persona === 'engineer'
    ? readiness?.personas?.engineer?.blockers ?? []
    : readiness?.levels?.intentComplete?.blockedBy ?? [];
  const ok = persona === 'engineer'
    ? (readiness?.levels?.readyToBuild?.ok ?? true)
    : (readiness?.levels?.intentComplete?.ok ?? true);

  const stageOrder = persona === 'engineer' ? ENG_STAGE_ORDER : PO_STAGE_ORDER;
  // Stable sort by stage index only; inside a stage the blocker order
  // comes from readiness.stages[].checks[] insertion order (spec §1.2:
  // "stage order D1, D2, D4, D7, then check order inside a stage").
  const indexed = blockers.map((b, i) => ({ b, i }));
  indexed.sort((x, y) => {
    const si = stageOrder.indexOf(x.b.stage) - stageOrder.indexOf(y.b.stage);
    if (si !== 0) return si;
    return x.i - y.i;
  });
  const ordered = indexed.map((x) => x.b);

  /** @type {ReturnType<typeof makeQuestion>[]} */
  const questions = [];
  for (const blocker of ordered) {
    const items = extractItems(blocker, briefStatements, tree, readiness);
    for (const item of items) {
      const q = buildQuestionForItem(blocker, item, {
        briefStatements, tree, decisionEntries, blocks, persona,
      });
      if (q) questions.push(q);
    }
  }

  // Spec §1.2: ordering is stage order first, then check order, then
  // grouped by source span so one passage is asked about at a time.
  // Stable-sort questions[] by (stageIndex, sourceSpan) to make the
  // source-span secondary deterministic even when readiness delivers
  // items in a different order per run.
  const spanKey = (q) => q.context?.statement?.source ?? q.context?.sourceSpan ?? '~';
  const stageKey = (q) => stageOrder.indexOf(q.stage);
  const withIndex = questions.map((q, i) => ({ q, i }));
  withIndex.sort((a, b) => {
    const sa = stageKey(a.q); const sb = stageKey(b.q);
    if (sa !== sb) return sa - sb;
    const spa = spanKey(a.q); const spb = spanKey(b.q);
    if (spa !== spb) return spa < spb ? -1 : 1;
    return a.i - b.i;
  });
  const sortedQuestions = withIndex.map((x) => x.q);

  // Group by source span. Preserve stage order from the questions list.
  /** @type {Map<string, { key: string, label: string, questionIds: string[] }>} */
  const groupMap = new Map();
  for (const q of sortedQuestions) {
    const key = q.context?.statement?.source ?? q.context?.sourceSpan ?? 'tree';
    const label = sourceLabel(key);
    const g = groupMap.get(key) ?? { key, label, questionIds: [] };
    g.questionIds.push(q.id);
    groupMap.set(key, g);
  }
  const groups = [...groupMap.values()];

  // optional[]: enumerated open decisions (two or more options and a
  // default). These are non-blocking at L1 per decision 7; they ride
  // the loop as an "offer once at the end" set.
  const optional = [];
  if (persona === 'productOwner') {
    for (const d of decisionEntries) {
      if (d?.status !== 'open') continue;
      if (!Array.isArray(d?.options) || d.options.length < 2) continue;
      if (typeof d?.default !== 'string' || d.default.length === 0) continue;
      const letters = new Set(d.options.map((o) => (o && typeof o === 'object') ? o.letter : undefined));
      if (!letters.has(d.default)) continue;
      optional.push({
        id: `Q-D7-open-decision:${d.id}`,
        ask: `Decision ${d.id} ${d.question ?? ''} The default is (${d.default}). Answer now or let it stand.`.trim(),
        blocks: 'build',
      });
    }
  }

  const engineerCount = readiness?.personas?.engineer?.blockers?.length ?? 0;
  const engineerNext = readiness?.personas?.engineer?.nextAction ?? null;

  return {
    treeHash: readiness?.tree?.currentTreeHash ?? null,
    persona,
    level,
    ok,
    remaining: sortedQuestions.length,
    groups,
    questions: sortedQuestions,
    optional,
    ...(persona === 'productOwner'
      ? { engineer: { blockers: engineerCount, nextAction: engineerNext } }
      : {}),
  };
}

/**
 * Pull the per-item failing records out of a blocker. Returns objects
 * carrying `{ id, why }` plus (when available) `statement`, `req`,
 * `decision` or `profileField` so the question builder can quote the
 * right passage.
 *
 * @param {object} blocker
 * @param {Array<any>} briefStatements
 * @param {object} tree
 */
function extractItems(blocker, briefStatements, tree, readiness) {
  // Spec §1.2: one question per failing item. `blocker.ids` is the
  // readiness summary and is capped at 20 (readiness.js:373/405), so a
  // check with more than 20 failing items would silently lose
  // questions. Look up the full `check.failing[]` on the stage first
  // and only fall back to `blocker.ids` when the stage is missing.
  let ids = Array.isArray(blocker.ids) ? blocker.ids : [];
  const stages = Array.isArray(readiness?.stages) ? readiness.stages : [];
  const stage = stages.find((st) => st?.stage === blocker.stage);
  const check = stage?.checks?.find((c) => c?.name === blocker.check);
  const failing = Array.isArray(check?.failing) ? check.failing : null;
  if (failing) ids = [...new Set(failing.map((f) => f?.id).filter((id) => id != null))];
  /** @type {Array<{ id: string, why?: string, statement?: any, req?: any, decision?: any, profileField?: string }>} */
  const out = [];
  for (const id of ids) {
    const item = { id, why: undefined };
    if (typeof id === 'string' && id.startsWith('brief:')) {
      const rest = id.slice('brief:'.length);
      if (rest === 'ledger') {
        out.push(item);
        continue;
      }
      const stmtId = Number(rest);
      const stmt = briefStatements.find((s) => Number(s?.id) === stmtId);
      if (stmt) item.statement = stmt;
    } else if (typeof id === 'string' && id.startsWith('profile:')) {
      item.profileField = id.slice('profile:'.length);
    } else if (typeof id === 'string' && id.startsWith('decision:')) {
      const decId = id.slice('decision:'.length);
      item.decision = { id: decId };
    } else if (typeof id === 'string' && /^REQ-/.test(id)) {
      item.req = (tree?.requirements ?? []).find((r) => r?.reqId === id) ?? { reqId: id };
    } else {
      // Fallback: unknown id surface, kept so the question still fires.
    }
    out.push(item);
  }
  return out;
}

function makeQuestion(/** @type {object} */ q) { return q; }

/**
 * The per-check template table (spec §1.2). Each check gets:
 *   - a heading (short label; same as the step 2 `check.question`)
 *   - a per-item `ask` (plain sentence quoting the passage)
 *   - `answerKinds` (closed enumeration)
 *   - `writeBack` (one entry per `when`)
 */
function buildQuestionForItem(blocker, item, {
  briefStatements, tree, decisionEntries, blocks, persona,
}) {
  const stage = blocker.stage;
  const check = blocker.check;
  const itemId = item.id;
  const qid = `Q-${stage}-${check.replace(/[^A-Za-z0-9:]/g, '-')}-${itemId}`;

  // ---- D1 brief:sinceFreeze -------------------------------------------
  if (check === 'brief:sinceFreeze') {
    return makeQuestion({
      id: qid,
      stage, check, itemId,
      heading: 'What has changed, or what is this project for?',
      ask: 'The brief is empty. Hand me your document, or tell me in a few sentences what this is for.',
      context: { sourceSpan: 'tree' },
      answerKinds: ['document', 'text'],
      writeBack: [
        { when: 'document', command: 'rcf define ledger brief add --from <path>' },
        { when: 'text', command: 'rcf define ledger brief add --text "<text>"' },
      ],
      blocks,
    });
  }

  // ---- D1 brief:kinds -------------------------------------------------
  if (check === 'brief:kinds' && item.statement) {
    const stmt = item.statement;
    return makeQuestion({
      id: qid,
      stage, check, itemId,
      heading: 'Is this a capability, a constraint, an actor, or something else?',
      ask: `Statement ${stmt.id} says ${JSON.stringify(stmt.text ?? '')}. Is this something the product must do, a rule it must obey, a person or role, a thing it keeps track of, another system, a screen or channel, out of scope, or a question still to answer?`,
      context: {
        statement: { id: stmt.id, kind: stmt.kind, text: stmt.text, source: stmt.source },
      },
      answerKinds: ['rekind'],
      writeBack: [
        { when: 'rekind', command: `rcf define ledger brief update ${stmt.id} --kind <kind>` },
      ],
      blocks,
    });
  }

  // ---- D1 brief:openQuestions ---------------------------------------
  if (check === 'brief:openQuestions' && item.statement) {
    const stmt = item.statement;
    return makeQuestion({
      id: qid,
      stage, check, itemId,
      heading: 'Any open questions in the brief, resolved or promoted to a decision?',
      ask: `Your document asks: ${JSON.stringify(stmt.text ?? '')}. Can you answer it now, or should I write it down as a decision with options and a default?`,
      context: {
        statement: { id: stmt.id, kind: stmt.kind, text: stmt.text, source: stmt.source },
      },
      answerKinds: ['answer', 'promote'],
      writeBack: [
        { when: 'answer', command: `rcf define ledger brief resolve ${stmt.id} --answer "<text>"` },
        { when: 'promote', command: `rcf define ledger decisions add --question "${(stmt.text ?? '').replace(/"/g, '\\"')} (brief ${stmt.id})" --option a:<optA> --option b:<optB> --default a --blocks "brief:${stmt.id}"; rcf define ledger brief resolve ${stmt.id} --answer "decision <id>"` },
      ],
      blocks,
    });
  }

  // ---- D1 brief:profile ---------------------------------------------
  if (check === 'brief:profile' && item.profileField) {
    const field = item.profileField;
    if (field === 'surface') {
      return makeQuestion({
        id: qid,
        stage, check, itemId,
        heading: 'Where will the owner look at what we produce?',
        ask: 'Where will you look at what we produce: a web page, the running app, or a code review diff?',
        context: { profileField: 'surface' },
        answerKinds: ['choose'],
        writeBack: [
          { when: 'choose', command: 'edit rcf/.identity/profile.md: replace the Surface choice list with one of viewer | runningApp | prDiff' },
        ],
        blocks,
      });
    }
    if (field === 'register') {
      return makeQuestion({
        id: qid,
        stage, check, itemId,
        heading: 'Who is driving: product owner or engineer?',
        ask: 'Are you the product owner or an engineer?',
        context: { profileField: 'register' },
        answerKinds: ['choose'],
        writeBack: [
          { when: 'choose', command: 'edit rcf/.identity/profile.md: replace the Register choice list with one of productOwner | engineer' },
        ],
        blocks,
      });
    }
  }

  // ---- D2 skeleton:resolvedBy ----------------------------------------
  if (check === 'skeleton:resolvedBy' && item.statement) {
    const stmt = item.statement;
    const suggestions = suggestReqTitles(stmt.text, tree);
    return makeQuestion({
      id: qid,
      stage, check, itemId,
      heading: 'Does this statement become a requirement, an entity, or an omission?',
      ask: `Your document says ${JSON.stringify(stmt.text ?? '')}. Is this its own requirement, part of an existing one, or something else (a person, a record, another system, a screen, or out of scope)?`,
      context: {
        statement: { id: stmt.id, kind: stmt.kind, text: stmt.text, source: stmt.source },
        suggestions,
      },
      answerKinds: ['existingReq', 'newReq', 'rekind', 'omit'],
      writeBack: [
        { when: 'existingReq', command: `rcf define ledger brief update ${stmt.id} --resolved-by <REQ-id>` },
        { when: 'newReq', command: `rcf define create req --parent PRD-001 --title "<title>"; rcf define update <REQ-id> --set description="<sentence>" --set domain="<area>"; rcf define ledger brief update ${stmt.id} --resolved-by <REQ-id>` },
        { when: 'rekind', command: `rcf define ledger brief update ${stmt.id} --kind <kind> --resolved-by <pointer>` },
        { when: 'omit', command: `rcf define ledger brief update ${stmt.id} --resolved-by "omitted:<reason>"` },
      ],
      blocks,
    });
  }

  // ---- D2 skeleton:reqIntent ----------------------------------------
  if (check === 'skeleton:reqIntent' && item.req) {
    const req = item.req;
    return makeQuestion({
      id: qid,
      stage, check, itemId,
      heading: 'What does this requirement mean and where does it sit?',
      ask: `Requirement ${JSON.stringify(req.title ?? req.reqId ?? '')} has no plain description (or no area). In a sentence, what must the product do here, and which part of the product does it belong to?`,
      context: { reqId: req.reqId, title: req.title },
      answerKinds: ['text'],
      writeBack: [
        { when: 'text', command: `rcf define update ${req.reqId} --set description="<sentence>" --set domain="<area>"` },
      ],
      blocks,
    });
  }

  // ---- D4 stories:reqHasUs -------------------------------------------
  if (check === 'stories:reqHasUs' && item.req) {
    const req = item.req;
    return makeQuestion({
      id: qid,
      stage, check, itemId,
      heading: 'What does someone do with this requirement?',
      ask: `Who uses ${JSON.stringify(req.title ?? req.reqId ?? '')}, and what do they do with it? Say it as: as a <who>, I want <what>, so that <why>.`,
      context: { reqId: req.reqId, title: req.title },
      answerKinds: ['story'],
      writeBack: [
        { when: 'story', command: `rcf define create us --parent ${req.reqId} --title "as a <who>, I want <what>, so that <why>"; rcf define update <US-id> --json --set story='{"asA":"<who>","iWant":"<what>","soThat":"<why>"}'; rcf define create ac --parent <US-id> --description "[happy] <criterion>"` },
      ],
      blocks,
    });
  }

  // ---- D7 decisions:wellFormed --------------------------------------
  if (check === 'decisions:wellFormed' && item.decision) {
    const dec = decisionEntries.find((d) => String(d?.id) === String(item.decision.id));
    const q = dec?.question ?? '(no question)';
    return makeQuestion({
      id: qid,
      stage, check, itemId,
      heading: 'Every decision is enumerated.',
      ask: `Decision ${item.decision.id} asks ${JSON.stringify(q)} but has no options (or no default). What are the choices, and which would you pick if nobody objected?`,
      context: { decision: { id: item.decision.id, question: dec?.question } },
      answerKinds: ['enumerate'],
      writeBack: [
        { when: 'enumerate', command: `rcf define ledger decisions update ${item.decision.id} --option a:<optA> --option b:<optB> --default a` },
      ],
      blocks,
    });
  }

  // Fallback: a blocker without a template still returns one question
  // carrying the check's step-2 question as the ask. This keeps the
  // loop monotone (an unexpected engineer check does not drop silent).
  return makeQuestion({
    id: qid,
    stage, check, itemId,
    heading: blocker.question ?? check,
    ask: blocker.question ?? check,
    context: { sourceSpan: 'tree' },
    answerKinds: [],
    writeBack: [],
    blocks,
  });
}

/**
 * Up to three REQ titles sharing two or more words of 4+ chars with
 * the statement text. Deterministic (sort by reqId).
 */
function suggestReqTitles(statementText, tree) {
  if (typeof statementText !== 'string' || !tree) return [];
  const words = new Set(
    String(statementText).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4),
  );
  if (words.size === 0) return [];
  const out = [];
  for (const req of tree.requirements ?? []) {
    const t = typeof req?.title === 'string' ? req.title : '';
    const titleWords = new Set(t.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
    let hits = 0;
    for (const w of titleWords) if (words.has(w)) hits++;
    if (hits >= 2) out.push({ reqId: req.reqId, title: t, hits });
  }
  out.sort((a, b) => (b.hits - a.hits) || a.reqId.localeCompare(b.reqId));
  return out.slice(0, 3).map((e) => `${e.reqId} ${e.title}`);
}

/**
 * Human label for a source-span key. Spec §1.2 example: a `source:
 * briefs/x.md:12-14` key renders as "your document, lines 12 to 14".
 */
function sourceLabel(key) {
  if (!key || key === 'tree') return 'the tree';
  const m = /^(?:source:)?(.+?):(\d+)(?:-(\d+))?$/.exec(key);
  if (!m) return key;
  const path = m[1];
  const start = m[2];
  const end = m[3];
  if (end && start !== end) return `${path}, lines ${start} to ${end}`;
  return `${path}, line ${start}`;
}

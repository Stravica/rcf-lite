// DEFINE stage gates D1..D8 (REQ-174; proposal 2026-09-22 §2.4, §3.2,
// §5.2 v3; Baz 2026-09-24 renumbering: warn-with-ack D3/D5/D6 ships in
// 0.29.0, the fuller template parser / catalogue / probe runner in
// 0.30).
//
// One exported check function per stage. Each is pure: no filesystem
// I/O, no state, no time. The caller (computeReadiness) assembles the
// context: the walker tree, the four ledgers, the freeze record, the
// delta, the scope (changed union added union fan-out), validate
// errors, probe-ledger open count, tree-wide coverage rollup, and the
// operator profile string.
//
// Every function returns:
//
//   {
//     stage: 'D1'..'D8',
//     gate:  'define.brief' | 'define.skeleton' | ...,
//     state: 'passed' | 'failing' | 'acknowledged' | 'notApplicable',
//     checks: [
//       {
//         name,
//         ok,           // boolean
//         over,         // 'delta' | 'tree'
//         pass, total,  // integers
//         failing: [ { id, why } ]
//       }, ...
//     ]
//   }
//
// State fold (ADR-4122):
//   - Blocking stages (D1, D2, D4, D7, D8): 'passed' when every
//     check.ok is true; 'failing' otherwise. 'notApplicable' is
//     decided by the stage before checks run.
//   - Warn-with-ack stages (D3, D5, D6): 'passed' when every check.ok
//     is true; 'acknowledged' when any check is failing AND
//     freeze.gates[<gate>].state === 'acknowledged' AND
//     freeze.gates[<gate>].at.hash === currentTreeHash; 'failing'
//     otherwise.
//
// Warn-with-ack stages in 0.29.0 run only the cheap data-backed
// checks proposal §3.2 lists; the template parser, entity join,
// catalogue walk, contradiction / unsatisfiable scans and probe
// runner are 0.30 and left as named seams (`SEAM 0.30:` comments
// mark them).

import { computeQueue } from '../build/queue.js';
import { isOptedOut } from '../req-baseline/opt-out.js';
import { BRIEF_KINDS, parseResolvedBy } from '../define/ledgers.js';
import { applicableConcernsForShapes } from '../define/concern-catalogue.js';

/** Canonical stage order (proposal §3.2). */
export const STAGE_ORDER = /** @type {const} */ (['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8']);

/** Stage -> gate id map (used by the freeze verb and the CLI --check flag). */
export const STAGE_GATES = /** @type {const} */ ({
  D1: 'define.brief',
  D2: 'define.skeleton',
  D3: 'define.shapes',
  D4: 'define.stories',
  D5: 'define.crosscut',
  D6: 'define.consistency',
  D7: 'define.decisions',
  D8: 'define.freeze',
});

/** Stage -> operator-friendly short name (--check <short> equivalent to --check <D>). */
export const STAGE_SHORT_NAMES = /** @type {const} */ ({
  D1: 'brief',
  D2: 'skeleton',
  D3: 'shapes',
  D4: 'stories',
  D5: 'crosscut',
  D6: 'consistency',
  D7: 'decisions',
  D8: 'freeze',
});

/** Reverse: short name / D-name -> D-stage. Consumers accept either. */
export const STAGE_ALIASES = /** @type {const} */ (() => {
  /** @type {Record<string, string>} */
  const out = {};
  for (const stage of STAGE_ORDER) {
    out[stage] = stage;
    out[STAGE_SHORT_NAMES[stage]] = stage;
  }
  return out;
})();

/** Closed vocabulary for TAC.interfaces[].kind (proposal §5.2 v1). */
export const INTERFACE_KINDS = /** @type {const} */ ([
  'recordShape', 'httpRoute', 'event', 'cliCommand', 'uiRoute',
  'port', 'fileFormat', 'fixture', 'other',
]);

/**
 * Owning persona for every stage-gate check in 0.29.0 (ADR-4126).
 *
 * Two values: `productOwner` (the person who owns what the product
 * must do) and `engineer` (the person who owns how it is built).
 * There is no `either` / `shared` / `both`; a check that would need
 * both is split, which is what happens to `skeleton:reqFields`
 * (becomes `skeleton:reqIntent` + `skeleton:reqShape`) and
 * `decisions:allAnswered` (becomes `decisions:wellFormed` +
 * `decisions:allAnswered`). A failing item inherits its check's
 * persona; there is no per-item override.
 *
 * The `notApplicable` placeholder (`stage:<D>:scope`) carries the
 * per-stage fallback persona from `STAGE_FALLBACK_PERSONA` below.
 * It is always ok so it never affects a level verdict.
 */
export const CHECK_PERSONA = /** @type {const} */ ({
  // D1 Brief: every check is PO (the brief is the PO's statement of intent).
  'brief:sinceFreeze': 'productOwner',
  'brief:kinds': 'productOwner',
  'brief:openQuestions': 'productOwner',
  'brief:profile': 'productOwner',
  // D2 Skeleton: resolvedBy + reqIntent are PO; reqShape, tadPersistence, deployAdr, standardsCited are engineer.
  'skeleton:resolvedBy': 'productOwner',
  'skeleton:reqIntent': 'productOwner',
  'skeleton:reqShape': 'engineer',
  'skeleton:tadPersistence': 'engineer',
  'skeleton:deployAdr': 'engineer',
  'skeleton:standardsCited': 'engineer',
  // D3 Shapes: every check is engineer (shapes are the engineer's first act after hand-over).
  'shapes:tacHasInterface': 'engineer',
  'shapes:kindVocabulary': 'engineer',
  'shapes:draftSettled': 'engineer',
  'shapes:templateMarkers': 'engineer',
  'shapes:entityJoin': 'engineer',
  'shapes:pathsResolve': 'engineer',
  // D4 Stories: reqHasUs is PO ("what does someone do with this?"); the floors, closed sets and ownerRef resolution are engineer.
  'stories:reqHasUs': 'productOwner',
  'stories:usFloors': 'engineer',
  'stories:closedSets': 'engineer',
  'stories:ownerRefResolves': 'engineer',
  // D5 Crosscut: TAD + concern-ledger content and the catalogue walk are engineering.
  'crosscut:securityArchitecture': 'engineer',
  'crosscut:operationalConcerns': 'engineer',
  'crosscut:concernsResolved': 'engineer',
  'crosscut:catalogue': 'engineer',
  // D6 Consistency: schema validity, probes and the four scans are engineer.
  'consistency:validateClean': 'engineer',
  'consistency:probeCount': 'engineer',
  'consistency:contradictions': 'engineer',
  'consistency:unsatisfiable': 'engineer',
  'consistency:duplicates': 'engineer',
  'consistency:orphanInterfaces': 'engineer',
  // D7 Decisions: enumeration is PO (the PO answers or lets the default stand);
  // zero-open is the engineer's hand-over condition.
  'decisions:wellFormed': 'productOwner',
  'decisions:allAnswered': 'engineer',
  // D8 Freeze: every check is mechanical / engineering.
  'freeze:priorGates': 'engineer',
  'freeze:acFbsOwnership': 'engineer',
  'freeze:queueHead': 'engineer',
  'freeze:validateClean': 'engineer',
});

/**
 * Per-check heading question in the owning persona's register
 * (ADR-4126, proposal section 1.1). The text report and the
 * Readiness tab print the question as the heading of each check's
 * findings list. Static per check in 0.29.0; per-item plain-English
 * wording is step 3's guided elicitation.
 */
export const CHECK_QUESTION = /** @type {const} */ ({
  'brief:sinceFreeze': 'What has changed, or what is this project for?',
  'brief:kinds': 'Is this a capability, a constraint, an actor, or something else?',
  'brief:openQuestions': 'Any open questions in the brief, resolved or promoted to a decision?',
  'brief:profile': 'How do you want to review, and who are you writing for?',
  'skeleton:resolvedBy': 'Does this statement become a requirement, an entity, or an omission?',
  'skeleton:reqIntent': 'What does this requirement mean and where does it sit?',
  'skeleton:reqShape': 'Every requirement in scope carries a shape classification.',
  'skeleton:tadPersistence': 'TAD data architecture lists dataStores and coreEntities for persistence REQs.',
  'skeleton:deployAdr': 'Exactly one Deploy target or Deploy deferral ADR exists.',
  'skeleton:standardsCited': 'Every registered standards pack is cited, applied or waived.',
  'shapes:tacHasInterface': 'Every TAC in scope has at least one interface.',
  'shapes:kindVocabulary': 'Every interface kind is in the closed vocabulary.',
  'shapes:draftSettled': 'Every draft interface has been settled (the [draft] marker is removed).',
  'shapes:templateMarkers': 'Every interface description carries the per-kind markers (recordShape fields:, httpRoute method/path/request/response/errors, and so on).',
  'shapes:entityJoin': 'Every core entity is named by exactly one recordShape.',
  'shapes:pathsResolve': 'Every path: token in an interface description resolves on disk or the description is authoredAt D3.',
  'stories:reqHasUs': 'What does someone do with this requirement?',
  'stories:usFloors': 'Every story in scope meets the class, tacIds and testability floors.',
  'stories:closedSets': 'Every acceptance criterion that invites a set of values names the set or points to an owner.',
  'stories:ownerRefResolves': 'Every ownerRef on an acceptance criterion resolves to an interface on the owning TAC.',
  'crosscut:securityArchitecture': 'TAD.securityArchitecture is present when an auth or httpApi REQ exists.',
  'crosscut:operationalConcerns': 'TAD.operationalConcerns is present when a deployed-scope AC exists.',
  'crosscut:concernsResolved': 'Every concern-ledger entry on a REQ in scope is applied or waived.',
  'crosscut:catalogue': 'Every applicable crosscut concern for a REQ in scope has a concern-ledger entry applied or waived.',
  'consistency:validateClean': 'Validate is clean tree-wide.',
  'consistency:probeCount': 'Zero open probe-ledger entries.',
  'consistency:contradictions': 'No two acceptance criteria on one story share a when clause with a negated then.',
  'consistency:unsatisfiable': 'Every then names a field some recordShape defines.',
  'consistency:duplicates': 'No two acceptance criteria across stories share an identical description.',
  'consistency:orphanInterfaces': 'Every interface is reached by an AC ownerRef or a REQ deliveredBy.',
  'decisions:wellFormed': 'Every decision is enumerated (question, two or more options, a default).',
  'decisions:allAnswered': 'Zero decisions are open.',
  'freeze:priorGates': 'Every prior stage passed or is acknowledged at the current hash.',
  'freeze:acFbsOwnership': 'Every AC is owned by exactly one FBS.',
  'freeze:queueHead': 'Queue head is actionable and not a placeholder.',
  'freeze:validateClean': 'Validate is clean tree-wide.',
});

/**
 * Per-stage fallback persona for the `stage:<D>:scope` placeholder
 * check that `notApplicable` envelopes carry. The placeholder is
 * always ok so this never affects a level, but keeps "every check
 * has a persona" true for consumers and the table test (ADR-4126
 * decision 10).
 */
export const STAGE_FALLBACK_PERSONA = /** @type {const} */ ({
  D1: 'productOwner',
  D2: 'productOwner',
  D3: 'engineer',
  D4: 'productOwner',
  D5: 'engineer',
  D6: 'engineer',
  D7: 'productOwner',
  D8: 'engineer',
});

/**
 * Look up the question heading for a check name.
 * @param {string} name
 * @returns {string}
 */
export function checkQuestion(name) {
  return /** @type {any} */ (CHECK_QUESTION)[name] ?? '';
}

/**
 * Look up the owning persona for a check name.
 * @param {string} name
 * @returns {'productOwner' | 'engineer' | null}
 */
export function checkPersona(name) {
  const v = /** @type {any} */ (CHECK_PERSONA)[name];
  return v === 'productOwner' || v === 'engineer' ? v : null;
}

/**
 * Draft marker (ADR-4126 for `TAC.interfaces[].description` in 0.29.0;
 * REQ-188 extends it to `TAC.purpose` and `coreEntities[].description`
 * in 0.30.0). A description that starts with `[draft]` after optional
 * leading whitespace is pre-populated engineer entry material; the
 * engineer removes the marker when the shape is settled. Decision 6
 * uses the same bracket-prefix convention for AC class.
 */
const INTERFACE_DRAFT_RE = /^\[draft\]/;

/**
 * True when a string carries the leading `[draft]` marker
 * (whitespace tolerated). Pure string test used by every draft-home
 * reader below.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function hasDraftMarker(value) {
  if (typeof value !== 'string') return false;
  return INTERFACE_DRAFT_RE.test(value.trimStart());
}

/**
 * True when an interface's `description` carries the leading
 * `[draft]` marker (whitespace tolerated). Thin wrapper over
 * `hasDraftMarker` kept for ADR-4126 call sites; REQ-188 adds
 * `parseTacPurposeDraft` and `parseCoreEntityDraft` for the two new
 * homes.
 *
 * @param {unknown} iface
 * @returns {boolean}
 */
export function parseInterfaceDraft(iface) {
  if (!iface || typeof iface !== 'object') return false;
  return hasDraftMarker(/** @type {any} */ (iface).description);
}

/**
 * True when a TAC's `purpose` carries the leading `[draft]` marker
 * (whitespace tolerated). REQ-188 draft home; the engineer removes
 * the marker when the TAC's purpose is owned.
 *
 * @param {unknown} tac
 * @returns {boolean}
 */
export function parseTacPurposeDraft(tac) {
  if (!tac || typeof tac !== 'object') return false;
  return hasDraftMarker(/** @type {any} */ (tac).purpose);
}

/**
 * True when a coreEntities entry's `description` carries the
 * leading `[draft]` marker (whitespace tolerated). REQ-188 draft
 * home; the engineer removes the marker when the entity is owned.
 *
 * @param {unknown} entity
 * @returns {boolean}
 */
export function parseCoreEntityDraft(entity) {
  if (!entity || typeof entity !== 'object') return false;
  return hasDraftMarker(/** @type {any} */ (entity).description);
}

/**
 * Per-kind required marker tokens on `interfaces[].description` for
 * the `shapes:templateMarkers` D3 bite check (ADR-4131, spec section 4
 * row "D3 template parser"). A marker is "present" when a line of the
 * description matches the marker's own regex: a `<name>:` prefix for
 * `fields:`, `instances:`, `payload:`, `usage:` and `format:`; a
 * `method`, `path`, `request`, `response`, `errors` or `protocol`
 * token on an httpRoute, uiRoute or port (word-bounded, case-sensitive,
 * tolerating a trailing colon or whitespace); `other` requires a
 * non-empty description after the optional `[draft]` prefix (its
 * "note"). The regexes are deliberately permissive so a plain
 * `method: POST` and a bullet list `- method: POST` both qualify, and
 * so a `[draft]` prefix never masks the marker scan.
 */
const INTERFACE_TEMPLATE_MARKERS = /** @type {const} */ ({
  recordShape: [{ name: 'fields', re: /(^|\n)\s*(?:[-*]\s*)?fields\s*:/ }],
  httpRoute: [
    { name: 'method', re: /(^|\n|\s)method\s*[:=]/ },
    { name: 'path', re: /(^|\n|\s)path\s*[:=]/ },
    { name: 'request', re: /(^|\n|\s)request\s*[:=]/ },
    { name: 'response', re: /(^|\n|\s)response\s*[:=]/ },
    { name: 'errors', re: /(^|\n|\s)errors\s*[:=]/ },
  ],
  fixture: [{ name: 'instances', re: /(^|\n)\s*(?:[-*]\s*)?instances\s*:/ }],
  event: [{ name: 'payload', re: /(^|\n)\s*(?:[-*]\s*)?payload\s*:/ }],
  cliCommand: [{ name: 'usage', re: /(^|\n)\s*(?:[-*]\s*)?usage\s*:/ }],
  uiRoute: [{ name: 'path', re: /(^|\n|\s)path\s*[:=]/ }],
  port: [{ name: 'protocol', re: /(^|\n|\s)protocol\s*[:=]/ }],
  fileFormat: [{ name: 'format', re: /(^|\n)\s*(?:[-*]\s*)?format\s*:/ }],
  other: [],
});

/**
 * Strip a leading `[draft]` marker from a description so the marker
 * scan sees the real text underneath. Pure.
 *
 * @param {string} desc
 * @returns {string}
 */
function stripDraftPrefix(desc) {
  return desc.replace(/^\s*\[draft\]\s*/, '');
}

/**
 * ADR-4131 (0.30.0 PR 5): per-kind marker presence on an interface.
 * Returns `{ kind, missing: string[] }` naming the markers that are
 * absent from `iface.description`. For `other` the "note" is any
 * non-empty description after the optional `[draft]` prefix. For an
 * interface whose kind is outside INTERFACE_KINDS the function returns
 * `{ kind, missing: [] }` so the caller can treat vocabulary errors
 * through `shapes:kindVocabulary` alone.
 *
 * @param {unknown} iface
 * @returns {{ kind: string|null, missing: string[] }}
 */
export function parseInterfaceTemplate(iface) {
  if (!iface || typeof iface !== 'object') return { kind: null, missing: [] };
  const kind = typeof (/** @type {any} */ (iface).kind) === 'string' ? /** @type {any} */ (iface).kind : null;
  const descRaw = typeof (/** @type {any} */ (iface).description) === 'string'
    ? /** @type {any} */ (iface).description
    : '';
  const desc = stripDraftPrefix(descRaw);
  if (kind === 'other') {
    const note = desc.trim();
    return { kind, missing: note.length === 0 ? ['note'] : [] };
  }
  const markers = /** @type {any} */ (INTERFACE_TEMPLATE_MARKERS)[kind];
  if (!Array.isArray(markers)) return { kind, missing: [] };
  const missing = [];
  for (const marker of markers) {
    if (!marker.re.test(desc)) missing.push(marker.name);
  }
  return { kind, missing };
}

/**
 * Known bare repo filenames the slash-or-extension rule would otherwise
 * silently skip (ruling R6 2026-10-05). A `path: Dockerfile` on an
 * interface description names a real file at the repo root, so the
 * `shapes:pathsResolve` check should see it. Exported so the tests can
 * assert the list verbatim; a bare word outside this set still fails
 * the slash-or-extension rule as before.
 */
export const BARE_PATH_WHITELIST = /** @type {const} */ ([
  'Dockerfile',
  'Containerfile',
  'Makefile',
  'LICENSE',
  'Procfile',
  'Justfile',
  'Rakefile',
  'Gemfile',
  'CODEOWNERS',
]);
const BARE_PATH_WHITELIST_SET = new Set(BARE_PATH_WHITELIST);

/**
 * Rough `path:` token scanner for an interface description. Returns
 * every candidate path token the description names so the CLI can
 * resolve them on disk and the gate can decide `shapes:pathsResolve`
 * against the resolved map (ADR-4131). A candidate is any text that
 * follows a `path:` or `path =` marker and looks like a repo-relative
 * path (contains a `/` or ends with a file extension, or is one of the
 * known bare repo names in BARE_PATH_WHITELIST per ruling R6
 * 2026-10-05, no scheme). The scanner is deliberately conservative: an
 * http URL, a bare word outside the whitelist, a glob or a template
 * placeholder is not a candidate. Exported for the CLI's resolve-on-disk
 * pass.
 *
 * @param {string} description
 * @returns {string[]}
 */
export function extractInterfacePathTokens(description) {
  if (typeof description !== 'string' || description.length === 0) return [];
  const text = stripDraftPrefix(description);
  const out = [];
  const re = /\bpath\s*[:=]\s*["'`]?([^\s"'`,;)\]]+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const token = m[1];
    if (!token) continue;
    if (/^[a-z]+:\/\//i.test(token)) continue;
    if (token.startsWith('{') || token.startsWith('<') || token.includes('*')) continue;
    // Skip HTTP / UI route-ish tokens: a leading slash with no file
    // extension is a route path (an httpRoute or uiRoute's `path:`
    // marker), not a repo path. A legitimate file path lands as
    // `src/x.js` or `packages/rcf-lite/CHANGELOG.md`; those don't
    // start with `/`.
    if (token.startsWith('/') && !/\.[a-zA-Z0-9]+$/.test(token)) continue;
    // Ruling R6 2026-10-05: whitelist the usual bare repo names.
    if (BARE_PATH_WHITELIST_SET.has(token)) {
      out.push(token);
      continue;
    }
    if (!/\//.test(token) && !/\.[a-zA-Z0-9]+$/.test(token)) continue;
    out.push(token);
  }
  return out;
}

/** Warn-with-ack stages in 0.29.0 (ADR-4122). */
const WARN_WITH_ACK = new Set(['D3', 'D5', 'D6']);

/** Blocking stages in 0.29.0 (ADR-4122). */
const BLOCKING = new Set(['D1', 'D2', 'D4', 'D7', 'D8']);

/**
 * Signals a stage exports so consumers can render policy in the pill
 * vocabulary without touching internals. Kept as a helper so the CLI
 * text output and the viewer share one source.
 * @param {string} stage
 * @returns {'blocking' | 'warnWithAck'}
 */
export function stagePolicy(stage) {
  return WARN_WITH_ACK.has(stage) ? 'warnWithAck' : 'blocking';
}

/**
 * ADR-4131 (0.30.0 PR 5): the three gates that accept a recorded
 * `--ack` override. `stagePolicy` keeps returning `blocking` for every
 * stage so the readyToBuild fold stays untouched; `ackable(stage)` is
 * the companion signal the readiness and freeze CLIs read to decide
 * whether a failing stage honours an acknowledgement at the current
 * hash. True for D3, D5 and D6; false for everything else.
 *
 * @param {string} stage
 * @returns {boolean}
 */
export function ackable(stage) {
  return WARN_WITH_ACK.has(stage);
}

/**
 * Scaffold TODO placeholder marker: uppercase "TODO" followed by a
 * colon, matching every scaffold string `rcf init` and `rcf define
 * create` write (see src/core/store/init.js and src/core/store/writer.js:
 * every scaffold field is 'TODO: <text>'). Word-bounded and
 * case-sensitive so incidental prose like "the scaffold TODO
 * placeholder" or "no TODO markers" does not trip the gate. The
 * validate CLI (src/cli/validate.js) keeps its own broader
 * `\btodo\b/i` matcher for the informational tree-wide notice, so
 * incidental prose still surfaces there without failing D2 / D4.
 */
const TODO_RE = /\bTODO:/;

/** Bracketed AC-class prefix (Baz decision 6, proposal §3.2 D4). */
const AC_CLASS_RE = /^\[(happy|edge|failure|must-not|non-functional)\]/;

/**
 * Enumeration cues for `stories:closedSets` (spec section 4 row 'D4
 * closed-set and ownerRef as findings', 0.30.0 PR 6). An AC description
 * that contains any of these cues outside a quoted string, with no
 * inline bracketed list or ownerRef, invites an unlisted value and
 * fails the check. The cues are matched case-insensitively against the
 * raw description (minus any leading [class] marker and any
 * double-quoted substrings).
 */
const CLOSED_SET_CUES = Object.freeze([
  'one of',
  'any of',
  'the following',
  'types of',
  'status is',
]);
// Word-boundary matchers for each cue so a longer word that happens
// to contain the cue as a substring (e.g. "status issue" containing
// "status is") does not trip the gate.
const CLOSED_SET_CUE_RES = Object.freeze(
  CLOSED_SET_CUES.map((cue) => new RegExp(`\\b${cue.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'i')),
);

/**
 * Inline bracketed list regex for the closed-sets check: a square-
 * bracketed group whose contents look like a list of two or more
 * tokens separated by commas, slashes or pipes. A bare `[happy]`
 * class marker is NOT a list (one token, no separator); `[a, b]`,
 * `[a | b | c]` and `[a/b]` are.
 */
const INLINE_LIST_RE = /\[[^\]\n]*[,|\/][^\]\n]*\]/;

/**
 * ownerRef marker: a cheap presence check for the structured
 * `{ tacId, field: "interfaces[<name>]" }` pointer. True when the AC
 * carries an ownerRef object (consistency-lint and PR 6 both read the
 * same field).
 *
 * @param {unknown} ac
 * @returns {boolean}
 */
function acHasOwnerRef(ac) {
  const ref = ac && typeof ac === 'object' ? /** @type {any} */ (ac).ownerRef : null;
  if (!ref || typeof ref !== 'object') return false;
  // R11 (spec section 17, 2026-10-03): an ownerRef may name a TAC
  // (via tacId) OR an ADR (via adrId). Pre-R11 code only recognised
  // tacId; the ADR branch was dropped silently.
  return typeof ref.tacId === 'string' || typeof ref.adrId === 'string';
}

/**
 * Strip double-quoted substrings so a quoted cue inside the AC text
 * does not fire the closed-sets check (shared with D6's negation guard
 * convention). Matches `"..."` with no embedded unescaped double
 * quote; the regex is deliberately permissive. The strip is only for
 * the cue scan; the inline-list scan reads the full description.
 *
 * @param {string} desc
 * @returns {string}
 */
function stripQuotedSubstrings(desc) {
  return desc.replace(/"[^"\n]*"/g, '');
}

/**
 * True when the AC description carries an enumeration cue outside a
 * quoted substring, with no inline bracketed list and no ownerRef
 * pointer. Pure.
 *
 * @param {unknown} ac
 * @returns {boolean}
 */
function failsClosedSets(ac) {
  const descRaw = ac && typeof ac === 'object' ? /** @type {any} */ (ac).description : null;
  if (typeof descRaw !== 'string' || descRaw.length === 0) return false;
  if (acHasOwnerRef(ac)) return false;
  const descNoClass = descRaw.replace(AC_CLASS_RE, '').trim();
  if (INLINE_LIST_RE.test(descNoClass)) return false;
  const descForCues = stripQuotedSubstrings(descNoClass);
  for (const re of CLOSED_SET_CUE_RES) {
    if (re.test(descForCues)) return true;
  }
  return false;
}

/**
 * Parse an `interfaces[<name>]` field pointer into its interface
 * name. Accepts any non-empty name between the brackets (interface
 * names routinely carry dots, slashes and spaces); returns null for
 * an unparseable pointer.
 *
 * @param {unknown} field
 * @returns {string | null}
 */
function parseOwnerRefInterfaceField(field) {
  if (typeof field !== 'string') return null;
  const m = field.match(/^interfaces\[([^\]\n]+)\]$/);
  return m ? m[1] : null;
}

/**
 * R11 field grammar (spec section 17, 2026-10-03). An `ownerRef` or
 * object-form `deliveredBy` `{ tacId | adrId, field }` resolves when
 * `field` names an existing field path on the owning document in
 * bracket grammar:
 *
 *   - `interfaces[<name>]` resolves when `doc.interfaces[].name` matches.
 *   - `responsibilities[<n>]` resolves when `doc.responsibilities[n]`
 *     exists (non-negative integer index, zero-based).
 *   - `dependencies[<name>]` resolves when `doc.dependencies[].name` matches.
 *   - `alternativesConsidered[<n>]` resolves when the ADR has an
 *     alternative at that index.
 *   - A bare schema field name (`purpose`, `internalStructure`,
 *     `decision`, `name`, `context`, `consequences`, `tradeoffs`,
 *     `notes`, `description`, `responsibilities`, `dependencies`,
 *     `interfaces`, `alternativesConsidered`) resolves when the
 *     document carries a non-empty value under that key.
 *
 * Dotted grammar (`interfaces.name`, `responsibilities.foo`) is NOT
 * accepted: callers of the R11 widening MUST rewrite to bracket
 * grammar first. A path that does not match any arm returns false.
 *
 * `AC-17405-2` is unchanged in effect: `interfaces[loan]` on a TAC
 * carrying an interface named `loan` resolves; `interfaces[missing]`
 * fails.
 *
 * @param {unknown} doc - the owning TAC or ADR document.
 * @param {unknown} field - the ownerRef/deliveredBy field string.
 * @returns {boolean}
 */
export function resolveOwnerRefField(doc, field) {
  if (!doc || typeof doc !== 'object') return false;
  if (typeof field !== 'string' || field.length === 0) return false;
  const d = /** @type {any} */ (doc);
  // interfaces[<name>] -- preserved from the 0.29.0 helper.
  const ifaceMatch = field.match(/^interfaces\[([^\]\n]+)\]$/);
  if (ifaceMatch) {
    const name = ifaceMatch[1];
    return Array.isArray(d.interfaces)
      && d.interfaces.some((iface) => iface && typeof iface === 'object' && iface.name === name);
  }
  // dependencies[<name>] (TAC.dependencies[].name).
  const depMatch = field.match(/^dependencies\[([^\]\n]+)\]$/);
  if (depMatch) {
    const name = depMatch[1];
    return Array.isArray(d.dependencies)
      && d.dependencies.some((dep) => dep && typeof dep === 'object' && dep.name === name);
  }
  // responsibilities[<n>] (zero-based integer index on the strings array).
  const respMatch = field.match(/^responsibilities\[(\d+)\]$/);
  if (respMatch) {
    const idx = Number(respMatch[1]);
    return Array.isArray(d.responsibilities) && idx < d.responsibilities.length
      && typeof d.responsibilities[idx] === 'string'
      && d.responsibilities[idx].length > 0;
  }
  // alternativesConsidered[<n>] (ADR).
  const altMatch = field.match(/^alternativesConsidered\[(\d+)\]$/);
  if (altMatch) {
    const idx = Number(altMatch[1]);
    return Array.isArray(d.alternativesConsidered) && idx < d.alternativesConsidered.length
      && d.alternativesConsidered[idx] && typeof d.alternativesConsidered[idx] === 'object';
  }
  // Bare schema field name. Must be in the TAC/ADR schema and present
  // and non-empty on the document. The accepted set covers the schema
  // fields the spec names and the extras TAC/ADR carry; a field name
  // outside the set returns false.
  const BARE_FIELDS = new Set([
    // TAC fields.
    'purpose', 'internalStructure', 'tradeoffs', 'notes', 'name',
    'responsibilities', 'interfaces', 'dependencies',
    // ADR fields.
    'decision', 'context', 'consequences', 'title',
    'alternativesConsidered',
    // Common.
    'description',
  ]);
  if (!BARE_FIELDS.has(field)) return false;
  const v = d[field];
  if (v == null) return false;
  if (typeof v === 'string') return v.length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

/**
 * Parse the leading bracketed class marker on `ac.description`.
 * Returns the class token, or null when no marker is present.
 *
 * @param {unknown} ac
 * @returns {string | null}
 */
export function parseAcClass(ac) {
  const desc = ac && typeof ac === 'object' ? /** @type {any} */ (ac).description : null;
  if (typeof desc !== 'string') return null;
  const m = desc.trim().match(AC_CLASS_RE);
  return m ? m[1] : null;
}

/**
 * Build a helper `{ name, ok, over, pass, total, failing }` in one
 * call. `failing` is normalised to the { id, why } shape and omitted
 * when ok is true (the surface is stable either way; the array is
 * always present for consumers that fold on length).
 *
 * @param {string} name
 * @param {'delta' | 'tree'} over
 * @param {number} total
 * @param {Array<{ id: string, why: string }>} failing
 * @param {number} [totalFailingCount] Untruncated failing count. Defaults to
 *   `failing.length`. Callers that truncate the failing array for display
 *   (e.g. `.slice(0, 20)` on a large validate-error set) pass the full
 *   count here so `pass = total - untruncatedFailing`; without this the
 *   fold `pass = total - failing.length` over-counts passes beyond the
 *   twentieth failure. `ok` is likewise derived from the untruncated
 *   count. The section 2.4 shape stays intact -- `failing` remains the
 *   display array; no new field is exported.
 * @returns {{ name: string, ok: boolean, over: 'delta'|'tree', pass: number, total: number, failing: Array<{ id: string, why: string }>, persona: 'productOwner'|'engineer', question: string }}
 */
function makeCheck(name, over, total, failing, totalFailingCount) {
  const nFailing = typeof totalFailingCount === 'number' ? totalFailingCount : failing.length;
  const pass = Math.max(0, total - nFailing);
  // Resolve persona + question for the check. For stage placeholders
  // (`stage:<D>:scope`) the persona comes from STAGE_FALLBACK_PERSONA.
  // Unknown names fall back to engineer with an empty question so
  // consumers never see null; the table test catches any new check
  // that forgets to register in CHECK_PERSONA / CHECK_QUESTION.
  let persona = /** @type {any} */ (CHECK_PERSONA)[name];
  if (!persona) {
    const stageMatch = /^stage:(D[1-8]):scope$/.exec(name);
    persona = stageMatch
      ? /** @type {any} */ (STAGE_FALLBACK_PERSONA)[stageMatch[1]]
      : 'engineer';
  }
  const question = /** @type {any} */ (CHECK_QUESTION)[name]
    ?? (name.startsWith('stage:') ? 'No documents of this stage’s type are in scope.' : '');
  return { name, ok: nFailing === 0, over, pass, total, failing: [...failing], persona, question };
}

/**
 * Fold a checks[] into a stage envelope with the ADR-4122 state rules
 * applied. Blocking stages ignore acknowledgement; warn-with-ack
 * stages honour a freeze.gates[<gate>] entry at the current tree hash.
 *
 * @param {string} stage
 * @param {string} gate
 * @param {Array<ReturnType<typeof makeCheck>>} checks
 * @param {object} [freezeCtx]
 * @param {string | null} [freezeCtx.currentTreeHash]
 * @param {Record<string, { state?: string, at?: { hash?: string } }> | undefined} [freezeCtx.freezeGates]
 * @returns {{ stage: string, gate: string, state: 'passed'|'failing'|'acknowledged', checks: Array<ReturnType<typeof makeCheck>> }}
 */
export function foldState(stage, gate, checks, freezeCtx = {}) {
  const anyFailing = checks.some((c) => !c.ok);
  if (!anyFailing) return { stage, gate, state: 'passed', checks };
  if (WARN_WITH_ACK.has(stage)) {
    const gates = freezeCtx.freezeGates ?? {};
    const record = gates[gate];
    const ackedAtHash = record?.state === 'acknowledged'
      && typeof record?.at?.hash === 'string'
      && record.at.hash === freezeCtx.currentTreeHash;
    if (ackedAtHash) return { stage, gate, state: 'acknowledged', checks };
  }
  return { stage, gate, state: 'failing', checks };
}

/**
 * `notApplicable` envelope helper.
 * @param {string} stage
 * @param {string} gate
 * @param {string} reason
 */
function notApplicable(stage, gate, reason) {
  return {
    stage, gate, state: 'notApplicable', checks: [
      makeCheck(`stage:${stage}:scope`, 'delta', 0, []),
    ], reason,
  };
}

/**
 * The set of ids in scope, as a Set for O(1) hit checks.
 * @param {Iterable<string> | undefined} scope
 * @returns {Set<string>}
 */
function asSet(scope) {
  return scope instanceof Set ? scope : new Set(scope ?? []);
}

/**
 * ADR-4138 (DEFINE step 3 rulings R2, R5, R7 2026-10-05): run every
 * tree-wide check for a stage and either return a `failing` envelope
 * carrying only the tree-wide findings (plus the scope placeholder) or
 * null when every tree-wide check passed, letting the stage proceed to
 * its own scope early-return or full checks list.
 *
 * The helper governs the three checks the rulings name as tree-wide:
 * `shapes:draftSettled` (R2), `shapes:entityJoin` (R5) and
 * `skeleton:standardsCited` (R7). Delta-only checks (templateMarkers,
 * pathsResolve, closedSets, ownerRefResolves) are untouched: they stay
 * on the stage's own full-checks path.
 *
 * @param {string} stage
 * @param {string} gate
 * @param {Array<{name: string, check: object}>} treeWideChecks
 * @param {string} notApplicableReason - the message the notApplicable
 *   envelope would carry; used only to label a failing envelope's
 *   placeholder when the scope is empty.
 * @param {object} freezeCtx
 * @returns {{ stage: string, gate: string, state: 'failing', checks: object[], reason: string } | null}
 */
function treeWideFailureEnvelope(stage, gate, treeWideChecks, notApplicableReason, freezeCtx) {
  const anyFailing = treeWideChecks.some(({ check }) => !check.ok);
  if (!anyFailing) return null;
  const checks = [makeCheck(`stage:${stage}:scope`, 'delta', 0, [])];
  for (const { check } of treeWideChecks) checks.push(check);
  const envelope = { stage, gate, state: /** @type {const} */ ('failing'), checks, reason: notApplicableReason };
  if (WARN_WITH_ACK.has(stage)) {
    const gates = freezeCtx.freezeGates ?? {};
    const record = gates[gate];
    const ackedAtHash = record?.state === 'acknowledged'
      && typeof record?.at?.hash === 'string'
      && record.at.hash === freezeCtx.currentTreeHash;
    if (ackedAtHash) return { ...envelope, state: /** @type {const} */ ('acknowledged') };
  }
  return envelope;
}

// ---------------------------------------------------------------------------
// D1 -- Brief intake and ledger (blocking in 0.29.0).
// ---------------------------------------------------------------------------

/**
 * @typedef {object} StageContext
 * @property {import('#core/store/walker.js').TreeModel} tree
 * @property {import('./delta.js').LedgerBundle | undefined} ledgers
 * @property {import('./delta.js').DeltaResult | undefined} delta
 * @property {import('./delta.js').FreezeRecord | null | undefined} freeze
 * @property {Iterable<string> | undefined} scope
 * @property {Array<unknown> | undefined} validateErrors  tree-wide walker + validate errors
 * @property {number | undefined} probeOpenCount          for D6 (probe ledger open entries)
 * @property {import('./coverage.js').CoverageResult | undefined} coverageTree  optional, unused by gates in 0.29.0
 * @property {string | null | undefined} profileText     rcf/.identity/profile.md contents (null when absent)
 * @property {{ skipReviewFor?: string } | undefined} profile  parsed profile switches (light shape)
 * @property {string | null | undefined} currentTreeHash  for warn-with-ack acknowledgement match
 * @property {Array<{ state: string }> | undefined} priorStages  D8 reads earlier stage states from this
 * @property {Set<string> | undefined} resolvedPaths  ADR-4131 (0.30.0 PR 5): set of repo-relative paths the CLI
 *   already resolved on disk; `shapes:pathsResolve` reads this to decide
 *   whether a `path:` token on an interface description resolves. Empty or
 *   undefined means no path is known-resolved, so every candidate token
 *   fails unless the interface description carries `authoredAt: D3`.
 */

/**
 * D1 -- Brief intake and ledger.
 *
 * @param {StageContext} ctx
 */
export function checkD1Brief(ctx) {
  const gate = STAGE_GATES.D1;
  const checks = [];
  const brief = /** @type {any} */ (ctx.ledgers?.brief);
  const statements = Array.isArray(brief?.statements) ? brief.statements : [];
  const decisions = /** @type {any} */ (ctx.ledgers?.decisions);
  const decisionEntries = Array.isArray(decisions?.decisions) ? decisions.decisions : [];

  // Check 1: at least one statement since the freeze (proposal §3.2 D1
  // "at least one statement since the freeze"). briefSince is the
  // delta's own high-water-mark projection; on an unfrozen tree the
  // rule is "the brief itself" so every statement counts.
  const highWater = Number.isFinite(ctx.freeze?.briefStatements) ? Number(ctx.freeze?.briefStatements) : 0;
  const since = statements.filter((s) => Number(s?.id) > highWater);
  checks.push(makeCheck(
    'brief:sinceFreeze',
    'delta',
    Math.max(since.length, 1),
    since.length === 0 && (ctx.freeze ? true : statements.length === 0)
      ? [{ id: 'brief-ledger', why: ctx.freeze
        ? 'no new brief statement since the freeze'
        : 'brief ledger holds no statements' }]
      : [],
  ));

  // Check 2: every statement kinded from the closed set.
  const badKind = [];
  for (const s of statements) {
    if (!s || typeof s.kind !== 'string' || !BRIEF_KINDS.includes(/** @type {any} */ (s.kind))) {
      badKind.push({ id: `brief:${s?.id ?? '?'}`, why: `unknown kind ${s?.kind ?? '(missing)'}` });
    }
  }
  checks.push(makeCheck('brief:kinds', 'tree', statements.length, badKind));

  // Check 3: every openQuestion resolved or promoted to a decision.
  const openQuestions = statements.filter((s) => s?.kind === 'openQuestion' && s?.status !== 'resolved');
  // A promoted openQuestion is one whose text is quoted or referenced in
  // a decisions-ledger entry's question field; a cheap presence check.
  const promoted = new Set();
  for (const q of openQuestions) {
    const text = typeof q?.text === 'string' ? q.text.trim() : '';
    if (!text) continue;
    if (decisionEntries.some((d) => typeof d?.question === 'string' && d.question.includes(text))) {
      promoted.add(q.id);
    }
  }
  const unresolvedOpen = openQuestions.filter((q) => !promoted.has(q.id));
  checks.push(makeCheck(
    'brief:openQuestions',
    'tree',
    openQuestions.length,
    unresolvedOpen.map((q) => ({ id: `brief:${q.id}`, why: 'openQuestion still open (not resolved and not promoted to a decision)' })),
  ));

  // Check 4: profile.md carries surface + register markers (light
  // presence check; the fuller elicitation prompt lives in slice 6).
  const surfaceMarkers = ['viewer', 'runningApp', 'prDiff'];
  const registerMarkers = ['productOwner', 'engineer', 'unstated'];
  const profileText = ctx.profileText ?? '';
  const surfaceHit = surfaceMarkers.some((m) => profileText.includes(m));
  const registerHit = registerMarkers.some((m) => profileText.includes(m));
  const profileFail = [];
  if (!surfaceHit) profileFail.push({ id: 'profile:surface', why: 'profile.md is missing a review-surface marker (viewer | runningApp | prDiff)' });
  if (!registerHit) profileFail.push({ id: 'profile:register', why: 'profile.md is missing a register marker (productOwner | engineer | unstated)' });
  checks.push(makeCheck('brief:profile', 'tree', 2, profileFail));

  return foldState('D1', gate, checks, {
    currentTreeHash: ctx.currentTreeHash ?? null,
    freezeGates: /** @type {any} */ (ctx.freeze?.gates),
  });
}

// ---------------------------------------------------------------------------
// D2 -- Requirements and architecture skeleton (blocking in 0.29.0).
// ---------------------------------------------------------------------------

/** Kinds whose resolution D2 checks: capability / constraint / entity / actor / externalSystem / surface. */
const D2_RESOLVING_KINDS = new Set(['capability', 'constraint', 'entity', 'actor', 'externalSystem', 'surface']);

/**
 * Compute the `skeleton:standardsCited` check (engineer, tree-wide).
 * Pure. Every standards pack registered through `rcf define standards`
 * (manifest.standards[].slug) is cited in a REQ `rationale` or an ADR,
 * or satisfied by a concern-ledger entry keyed `standards:<pack>` whose
 * disposition is `applied` or `waived`. Ruling R8 2026-10-05: both
 * `applied` and `waived` satisfy the check (an `applied` entry means the
 * pack was adopted, which is at least as strong as a citation). Ruling
 * R7 2026-10-05: the check runs tree-wide regardless of the D2 scope
 * early-return, through the shared ADR-4138 helper.
 *
 * @param {StageContext} ctx
 * @returns {ReturnType<typeof makeCheck>}
 */
function computeStandardsCitedCheck(ctx) {
  const tree = ctx.tree;
  const standardsList = Array.isArray(tree.manifest?.standards)
    ? /** @type {any[]} */ (tree.manifest.standards)
    : [];
  /** @type {Array<{ id: string, why: string }>} */
  const standardsFail = [];
  if (standardsList.length > 0) {
    const reqRationales = (tree.requirements ?? [])
      .map((r) => (typeof r?.rationale === 'string' ? r.rationale : ''))
      .join('\n');
    const adrDocs = (tree.adrs ?? []).map((a) => {
      try { return JSON.stringify(a); } catch { return ''; }
    }).join('\n');
    const concernsBody = /** @type {any} */ (ctx.ledgers?.concerns);
    const concernList = Array.isArray(concernsBody?.concerns) ? concernsBody.concerns : [];
    const satisfierSlugs = new Set();
    for (const entry of concernList) {
      if (!entry || typeof entry.concern !== 'string') continue;
      const disposition = typeof entry.disposition === 'string' ? entry.disposition : null;
      // Ruling R8 2026-10-05: both applied and waived satisfy standardsCited.
      if (disposition !== 'applied' && disposition !== 'waived') continue;
      const m = entry.concern.match(/^standards:(.+)$/);
      if (m) satisfierSlugs.add(m[1]);
    }
    for (const pack of standardsList) {
      const slug = typeof pack?.slug === 'string' ? pack.slug : null;
      if (!slug) continue;
      if (satisfierSlugs.has(slug)) continue;
      if (reqRationales.includes(slug)) continue;
      if (adrDocs.includes(slug)) continue;
      standardsFail.push({ id: `standards:${slug}`, why: 'uncited, unapplied and unwaived' });
    }
  }
  return makeCheck('skeleton:standardsCited', 'tree', Math.max(standardsList.length, 1), standardsFail);
}

/**
 * D2 -- Requirements and architecture skeleton.
 *
 * @param {StageContext} ctx
 */
export function checkD2Skeleton(ctx) {
  const gate = STAGE_GATES.D2;
  const scope = asSet(ctx.scope);
  const tree = ctx.tree;
  const brief = /** @type {any} */ (ctx.ledgers?.brief);
  const statements = Array.isArray(brief?.statements) ? brief.statements : [];
  const highWater = Number.isFinite(ctx.freeze?.briefStatements) ? Number(ctx.freeze?.briefStatements) : 0;
  const stmtsInScope = statements.filter((s) => Number(s?.id) > highWater);
  const resolvingStmts = stmtsInScope.filter((s) => D2_RESOLVING_KINDS.has(String(s?.kind)));
  const reqInScope = (tree.requirements ?? []).filter((r) => scope.has(r.reqId));
  const prdInScope = tree.prd && scope.has(tree.prd.prdId ?? '');
  const tadInScope = tree.tad && scope.has(tree.tad.tadId ?? '');

  // Ruling R7 2026-10-05 (ADR-4138): skeleton:standardsCited is a
  // tree-wide check; evaluate it before any scope early-return so a
  // narrowed D2 scope that excludes every REQ/PRD/TAD/brief statement
  // still reports an uncited pack.
  const standardsCheck = computeStandardsCitedCheck(ctx);

  if (resolvingStmts.length === 0 && reqInScope.length === 0 && !prdInScope && !tadInScope) {
    const treeWideFailure = treeWideFailureEnvelope(
      'D2', gate,
      [{ name: 'skeleton:standardsCited', check: standardsCheck }],
      'no resolving brief statements and no REQ / PRD / TAD in scope',
      { currentTreeHash: ctx.currentTreeHash ?? null, freezeGates: /** @type {any} */ (ctx.freeze?.gates) },
    );
    if (treeWideFailure) return treeWideFailure;
    return notApplicable('D2', gate, 'no resolving brief statements and no REQ / PRD / TAD in scope');
  }

  const checks = [];

  // Check 1 (0.30.0): every capability/constraint/entity/... statement
  // resolves to a closed-grammar pointer in `resolvedBy`:
  //   REQ-nnn | TAD.entity:<name> | PRD.user:<name>
  //   | TAD.system:<name> | TAC-nnnn | omitted:<reason>
  // The 0.29.0 REQ-title fallback is dropped (decision 3; a title hit
  // becomes a suggestion the PR 2 computeQuestions surface returns).
  // A statement with no `resolvedBy` fails; a statement with a
  // `resolvedBy` outside the grammar fails with 'pointer does not
  // resolve'.
  /** @type {Array<{ id: string, why: string }>} */
  const unresolvedFailing = [];
  for (const s of resolvingStmts) {
    const rb = s?.resolvedBy;
    if (typeof rb !== 'string' || rb.length === 0) {
      unresolvedFailing.push({ id: `brief:${s.id}`, why: `${s.kind} statement has no resolvedBy` });
      continue;
    }
    const parsed = parseResolvedBy(rb, tree);
    if (!parsed.ok) {
      unresolvedFailing.push({ id: `brief:${s.id}`, why: 'pointer does not resolve' });
    }
  }
  checks.push(makeCheck(
    'skeleton:resolvedBy',
    'delta',
    resolvingStmts.length,
    unresolvedFailing,
  ));

  // Checks 2a / 2b: the former `skeleton:reqFields` split into two
  // homogeneous checks (ADR-4126, proposal section 1.3). Each
  // evaluates every REQ in scope independently so a REQ with a TODO
  // description still has its shapes reported, and vice versa.
  const reqIntentFail = [];
  const reqShapeFail = [];
  for (const req of reqInScope) {
    // reqIntent (productOwner): description without a TODO + domain
    // (what the requirement means and where it sits).
    if (typeof req.description !== 'string' || req.description.length === 0 || TODO_RE.test(req.description)) {
      reqIntentFail.push({ id: req.reqId, why: 'description missing or contains TODO placeholder' });
    } else if (typeof req.domain !== 'string' || req.domain.length === 0) {
      reqIntentFail.push({ id: req.reqId, why: 'domain missing' });
    }
    // reqShape (engineer): shapeClassification.shapes classification.
    if (!req.shapeClassification || !Array.isArray(req.shapeClassification.shapes)) {
      reqShapeFail.push({ id: req.reqId, why: 'shapeClassification.shapes missing' });
    }
  }
  checks.push(makeCheck('skeleton:reqIntent', 'delta', reqInScope.length, reqIntentFail));
  checks.push(makeCheck('skeleton:reqShape', 'delta', reqInScope.length, reqShapeFail));

  // Check 3: TAD.dataArchitecture.dataStores + coreEntities present when any
  // REQ exists tree-wide.
  const persistenceReq = (tree.requirements ?? []).some((r) => Array.isArray(r?.shapeClassification?.shapes) && r.shapeClassification.shapes.includes('persistence'));
  const tadFail = [];
  if (persistenceReq) {
    const tad = tree.tad ?? {};
    const dataArch = tad?.dataArchitecture ?? {};
    const dataStores = Array.isArray(dataArch.dataStores) ? dataArch.dataStores : [];
    const coreEntities = Array.isArray(dataArch.coreEntities) ? dataArch.coreEntities : [];
    if (dataStores.length === 0) tadFail.push({ id: 'TAD.dataArchitecture.dataStores', why: 'TAD.dataArchitecture.dataStores empty while persistence REQ exists' });
    if (coreEntities.length === 0) tadFail.push({ id: 'TAD.dataArchitecture.coreEntities', why: 'TAD.dataArchitecture.coreEntities empty while persistence REQ exists' });
  }
  checks.push(makeCheck('skeleton:tadPersistence', 'tree', persistenceReq ? 2 : 0, tadFail));

  // Check 4: exactly one deploy or deferral ADR tree-wide. Cheap
  // detection by title prefix (proposal §11 assumption).
  const deployAdrs = (tree.adrs ?? []).filter((a) => {
    const t = typeof a?.title === 'string' ? a.title : '';
    return t.startsWith('Deploy target:') || t.startsWith('Deploy deferral:');
  });
  const deployFail = [];
  if (deployAdrs.length === 0) deployFail.push({ id: 'ADR:deploy', why: 'no Deploy target or Deploy deferral ADR found (title-prefix scan)' });
  else if (deployAdrs.length > 1) deployFail.push({ id: 'ADR:deploy', why: `${deployAdrs.length} Deploy ADRs found; expected exactly one` });
  checks.push(makeCheck('skeleton:deployAdr', 'tree', 1, deployFail));

  // Check 5 (0.30.0 PR 6, ruling R7+R8 2026-10-05): skeleton:standardsCited
  // (engineer, over tree). Computed by `computeStandardsCitedCheck` so the
  // same check runs ahead of the scope early-return (R7) and so the R8
  // behaviour (applied | waived | cited all satisfy) lives in one place.
  checks.push(standardsCheck);

  return foldState('D2', gate, checks, {
    currentTreeHash: ctx.currentTreeHash ?? null,
    freezeGates: /** @type {any} */ (ctx.freeze?.gates),
  });
}

// ---------------------------------------------------------------------------
// D3 -- Interface contracts and shapes (warn-with-ack in 0.29.0).
// ---------------------------------------------------------------------------

/** Set form of INTERFACE_KINDS for O(1) checks. */
const INTERFACE_KINDS_SET = new Set(INTERFACE_KINDS);

/**
 * Compute the `shapes:draftSettled` check (engineer, tree-wide). Pure.
 * Ruling R2 2026-10-05 (ADR-4138): a `[draft]` marker on any TAC
 * purpose, any interface description or any coreEntities[].description
 * fails the check regardless of the D3 scope's own early-return. The
 * three id forms are `<tacId>`, `<tacId>:<name>` and `TAD.entity:<name>`.
 *
 * @param {StageContext} ctx
 * @returns {ReturnType<typeof makeCheck>}
 */
function computeDraftSettledCheck(ctx) {
  const tree = ctx.tree;
  const tacs = tree.tacs ?? [];
  const coreEntities = Array.isArray(tree.tad?.dataArchitecture?.coreEntities)
    ? /** @type {any[]} */ (tree.tad.dataArchitecture.coreEntities)
    : [];
  /** @type {Array<{ id: string, why: string }>} */
  const draftFindings = [];
  let totalInterfaces = 0;
  for (const tac of tacs) {
    if (parseTacPurposeDraft(tac)) {
      draftFindings.push({ id: tac.tacId, why: 'draft TAC purpose pre-populated at L1, not yet settled' });
    }
    for (const iface of tac.interfaces ?? []) {
      totalInterfaces += 1;
      if (parseInterfaceDraft(iface)) {
        draftFindings.push({ id: `${tac.tacId}:${iface?.name ?? '(unnamed)'}`, why: 'draft interface pre-populated at L1, not yet settled' });
      }
    }
  }
  for (const entity of coreEntities) {
    if (parseCoreEntityDraft(entity)) {
      draftFindings.push({ id: `TAD.entity:${entity?.name ?? '(unnamed)'}`, why: 'draft core entity pre-populated at L1, not yet settled' });
    }
  }
  const totalDraftHomes = tacs.length + totalInterfaces + coreEntities.length;
  return makeCheck('shapes:draftSettled', 'tree', Math.max(totalDraftHomes, 1), draftFindings);
}

/**
 * Compute the `shapes:entityJoin` check (engineer, tree-wide). Pure.
 * Ruling R5 2026-10-05 (ADR-4138): every entry in
 * `TAD.dataArchitecture.coreEntities` must be named by exactly one
 * `recordShape` across the whole tree (matching on the recordShape's
 * `name` field or an `entity:` line in its description, with a
 * `[draft]` prefix stripped before the scan). The check runs ahead of
 * the D3 scope early-return so a narrowed scope that excludes every
 * recordShape still reports an unjoined entity.
 *
 * @param {StageContext} ctx
 * @returns {ReturnType<typeof makeCheck>}
 */
function computeEntityJoinCheck(ctx) {
  const tree = ctx.tree;
  const coreEntities = Array.isArray(tree.tad?.dataArchitecture?.coreEntities)
    ? /** @type {any[]} */ (tree.tad.dataArchitecture.coreEntities)
    : [];
  /** @type {Array<{ id: string, why: string }>} */
  const joinFindings = [];
  const recordShapesByEntity = new Map();
  for (const tac of tree.tacs ?? []) {
    for (const iface of tac.interfaces ?? []) {
      if (iface?.kind !== 'recordShape') continue;
      const ownerLabel = `${tac.tacId}:${iface?.name ?? '(unnamed)'}`;
      const names = new Set();
      if (typeof iface?.name === 'string') names.add(iface.name);
      const desc = typeof iface?.description === 'string' ? stripDraftPrefix(iface.description) : '';
      const entityRe = /(^|\n)\s*(?:[-*]\s*)?entity\s*[:=]\s*["'`]?([A-Za-z_][A-Za-z0-9_]*)/g;
      let em;
      while ((em = entityRe.exec(desc)) !== null) {
        if (em[2]) names.add(em[2]);
      }
      for (const name of names) {
        const owners = recordShapesByEntity.get(name) ?? [];
        owners.push(ownerLabel);
        recordShapesByEntity.set(name, owners);
      }
    }
  }
  for (const entity of coreEntities) {
    const name = typeof entity?.name === 'string' ? entity.name : null;
    if (!name) continue;
    const owners = recordShapesByEntity.get(name) ?? [];
    if (owners.length === 0) {
      joinFindings.push({ id: `TAD.entity:${name}`, why: 'no record shape' });
    } else if (owners.length > 1) {
      joinFindings.push({ id: `TAD.entity:${name}`, why: `${owners.length} record shapes` });
    }
  }
  return makeCheck('shapes:entityJoin', 'tree', coreEntities.length, joinFindings);
}

/**
 * D3 -- Interface contracts and shapes. 0.29.0 runs the cheap
 * presence, closed-vocabulary and draft-marker checks
 * (`shapes:draftSettled` per ADR-4126 scans the `[draft]` prefix).
 * REQ-188 (0.30.0): the draft marker extends to `TAC.purpose` and
 * `TAD.dataArchitecture.coreEntities[].description`; `shapes:draftSettled`
 * enumerates all three homes with ids `<tacId>:<name>`, `<tacId>`
 * and `TAD.entity:<name>` respectively. `tacHasInterface` and
 * `kindVocabulary` apply to drafts unchanged.
 *
 * SEAM 0.30: template markers per kind (recordShape.fields:, httpRoute
 * method/path/request/response/errors, fixture.instances:); entity-name
 * join across TAD.dataArchitecture.coreEntities and TAC.interfaces[];
 * ownerRef and `authoredAt` path resolution. Those add checks to this
 * stage; the fold shape stays the same.
 *
 * @param {StageContext} ctx
 */
export function checkD3Shapes(ctx) {
  const gate = STAGE_GATES.D3;
  const scope = asSet(ctx.scope);
  const tree = ctx.tree;
  const tacsInScope = (tree.tacs ?? []).filter((t) => scope.has(t.tacId));
  const shapedReqInScope = (tree.requirements ?? []).filter((r) => {
    if (!scope.has(r.reqId)) return false;
    const shapes = r.shapeClassification?.shapes ?? [];
    return shapes.includes('httpApi') || shapes.includes('persistence') || shapes.includes('auth');
  });

  // Core entities on TAD.dataArchitecture come from the whole tree,
  // not the scope: an entity's draft marker is a tree-wide draft home
  // (the engineer owns every entity in one place) and reporting it
  // under D3 does not depend on which TAC a change touched.
  const coreEntities = Array.isArray(tree.tad?.dataArchitecture?.coreEntities)
    ? /** @type {any[]} */ (tree.tad.dataArchitecture.coreEntities)
    : [];

  // Ruling R2+R5 2026-10-05 (ADR-4138): shapes:draftSettled and
  // shapes:entityJoin are tree-wide checks; evaluate them before any
  // scope early-return so a narrowed D3 scope that excludes every TAC
  // and shaped REQ still reports a [draft] anywhere in the tree and an
  // unjoined core entity.
  const draftCheck = computeDraftSettledCheck(ctx);
  const entityJoinCheck = computeEntityJoinCheck(ctx);

  if (tacsInScope.length === 0 && shapedReqInScope.length === 0) {
    const treeWideFailure = treeWideFailureEnvelope(
      'D3', gate,
      [
        { name: 'shapes:draftSettled', check: draftCheck },
        { name: 'shapes:entityJoin', check: entityJoinCheck },
      ],
      'no TAC, no shaped REQ (httpApi/persistence/auth) and no [draft] core entity in scope',
      { currentTreeHash: ctx.currentTreeHash ?? null, freezeGates: /** @type {any} */ (ctx.freeze?.gates) },
    );
    if (treeWideFailure) return treeWideFailure;
    return notApplicable('D3', gate, 'no TAC, no shaped REQ (httpApi/persistence/auth) and no [draft] core entity in scope');
  }

  const checks = [];

  // Check 1: every TAC in scope has at least one interface.
  const noIfaceTacs = tacsInScope.filter((t) => !Array.isArray(t.interfaces) || t.interfaces.length === 0);
  checks.push(makeCheck(
    'shapes:tacHasInterface',
    'delta',
    tacsInScope.length,
    noIfaceTacs.map((t) => ({ id: t.tacId, why: 'no interfaces authored' })),
  ));

  // Check 2: every interface kind is in the closed vocabulary (over
  // delta; drafts included).
  let totalInterfaces = 0;
  const badKinds = [];
  for (const tac of tacsInScope) {
    for (const iface of tac.interfaces ?? []) {
      totalInterfaces += 1;
      const kind = iface?.kind;
      if (typeof kind !== 'string' || !INTERFACE_KINDS_SET.has(kind)) {
        badKinds.push({ id: `${tac.tacId}:${iface?.name ?? '(unnamed)'}`, why: `unknown interface kind ${JSON.stringify(kind)}` });
      }
    }
  }
  checks.push(makeCheck('shapes:kindVocabulary', 'delta', totalInterfaces, badKinds));

  // Check 3: shapes:draftSettled. Ruling R2 2026-10-05: tree-wide (a
  // [draft] anywhere is unfinished work). Computed by
  // computeDraftSettledCheck so the same check is reused ahead of the
  // scope early-return.
  checks.push(draftCheck);

  // ADR-4131 (0.30.0 PR 5): three D3 bite checks follow.
  // Check 4: shapes:templateMarkers (engineer, over delta). For every
  // interface on an in-scope TAC, parseInterfaceTemplate reports which
  // per-kind markers are missing from the description; a draft marker
  // is stripped before the scan so a [draft] recordShape without
  // `fields:` fails exactly as a settled one. An interface whose kind
  // is outside INTERFACE_KINDS is left to shapes:kindVocabulary (the
  // marker map returns `{missing: []}` for an unknown kind so this
  // check does not double-report the vocabulary miss).
  /** @type {Array<{ id: string, why: string }>} */
  const templateFindings = [];
  for (const tac of tacsInScope) {
    for (const iface of tac.interfaces ?? []) {
      const result = parseInterfaceTemplate(iface);
      if (!result.kind) continue;
      for (const marker of result.missing) {
        templateFindings.push({
          id: `${tac.tacId}:${iface?.name ?? '(unnamed)'}`,
          why: `missing marker ${marker}`,
        });
      }
    }
  }
  checks.push(makeCheck('shapes:templateMarkers', 'delta', totalInterfaces, templateFindings));

  // Check 5: shapes:entityJoin. Ruling R5 2026-10-05: tree-wide by
  // definition. Computed by computeEntityJoinCheck so the same check
  // is reused ahead of the scope early-return (ADR-4138).
  checks.push(entityJoinCheck);

  // Check 6: shapes:pathsResolve (engineer, over delta). Any path:
  // token on an in-scope interface description must either resolve
  // against `resolvedPaths` (the CLI's on-disk pass) or the
  // description must carry an `authoredAt: D3` marker (the engineer
  // owns the path even when the file is yet to land). The marker is
  // a token in the description text (`authoredAt: D3` or
  // `authoredAt = D3`), not a separate schema field; the TAC schema
  // keeps interfaces to { name, kind, description }. Over delta,
  // one failing entry per unresolved (tacId:name, path) pair.
  const resolvedPaths = ctx.resolvedPaths instanceof Set ? ctx.resolvedPaths : new Set();
  /** @type {Array<{ id: string, why: string }>} */
  const pathFindings = [];
  let totalPathChecks = 0;
  for (const tac of tacsInScope) {
    for (const iface of tac.interfaces ?? []) {
      const desc = typeof iface?.description === 'string' ? iface.description : '';
      const tokens = extractInterfacePathTokens(desc);
      if (tokens.length === 0) continue;
      const authoredAtD3 = /\bauthoredAt\s*[:=]\s*["'`]?D3\b/.test(stripDraftPrefix(desc));
      for (const token of tokens) {
        totalPathChecks += 1;
        if (authoredAtD3) continue;
        if (resolvedPaths.has(token)) continue;
        pathFindings.push({
          id: `${tac.tacId}:${iface?.name ?? '(unnamed)'}`,
          why: `path does not resolve: ${token}`,
        });
      }
    }
  }
  // Keep total >= 1 so the chip prints a sensible ratio when no
  // interface in scope names a path.
  checks.push(makeCheck('shapes:pathsResolve', 'delta', Math.max(totalPathChecks, 1), pathFindings));

  return foldState('D3', gate, checks, {
    currentTreeHash: ctx.currentTreeHash ?? null,
    freezeGates: /** @type {any} */ (ctx.freeze?.gates),
  });
}

// ---------------------------------------------------------------------------
// D4 -- Stories and criteria (blocking floors in 0.29.0).
// ---------------------------------------------------------------------------

/**
 * D4 -- Stories and criteria floors. 0.29.0 enforces the four floors
 * proposal §3.2 blocks on: every REQ has a US, every US has a testable
 * AC, a failure AC (or opt-out per class), a must-not AC (or opt-out),
 * tacIds non-empty and resolving, no scaffold TODO placeholder.
 *
 * SEAM 0.30: closed-set scan across enumerations; ownerRef resolution
 * to TAC.interfaces[<name>]; template-marker parse. Warn-only notices
 * in 0.29.0 (see D3).
 *
 * @param {StageContext} ctx
 */
export function checkD4Stories(ctx) {
  const gate = STAGE_GATES.D4;
  const scope = asSet(ctx.scope);
  const tree = ctx.tree;
  const manifest = /** @type {any} */ (tree.manifest);
  const reqInScope = (tree.requirements ?? []).filter((r) => scope.has(r.reqId));
  const usInScope = (tree.userStories ?? []).filter((us) => scope.has(us.usId));

  if (reqInScope.length === 0 && usInScope.length === 0) {
    return notApplicable('D4', gate, 'no REQ and no US in scope');
  }

  const checks = [];

  // Check 1: every REQ in scope has at least one US.
  const reqWithoutUs = [];
  for (const req of reqInScope) {
    const hasUs = (tree.userStories ?? []).some((us) => us.reqId === req.reqId);
    if (!hasUs) reqWithoutUs.push({ id: req.reqId, why: 'no owning user story' });
  }
  checks.push(makeCheck('stories:reqHasUs', 'delta', reqInScope.length, reqWithoutUs));

  // Check 2: every US in scope carries the class floors + tacIds + testable AC + no TODO.
  const usFail = [];
  for (const us of usInScope) {
    const acs = Array.isArray(us.acceptanceCriteria) ? us.acceptanceCriteria : [];
    // testable
    const hasTestable = acs.some((ac) => ac?.testable !== false && typeof ac?.description === 'string' && ac.description.length > 0);
    if (!hasTestable) usFail.push({ id: us.usId, why: 'no testable acceptance criterion' });
    // failure class
    const hasFailure = acs.some((ac) => parseAcClass(ac) === 'failure');
    const failureOpted = isOptedOut(manifest, us.reqId, 'defineD4:failure');
    if (!hasFailure && !failureOpted) {
      usFail.push({ id: us.usId, why: 'no [failure] class AC and no defineD4:failure opt-out on this REQ' });
    }
    // must-not class
    const hasMustNot = acs.some((ac) => parseAcClass(ac) === 'must-not');
    const mustNotOpted = isOptedOut(manifest, us.reqId, 'defineD4:mustNot');
    if (!hasMustNot && !mustNotOpted) {
      usFail.push({ id: us.usId, why: 'no [must-not] class AC and no defineD4:mustNot opt-out on this REQ' });
    }
    // tacIds non-empty and resolving
    const tacIds = Array.isArray(us.tacIds) ? us.tacIds : [];
    if (tacIds.length === 0) {
      usFail.push({ id: us.usId, why: 'tacIds is empty' });
    } else {
      const unresolved = tacIds.filter((id) => tree.kindById?.get(id) !== 'tac');
      if (unresolved.length > 0) {
        usFail.push({ id: us.usId, why: `tacIds names non-TAC ids: ${unresolved.join(', ')}` });
      }
    }
    // no TODO placeholder in any AC description
    const todoAc = acs.find((ac) => typeof ac?.description === 'string' && TODO_RE.test(ac.description));
    if (todoAc) usFail.push({ id: us.usId, why: `scaffold TODO placeholder in ${todoAc.id ?? '(ac)'}` });
  }
  checks.push(makeCheck('stories:usFloors', 'delta', usInScope.length, usFail));

  // Check 3 (0.30.0 PR 6): stories:closedSets (engineer, over delta).
  // Every AC on a US in scope whose description contains an enumeration
  // cue (one of | any of | the following | types of | status is)
  // without an inline bracketed list of two or more tokens AND without
  // an ownerRef fails. The quoted-cue guard strips `"..."` substrings
  // before the cue scan so prose that quotes a cue does not fire the
  // check.
  /** @type {Array<{ id: string, why: string }>} */
  const closedSetFindings = [];
  let totalClosedSetAcs = 0;
  for (const us of usInScope) {
    const acs = Array.isArray(us.acceptanceCriteria) ? us.acceptanceCriteria : [];
    for (const ac of acs) {
      if (typeof ac?.description !== 'string' || ac.description.length === 0) continue;
      totalClosedSetAcs += 1;
      if (failsClosedSets(ac)) {
        closedSetFindings.push({
          id: ac.id ?? us.usId,
          why: 'enumeration cue without a closed set',
        });
      }
    }
  }
  checks.push(makeCheck('stories:closedSets', 'delta', totalClosedSetAcs, closedSetFindings));

  // Check 4 (0.30.0 PR 6): stories:ownerRefResolves (engineer, over
  // delta plus tree for ownerRef targets). Every AC on a US in scope
  // whose ownerRef is set must point to an interface by name on the
  // named TAC. Ids `<acId>:<field>`; why 'ownerRef does not resolve'.
  /** @type {Array<{ id: string, why: string }>} */
  const ownerRefFindings = [];
  let totalOwnerRefAcs = 0;
  // R11 (spec section 17, 2026-10-03): the ownerRef field grammar
  // widens beyond `interfaces[<name>]` to every bracket-grammar path
  // that names an existing field on the owning TAC or ADR. The owner
  // may now be a TAC (via tacId) or an ADR (via adrId); the resolver
  // handles the bracket forms (`interfaces[<name>]`,
  // `responsibilities[<n>]`, `dependencies[<name>]`,
  // `alternativesConsidered[<n>]`) and bare schema fields (`purpose`,
  // `internalStructure`, `decision`, etc.). A path that does not
  // match any arm still fails. AC-17405-2 is unchanged in effect.
  for (const us of usInScope) {
    const acs = Array.isArray(us.acceptanceCriteria) ? us.acceptanceCriteria : [];
    for (const ac of acs) {
      if (!acHasOwnerRef(ac)) continue;
      totalOwnerRefAcs += 1;
      const ref = /** @type {any} */ (ac).ownerRef;
      let owner = null;
      if (typeof ref.tacId === 'string') {
        owner = (tree.tacs ?? []).find((t) => t?.tacId === ref.tacId) ?? null;
      } else if (typeof ref.adrId === 'string') {
        owner = (tree.adrs ?? []).find((a) => a?.adrId === ref.adrId) ?? null;
      }
      const resolves = !!(owner && resolveOwnerRefField(owner, ref.field));
      if (!resolves) {
        ownerRefFindings.push({
          id: `${ac.id ?? us.usId}:${ref.field ?? '(no field)'}`,
          why: 'ownerRef does not resolve',
        });
      }
    }
  }
  // Keep total >= 1 so the chip prints a sensible ratio when no AC in
  // scope carries an ownerRef.
  checks.push(makeCheck('stories:ownerRefResolves', 'delta', Math.max(totalOwnerRefAcs, 1), ownerRefFindings));

  return foldState('D4', gate, checks, {
    currentTreeHash: ctx.currentTreeHash ?? null,
    freezeGates: /** @type {any} */ (ctx.freeze?.gates),
  });
}

// ---------------------------------------------------------------------------
// D5 -- Cross-cutting weave (warn-with-ack in 0.29.0).
// ---------------------------------------------------------------------------

/**
 * D5 -- Cross-cutting weave. 0.29.0 runs cheap presence checks.
 *
 * SEAM 0.30: full concern catalogue with per-shape applicability;
 * per-(concern, REQ) pair enumeration; TAD securityArchitecture and
 * operationalConcerns structure checks beyond presence.
 *
 * @param {StageContext} ctx
 */
export function checkD5Crosscut(ctx) {
  const gate = STAGE_GATES.D5;
  const scope = asSet(ctx.scope);
  const tree = ctx.tree;
  const reqInScope = (tree.requirements ?? []).filter((r) => scope.has(r.reqId));

  if (reqInScope.length === 0) {
    return notApplicable('D5', gate, 'no REQ in scope');
  }

  const checks = [];

  // Check 1: TAD.securityArchitecture non-empty when any REQ carries shape 'auth' or 'httpApi'.
  const authApi = (tree.requirements ?? []).some((r) => {
    const s = r.shapeClassification?.shapes ?? [];
    return s.includes('auth') || s.includes('httpApi');
  });
  const tad = /** @type {any} */ (tree.tad ?? {});
  const secFail = [];
  if (authApi) {
    const sa = tad.securityArchitecture;
    if (!sa || (typeof sa === 'string' ? sa.length === 0 : Object.keys(sa).length === 0)) {
      secFail.push({ id: 'TAD.securityArchitecture', why: 'empty while auth or httpApi REQ exists' });
    }
  }
  checks.push(makeCheck('crosscut:securityArchitecture', 'tree', authApi ? 1 : 0, secFail));

  // Check 2: TAD.operationalConcerns non-empty when any AC description
  // carries the '[deployed]' marker (a cheap presence signal that
  // proposal §3.2 D5 lists as 'deployed-scope AC').
  const hasDeployedAc = (tree.userStories ?? []).some((us) => (us.acceptanceCriteria ?? []).some((ac) => typeof ac?.description === 'string' && ac.description.includes('[deployed]')));
  const opFail = [];
  if (hasDeployedAc) {
    const oc = tad.operationalConcerns;
    if (!oc || (typeof oc === 'string' ? oc.length === 0 : Object.keys(oc).length === 0)) {
      opFail.push({ id: 'TAD.operationalConcerns', why: 'empty while deployed-scope AC exists' });
    }
  }
  checks.push(makeCheck('crosscut:operationalConcerns', 'tree', hasDeployedAc ? 1 : 0, opFail));

  // Check 3: no open concern-ledger entry on a REQ in scope.
  const concerns = /** @type {any} */ (ctx.ledgers?.concerns);
  const concernEntries = Array.isArray(concerns?.concerns) ? concerns.concerns : [];
  const openInScope = concernEntries.filter((c) => c?.status === 'open' && scope.has(c?.reqId));
  checks.push(makeCheck(
    'crosscut:concernsResolved',
    'delta',
    concernEntries.filter((c) => scope.has(c?.reqId)).length,
    openInScope.map((c) => ({ id: `concern:${c.id}`, why: `open concern on ${c.reqId}: ${c.concern}` })),
  ));

  // Check 4 (0.30.0 PR 6): crosscut:catalogue (engineer, over tree).
  // For every REQ in scope, enumerate applicable (reqShape, concern)
  // pairs via src/define/concern-catalogue.js; each pair needs a
  // concern-ledger entry keyed <REQ>:<concern> with disposition
  // applied or waived (a waived entry carries a reason). Fail ids are
  // `<REQ>:<concern>`; the why names the missing concern. A waived
  // entry without a reason also fails. Keys shared with the baseline
  // catalogue where names coincide (today only `auth`).
  const entriesByKey = new Map();
  for (const entry of concernEntries) {
    if (!entry || typeof entry.reqId !== 'string' || typeof entry.concern !== 'string') continue;
    entriesByKey.set(`${entry.reqId}:${entry.concern}`, entry);
  }
  /** @type {Array<{ id: string, why: string }>} */
  const catalogueFindings = [];
  let totalCataloguePairs = 0;
  for (const req of reqInScope) {
    const shapes = Array.isArray(req?.shapeClassification?.shapes)
      ? req.shapeClassification.shapes.filter((s) => typeof s === 'string')
      : [];
    const applicable = applicableConcernsForShapes(shapes);
    for (const concern of applicable) {
      totalCataloguePairs += 1;
      const key = `${req.reqId}:${concern}`;
      const entry = entriesByKey.get(key);
      if (!entry) {
        catalogueFindings.push({ id: key, why: `missing concern-ledger entry for ${concern}` });
        continue;
      }
      const disposition = typeof entry.disposition === 'string' ? entry.disposition : null;
      if (disposition !== 'applied' && disposition !== 'waived') {
        catalogueFindings.push({ id: key, why: `concern-ledger entry disposition is ${disposition ?? '(unset)'}` });
        continue;
      }
      if (disposition === 'waived') {
        const reason = typeof entry.reason === 'string' ? entry.reason.trim() : '';
        if (reason.length === 0) {
          catalogueFindings.push({ id: key, why: 'waived without a reason' });
        }
      }
    }
  }
  // Keep total >= 1 so the chip prints a sensible ratio when no REQ in
  // scope has applicable concerns (every REQ carries shape 'other').
  checks.push(makeCheck('crosscut:catalogue', 'tree', Math.max(totalCataloguePairs, 1), catalogueFindings));

  return foldState('D5', gate, checks, {
    currentTreeHash: ctx.currentTreeHash ?? null,
    freezeGates: /** @type {any} */ (ctx.freeze?.gates),
  });
}

// ---------------------------------------------------------------------------
// D6 -- Consistency and satisfiability probe (warn-with-ack in 0.29.0).
// ---------------------------------------------------------------------------

/**
 * D6 -- Consistency and satisfiability probe. 0.29.0 ran the
 * validate-clean tree-wide check and the probe-ledger open count;
 * 0.30.0 PR 7 (ADR-4131 extended, spec section 4 row 'D6 scans and the
 * injectable probe runner') adds the four mechanical scans
 * consistency:contradictions, consistency:unsatisfiable,
 * consistency:duplicates and consistency:orphanInterfaces. The probe
 * runner lives on the readiness compute (TAC-4123); the gate reads the
 * merged probes.probes[] it ends up with.
 *
 * @param {StageContext} ctx
 */
export function checkD6Consistency(ctx) {
  const gate = STAGE_GATES.D6;
  const checks = [];

  const validateErrors = Array.isArray(ctx.validateErrors) ? ctx.validateErrors : [];
  checks.push(makeCheck(
    'consistency:validateClean',
    'tree',
    // "Expected zero" pattern: total stays at Math.max(N, 1) so the
    // reported ratio reads sensibly on a clean tree ("1/1") and on a
    // dirty one ("0/N"). Truncate the failing array for display but
    // fold `pass` from the untruncated count so beyond-20 failures do
    // not turn into false passes.
    Math.max(validateErrors.length, 1),
    validateErrors.slice(0, 20).map((e, i) => ({
      id: /** @type {any} */ (e)?.documentId ?? `validate:${i}`,
      why: /** @type {any} */ (e)?.message ?? 'validate error',
    })),
    validateErrors.length,
  ));

  const probeOpenCount = Number.isFinite(ctx.probeOpenCount) ? Number(ctx.probeOpenCount) : 0;
  const probes = /** @type {any} */ (ctx.ledgers?.probes);
  const probeEntries = Array.isArray(probes?.probes) ? probes.probes : [];
  const openProbes = probeEntries.filter((p) => p?.status === 'open');
  // Prefer caller-supplied probeOpenCount when set; fall back to bundle scan.
  const effectiveOpen = ctx.probeOpenCount !== undefined ? probeOpenCount : openProbes.length;
  const failing = [];
  if (effectiveOpen > 0) {
    const list = ctx.probeOpenCount !== undefined
      ? [{ id: 'probe-ledger', why: `${effectiveOpen} open probe finding(s)` }]
      : openProbes.slice(0, 20).map((p) => ({ id: `probe:${p.id}`, why: `open probe on ${p.reqId}: ${p.finding}` }));
    failing.push(...list);
  }
  // Fold `pass` from the untruncated open-probe count so a 25-open-
  // probes ledger reports 0/25, not 5/25. The failing array itself
  // stays truncated to 20 for display; the caller-supplied count path
  // uses a single representative entry regardless.
  checks.push(makeCheck('consistency:probeCount', 'tree', Math.max(effectiveOpen, 1), failing, effectiveOpen));

  // ADR-4131 extended (0.30.0 PR 7): the four D6 scans.
  const scope = asSet(ctx.scope);
  const tree = ctx.tree;
  const usInScope = (tree.userStories ?? []).filter((us) => scope.has(us.usId));

  // Scan 1: consistency:contradictions (engineer, over delta). Two ACs
  // on one story share a `when` clause and one of their `then` clauses
  // is a negation of the other. The quoted-cue guard strips
  // double-quoted substrings before the negation scan so prose that
  // quotes a negation inside a `then` does not fire the check.
  /** @type {Array<{ id: string, why: string }>} */
  const contradictionFindings = [];
  let totalStoriesScanned = 0;
  for (const us of usInScope) {
    const acs = Array.isArray(us.acceptanceCriteria) ? us.acceptanceCriteria : [];
    if (acs.length < 2) continue;
    totalStoriesScanned += 1;
    const parsed = acs
      .map((ac) => ({ ac, parts: parseWhenThen(ac?.description) }))
      .filter((p) => p.parts !== null);
    const reported = new Set();
    for (let i = 0; i < parsed.length; i += 1) {
      for (let j = i + 1; j < parsed.length; j += 1) {
        const a = parsed[i];
        const b = parsed[j];
        if (normaliseClause(a.parts.when) !== normaliseClause(b.parts.when)) continue;
        if (!thensNegateEachOther(a.parts.then, b.parts.then)) continue;
        const pairKey = `${us.usId}:${a.ac.id ?? '?'}:${b.ac.id ?? '?'}`;
        if (reported.has(pairKey)) continue;
        reported.add(pairKey);
        const idA = a.ac.id ?? us.usId;
        const idB = b.ac.id ?? us.usId;
        contradictionFindings.push({
          id: us.usId,
          why: `ACs ${idA} and ${idB} share a when clause with a negated then`,
        });
      }
    }
  }
  checks.push(makeCheck(
    'consistency:contradictions',
    'delta',
    Math.max(totalStoriesScanned, 1),
    contradictionFindings,
  ));

  // Scan 2: consistency:unsatisfiable (engineer, over delta). A `then`
  // naming a field that no recordShape anywhere in the tree defines
  // fails the AC with id `<acId>:<field>`. A field defined in a
  // `[draft]` recordShape counts as defined (the engineer owns the
  // draft; its `fields:` list is honest about what the then may name).
  const definedFields = collectRecordShapeFields(tree);
  /** @type {Array<{ id: string, why: string }>} */
  const unsatisfiableFindings = [];
  let totalThenFieldChecks = 0;
  for (const us of usInScope) {
    const acs = Array.isArray(us.acceptanceCriteria) ? us.acceptanceCriteria : [];
    for (const ac of acs) {
      const parts = parseWhenThen(ac?.description);
      if (!parts) continue;
      const fields = extractThenFieldTokens(parts.then);
      for (const field of fields) {
        totalThenFieldChecks += 1;
        if (definedFields.has(field)) continue;
        unsatisfiableFindings.push({
          id: `${ac.id ?? us.usId}:${field}`,
          why: `then names field ${field} that no recordShape defines`,
        });
      }
    }
  }
  checks.push(makeCheck(
    'consistency:unsatisfiable',
    'delta',
    Math.max(totalThenFieldChecks, 1),
    unsatisfiableFindings,
  ));

  // Scan 3: consistency:duplicates (engineer, over tree). Identical AC
  // descriptions across stories fail both ACs. The comparison trims
  // leading whitespace and the leading `[class]` marker.
  /** @type {Map<string, Array<{ usId: string, acId: string }>>} */
  const descBuckets = new Map();
  const allUs = tree.userStories ?? [];
  let totalDupAcs = 0;
  for (const us of allUs) {
    const acs = Array.isArray(us.acceptanceCriteria) ? us.acceptanceCriteria : [];
    for (const ac of acs) {
      const desc = typeof ac?.description === 'string' ? ac.description.trim() : '';
      if (desc.length === 0) continue;
      totalDupAcs += 1;
      const normalised = desc.replace(AC_CLASS_RE, '').trim().toLowerCase();
      if (normalised.length === 0) continue;
      const bucket = descBuckets.get(normalised) ?? [];
      bucket.push({ usId: us.usId, acId: ac.id ?? us.usId });
      descBuckets.set(normalised, bucket);
    }
  }
  /** @type {Array<{ id: string, why: string }>} */
  const duplicateFindings = [];
  for (const bucket of descBuckets.values()) {
    if (bucket.length < 2) continue;
    const stories = [...new Set(bucket.map((b) => b.usId))];
    if (stories.length < 2) continue;
    for (const entry of bucket) {
      duplicateFindings.push({
        id: entry.acId,
        why: `duplicate description (also on ${bucket.filter((b) => b.acId !== entry.acId).map((b) => b.acId).join(', ')})`,
      });
    }
  }
  checks.push(makeCheck(
    'consistency:duplicates',
    'tree',
    Math.max(totalDupAcs, 1),
    duplicateFindings,
  ));

  // Scan 4: consistency:orphanInterfaces (engineer, over tree). An
  // interface on any TAC that no AC `ownerRef` points at AND that no
  // REQ `deliveredBy` reaches fails. Shares the `interfaces[<name>]`
  // pointer grammar with D4 `stories:ownerRefResolves`. A REQ's
  // `deliveredBy` reaches an interface when it names the owning TAC id
  // (either as a `tacId` string or as a `TAC-nnnn:<name>` pointer).
  const reachedInterfaces = collectReachedInterfaces(tree);
  /** @type {Array<{ id: string, why: string }>} */
  const orphanFindings = [];
  let totalInterfacesScanned = 0;
  for (const tac of tree.tacs ?? []) {
    const list = Array.isArray(tac?.interfaces) ? tac.interfaces : [];
    for (const iface of list) {
      const name = typeof iface?.name === 'string' ? iface.name : null;
      if (!name) continue;
      totalInterfacesScanned += 1;
      const key = `${tac.tacId}:${name}`;
      if (reachedInterfaces.has(key)) continue;
      orphanFindings.push({
        id: key,
        why: 'no AC ownerRef and no REQ deliveredBy reaches it',
      });
    }
  }
  checks.push(makeCheck(
    'consistency:orphanInterfaces',
    'tree',
    Math.max(totalInterfacesScanned, 1),
    orphanFindings,
  ));

  return foldState('D6', gate, checks, {
    currentTreeHash: ctx.currentTreeHash ?? null,
    freezeGates: /** @type {any} */ (ctx.freeze?.gates),
  });
}

/**
 * Parse an AC description into { when, then } clause strings. Accepts
 * the common "given ... when ... then ..." shape used across the ACs
 * of this codebase; returns null when the description does not carry
 * both a `when` and a `then` segment. The leading `[class]` marker is
 * stripped before the scan. The match is case-insensitive on the
 * keywords only; the clause bodies keep their original casing.
 *
 * @param {unknown} desc
 * @returns {{ when: string, then: string } | null}
 */
function parseWhenThen(desc) {
  if (typeof desc !== 'string' || desc.length === 0) return null;
  const stripped = desc.replace(AC_CLASS_RE, '').trim();
  const re = /\bwhen\b([\s\S]*?)\bthen\b([\s\S]*)$/i;
  const m = stripped.match(re);
  if (!m) return null;
  const when = m[1].trim();
  const then = m[2].trim();
  if (when.length === 0 || then.length === 0) return null;
  return { when, then };
}

/**
 * Normalise a clause for the contradictions scan: lower-case, trim,
 * collapse whitespace. A clause is "the same" between two ACs when
 * their normalised forms match.
 *
 * @param {string} clause
 * @returns {string}
 */
function normaliseClause(clause) {
  return clause.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Strip double-quoted substrings and then test whether one `then`
 * clause is the negation of the other. "Negation" is a cheap test: one
 * clause begins (or carries, after a verb) a `not`, `no`, `does not`,
 * `is not`, `never`, `must not` token where the other clause does not;
 * or the two clauses are the same body with one carrying such a token.
 * The quoted-substring strip is the shared guard with D4.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function thensNegateEachOther(a, b) {
  const aPlain = normaliseClause(stripQuotedSubstrings(a));
  const bPlain = normaliseClause(stripQuotedSubstrings(b));
  if (aPlain === bPlain) return false;
  const NEG_RE = /\b(?:not|no|never|does not|is not|must not|cannot|won't|will not)\b/;
  const aNeg = NEG_RE.test(aPlain);
  const bNeg = NEG_RE.test(bPlain);
  if (aNeg === bNeg) return false;
  // One side negates; test the negated body against the positive one.
  const positive = aNeg ? bPlain : aPlain;
  const negative = aNeg ? aPlain : bPlain;
  const negativeStripped = negative.replace(NEG_RE, '').replace(/\s+/g, ' ').trim();
  // A sufficiently similar body is "the same claim with a negation".
  // We treat the shorter being a prefix / suffix / substring of the
  // longer, or sharing 80% of its tokens, as "same body".
  if (negativeStripped.length === 0) return false;
  if (positive.includes(negativeStripped) || negativeStripped.includes(positive)) return true;
  const posTokens = new Set(positive.split(/\s+/).filter((t) => t.length > 2));
  const negTokens = negativeStripped.split(/\s+/).filter((t) => t.length > 2);
  if (negTokens.length === 0) return false;
  const shared = negTokens.filter((t) => posTokens.has(t)).length;
  return shared / negTokens.length >= 0.6;
}

/**
 * Collect every field name defined by any `recordShape` interface in
 * the tree. A `fields:` marker in the interface description introduces
 * a list of field names; each name is a token on a bullet, a line, or
 * a comma-separated list. Draft recordShapes are included (the
 * engineer owns the draft and its fields: list is honest).
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @returns {Set<string>}
 */
function collectRecordShapeFields(tree) {
  const out = new Set();
  for (const tac of tree.tacs ?? []) {
    for (const iface of tac.interfaces ?? []) {
      if (iface?.kind !== 'recordShape') continue;
      const desc = typeof iface?.description === 'string' ? iface.description : '';
      const stripped = stripDraftPrefix(desc);
      // Find the `fields:` segment and read until the next `:` or end.
      const match = stripped.match(/(^|\n)\s*(?:[-*]\s*)?fields\s*:\s*([\s\S]*?)(?=(?:\n\s*(?:[-*]\s*)?[a-zA-Z][a-zA-Z0-9_]*\s*:)|$)/);
      if (!match) continue;
      const body = match[2];
      for (const token of body.split(/[\s,]+/)) {
        const name = token.replace(/^[-*]/, '').replace(/[:(){}\[\]]/g, '').trim();
        if (!name) continue;
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) out.add(name);
      }
    }
  }
  return out;
}

/**
 * Pull field tokens out of a `then` clause. A field token is a word
 * that follows a verb like `set`, `write`, `include`, `return`,
 * `contain`, `name` or appears as the direct object of a `then`'s
 * verb phrase; a cheap approximation uses `then <subject> <verb>
 * <field>` plus `field <name>`, `<name> field` and `field: <name>`
 * patterns. The scan is deliberately conservative so a plain English
 * sentence yields a small set.
 *
 * @param {string} thenClause
 * @returns {string[]}
 */
function extractThenFieldTokens(thenClause) {
  if (typeof thenClause !== 'string' || thenClause.length === 0) return [];
  const text = stripQuotedSubstrings(thenClause);
  /** @type {Set<string>} */
  const tokens = new Set();
  // Pattern 1: backticked identifier (`then `balance` is set`). The
  // primary signal; prose that quotes a field name under backticks is
  // the convention this check expects.
  for (const m of text.matchAll(/`([A-Za-z_][A-Za-z0-9_]*)`/g)) {
    if (m[1]) tokens.add(m[1]);
  }
  // Pattern 2: `<name> field` (adjective-form naming). An English
  // "stop word" skip keeps "the field", "a field" and "its field" from
  // tripping the check.
  const STOP = new Set(['the', 'a', 'an', 'this', 'that', 'its', 'our', 'their', 'any', 'no', 'some', 'each', 'every', 'another']);
  for (const m of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s+field\b/g)) {
    const token = m[1];
    if (!token) continue;
    if (STOP.has(token.toLowerCase())) continue;
    tokens.add(token);
  }
  // Pattern 3: `field: <name>` or `field = <name>` (schema-like
  // notation inside a then clause).
  for (const m of text.matchAll(/\bfield\s*[:=]\s*([A-Za-z_][A-Za-z0-9_]*)/g)) {
    if (m[1]) tokens.add(m[1]);
  }
  return [...tokens];
}

/**
 * Collect every interface the tree "reaches" from an AC `ownerRef` or
 * a REQ `deliveredBy` (REQ-174 companion field). The result is a Set
 * of `<tacId>:<name>` keys. A `deliveredBy` on a REQ can take two
 * shapes: an array of `TAC-nnnn:<name>` pointer strings, or an array
 * of plain TAC ids ("delivered by this TAC"); the second shape reaches
 * every interface on the named TAC.
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @returns {Set<string>}
 */
function collectReachedInterfaces(tree) {
  const out = new Set();
  // AC ownerRefs.
  for (const us of tree.userStories ?? []) {
    const acs = Array.isArray(us.acceptanceCriteria) ? us.acceptanceCriteria : [];
    for (const ac of acs) {
      if (!acHasOwnerRef(ac)) continue;
      const ref = /** @type {any} */ (ac).ownerRef;
      const name = parseOwnerRefInterfaceField(ref?.field);
      if (!name || typeof ref?.tacId !== 'string') continue;
      out.add(`${ref.tacId}:${name}`);
    }
  }
  // REQ deliveredBy (optional field; shapes above).
  for (const req of tree.requirements ?? []) {
    const deliveredBy = /** @type {any} */ (req)?.deliveredBy;
    if (!Array.isArray(deliveredBy)) continue;
    for (const entry of deliveredBy) {
      if (typeof entry !== 'string' || entry.length === 0) continue;
      const m = entry.match(/^(TAC-[A-Za-z0-9-]+):(.+)$/);
      if (m) {
        out.add(`${m[1]}:${m[2]}`);
        continue;
      }
      // Plain TAC id: every interface on that TAC is reached.
      const tac = (tree.tacs ?? []).find((t) => t?.tacId === entry);
      if (!tac) continue;
      for (const iface of tac.interfaces ?? []) {
        if (typeof iface?.name === 'string') out.add(`${tac.tacId}:${iface.name}`);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// D7 -- Decisions and review (blocking in 0.29.0).
// ---------------------------------------------------------------------------

/**
 * D7 -- Decisions and review.
 *
 * @param {StageContext} ctx
 */
export function checkD7Decisions(ctx) {
  const gate = STAGE_GATES.D7;
  const decisions = /** @type {any} */ (ctx.ledgers?.decisions);
  const decisionEntries = Array.isArray(decisions?.decisions) ? decisions.decisions : [];
  const openDecisions = decisionEntries.filter((d) => d?.status === 'open');

  const delta = ctx.delta ?? { changed: [], added: [] };
  const deltaDocs = new Set([...(delta.changed ?? []), ...(delta.added ?? [])]);
  const deltaSize = [...deltaDocs].filter((id) => !id.startsWith('ledger:')).length;
  const skipSingle = ctx.profile?.skipReviewFor === 'singleDocument' && deltaSize === 1;
  if (openDecisions.length === 0 && skipSingle) {
    return notApplicable('D7', gate, 'no open decisions and profile skipReviewFor:singleDocument on a one-document delta');
  }

  const checks = [];
  // Check 1: `decisions:wellFormed` (productOwner, over tree) --
  // every decision is enumerated (ADR-4126, proposal section 1.3):
  // a non-empty question, at least two options, a default that
  // names one of the option letters.
  const wellFormedFail = [];
  for (const d of decisionEntries) {
    const why = 'decision is not enumerated (question, two or more options, a default)';
    const id = `decision:${d?.id ?? '?'}`;
    if (typeof d?.question !== 'string' || d.question.length === 0) {
      wellFormedFail.push({ id, why });
      continue;
    }
    if (!Array.isArray(d.options) || d.options.length < 2) {
      wellFormedFail.push({ id, why });
      continue;
    }
    const letters = new Set(d.options.map((o) => (o && typeof o === 'object') ? /** @type {any} */ (o).letter : undefined));
    if (typeof d.default !== 'string' || !letters.has(d.default)) {
      wellFormedFail.push({ id, why });
    }
  }
  checks.push(makeCheck('decisions:wellFormed', 'tree', decisionEntries.length, wellFormedFail));

  // Check 2: `decisions:allAnswered` (engineer, over tree) -- zero
  // open decisions. The hand-over condition for build.
  checks.push(makeCheck(
    'decisions:allAnswered',
    'tree',
    decisionEntries.length,
    openDecisions.map((d) => ({ id: `decision:${d.id}`, why: `open: ${d.question ?? '(no question)'}` })),
  ));

  return foldState('D7', gate, checks, {
    currentTreeHash: ctx.currentTreeHash ?? null,
    freezeGates: /** @type {any} */ (ctx.freeze?.gates),
  });
}

// ---------------------------------------------------------------------------
// D8 -- Freeze (blocking in 0.29.0).
// ---------------------------------------------------------------------------

/**
 * D8 -- Freeze. Tree-wide, mechanical: prior gates passed or
 * acknowledged, every AC owned by exactly one FBS, queue head
 * actionable, validate clean.
 *
 * @param {StageContext} ctx
 */
export function checkD8Freeze(ctx) {
  const gate = STAGE_GATES.D8;
  const tree = ctx.tree;
  const checks = [];

  // Check 1: prior stages passed or acknowledged.
  const priorStages = Array.isArray(ctx.priorStages) ? ctx.priorStages : [];
  const priorBad = priorStages
    .filter((s) => s.state !== 'passed' && s.state !== 'acknowledged' && s.state !== 'notApplicable')
    .map((s) => ({ id: /** @type {any} */ (s).stage ?? '(?)', why: `state ${s.state}` }));
  checks.push(makeCheck('freeze:priorGates', 'tree', priorStages.length, priorBad));

  // Check 2: every AC owned by exactly one FBS. Walker gives us
  // fbsByAcId inversion; we assert length === 1 for every known AC.
  const acIds = collectAllAcIds(tree);
  const acFail = [];
  for (const acId of acIds) {
    const owners = tree.fbsByAcId?.get(acId) ?? [];
    if (owners.length === 0) acFail.push({ id: acId, why: 'no owning FBS' });
    else if (owners.length > 1) acFail.push({ id: acId, why: `${owners.length} FBS own this AC: ${owners.join(', ')}` });
  }
  checks.push(makeCheck('freeze:acFbsOwnership', 'tree', acIds.size, acFail));

  // Check 3: queue head actionable and not a placeholder.
  const queue = computeQueue(tree);
  const queueFail = [];
  if (!queue.nextActionable) {
    queueFail.push({ id: 'queue:head', why: 'no actionable FBS at the queue head' });
  } else {
    const head = (tree.fbsItems ?? []).find((f) => f.fbsId === queue.nextActionable);
    const title = typeof head?.title === 'string' ? head.title.trim() : '';
    if (!title || /^todo\b/i.test(title)) {
      queueFail.push({ id: queue.nextActionable, why: 'queue head title is empty or a TODO placeholder' });
    }
  }
  checks.push(makeCheck('freeze:queueHead', 'tree', 1, queueFail));

  // Check 4: validate clean tree-wide (same signal as D6 but blocking here).
  // Truncate the failing array for display; fold `pass` from the
  // untruncated count so beyond-20 failures do not turn into false passes.
  const validateErrors = Array.isArray(ctx.validateErrors) ? ctx.validateErrors : [];
  const validateFail = validateErrors.slice(0, 20).map((e, i) => ({
    id: /** @type {any} */ (e)?.documentId ?? `validate:${i}`,
    why: /** @type {any} */ (e)?.message ?? 'validate error',
  }));
  checks.push(makeCheck('freeze:validateClean', 'tree', Math.max(validateErrors.length, 1), validateFail, validateErrors.length));

  return foldState('D8', gate, checks, {
    currentTreeHash: ctx.currentTreeHash ?? null,
    freezeGates: /** @type {any} */ (ctx.freeze?.gates),
  });
}

/**
 * Collect every AC id in the tree (walker keeps them inline on the
 * parent US). Kept here to avoid depending on the private helper in
 * `walker.js`.
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @returns {Set<string>}
 */
function collectAllAcIds(tree) {
  const out = new Set();
  for (const us of tree.userStories ?? []) {
    for (const ac of us.acceptanceCriteria ?? []) {
      if (typeof ac?.id === 'string') out.add(ac.id);
    }
  }
  return out;
}

/**
 * Dispatch by stage id (D1..D8) or by short name (brief..freeze).
 * Consumers call `runStage('D4', ctx)` or `runStage('stories', ctx)`.
 *
 * @param {string} stageOrShort
 * @param {StageContext} ctx
 */
export function runStage(stageOrShort, ctx) {
  const stage = STAGE_ALIASES[stageOrShort];
  if (!stage) throw new TypeError(`Unknown stage '${stageOrShort}'`);
  switch (stage) {
    case 'D1': return checkD1Brief(ctx);
    case 'D2': return checkD2Skeleton(ctx);
    case 'D3': return checkD3Shapes(ctx);
    case 'D4': return checkD4Stories(ctx);
    case 'D5': return checkD5Crosscut(ctx);
    case 'D6': return checkD6Consistency(ctx);
    case 'D7': return checkD7Decisions(ctx);
    case 'D8': return checkD8Freeze(ctx);
    default: throw new TypeError(`Unhandled stage '${stage}'`);
  }
}

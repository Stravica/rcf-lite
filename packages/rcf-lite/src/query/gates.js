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
import { BRIEF_KINDS } from '../define/ledgers.js';

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

/** Case-insensitive whole-word TODO marker used by validate.js. */
const TODO_RE = /\btodo\b/i;

/** Bracketed AC-class prefix (Baz decision 6, proposal §3.2 D4). */
const AC_CLASS_RE = /^\[(happy|edge|failure|must-not|non-functional)\]/;

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
 * @returns {{ name: string, ok: boolean, over: 'delta'|'tree', pass: number, total: number, failing: Array<{ id: string, why: string }> }}
 */
function makeCheck(name, over, total, failing) {
  const pass = Math.max(0, total - failing.length);
  return { name, ok: failing.length === 0, over, pass, total, failing: [...failing] };
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

  if (resolvingStmts.length === 0 && reqInScope.length === 0 && !prdInScope && !tadInScope) {
    return notApplicable('D2', gate, 'no resolving brief statements and no REQ / PRD / TAD in scope');
  }

  const checks = [];

  // Check 1: every capability/constraint/entity/... statement resolves
  // (the statement carries `resolvedBy` naming a REQ / TAD entity / TAC
  // / recorded omission id, OR its text matches an existing REQ title).
  // Cheap check: a `resolvedBy` string or a name-hit on titles.
  const resolvedByStmt = (s) => {
    const rb = s?.resolvedBy;
    if (typeof rb === 'string' && rb.length > 0) return true;
    if (rb && typeof rb === 'object' && Object.keys(rb).length > 0) return true;
    const text = typeof s?.text === 'string' ? s.text.trim().toLowerCase() : '';
    if (!text) return false;
    for (const req of tree.requirements ?? []) {
      const title = typeof req?.title === 'string' ? req.title.toLowerCase() : '';
      if (title && text.includes(title)) return true;
    }
    return false;
  };
  const unresolvedStmts = resolvingStmts.filter((s) => !resolvedByStmt(s));
  checks.push(makeCheck(
    'skeleton:resolvedBy',
    'delta',
    resolvingStmts.length,
    unresolvedStmts.map((s) => ({ id: `brief:${s.id}`, why: `${s.kind} statement has no resolvedBy and no REQ-title hit` })),
  ));

  // Check 2: every REQ in scope has description, shapeClassification, domain.
  const reqShapeFail = [];
  for (const req of reqInScope) {
    if (typeof req.description !== 'string' || req.description.length === 0 || TODO_RE.test(req.description)) {
      reqShapeFail.push({ id: req.reqId, why: 'description missing or contains TODO placeholder' });
      continue;
    }
    if (!req.shapeClassification || !Array.isArray(req.shapeClassification.shapes)) {
      reqShapeFail.push({ id: req.reqId, why: 'shapeClassification.shapes missing' });
      continue;
    }
    if (typeof req.domain !== 'string' || req.domain.length === 0) {
      reqShapeFail.push({ id: req.reqId, why: 'domain missing' });
    }
  }
  checks.push(makeCheck('skeleton:reqFields', 'delta', reqInScope.length, reqShapeFail));

  // Check 3: TAD.dataStores + coreEntities present when any persistence
  // REQ exists tree-wide.
  const persistenceReq = (tree.requirements ?? []).some((r) => Array.isArray(r?.shapeClassification?.shapes) && r.shapeClassification.shapes.includes('persistence'));
  const tadFail = [];
  if (persistenceReq) {
    const tad = tree.tad ?? {};
    const dataStores = Array.isArray(tad.dataStores) ? tad.dataStores : [];
    const coreEntities = Array.isArray(tad.coreEntities) ? tad.coreEntities : [];
    if (dataStores.length === 0) tadFail.push({ id: 'TAD.dataStores', why: 'TAD.dataStores empty while persistence REQ exists' });
    if (coreEntities.length === 0) tadFail.push({ id: 'TAD.coreEntities', why: 'TAD.coreEntities empty while persistence REQ exists' });
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
 * D3 -- Interface contracts and shapes. 0.29.0 runs only the cheap
 * presence + closed-vocabulary checks.
 *
 * SEAM 0.30: template markers per kind (recordShape.fields:, httpRoute
 * method/path/request/response/errors, fixture.instances:); entity-name
 * join across TAD.coreEntities and TAC.interfaces[]; ownerRef and
 * `authoredAt` path resolution. Those add checks to this stage; the
 * fold shape stays the same.
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

  if (tacsInScope.length === 0 && shapedReqInScope.length === 0) {
    return notApplicable('D3', gate, 'no TAC and no shaped REQ (httpApi/persistence/auth) in scope');
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

  // Check 2: every interface kind is in the closed vocabulary.
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

  return foldState('D5', gate, checks, {
    currentTreeHash: ctx.currentTreeHash ?? null,
    freezeGates: /** @type {any} */ (ctx.freeze?.gates),
  });
}

// ---------------------------------------------------------------------------
// D6 -- Consistency and satisfiability probe (warn-with-ack in 0.29.0).
// ---------------------------------------------------------------------------

/**
 * D6 -- Consistency and satisfiability probe. 0.29.0 runs only the
 * validate-clean tree-wide check and the probe-ledger open count.
 *
 * SEAM 0.30: contradiction-lite across criteria on one story and
 * across their TACs' ADRs; unsatisfiable-lite (a `then` naming
 * undefined state); duplicate scan; orphan-interface scan;
 * regeneration probe runner injectable like `mutationRunner` in
 * src/review/index.js.
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
    // We track the "expected zero" as the total; failing.length == validateErrors.length.
    Math.max(validateErrors.length, 1),
    validateErrors.slice(0, 20).map((e, i) => ({
      id: /** @type {any} */ (e)?.documentId ?? `validate:${i}`,
      why: /** @type {any} */ (e)?.message ?? 'validate error',
    })),
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
  checks.push(makeCheck('consistency:probeCount', 'tree', Math.max(effectiveOpen, 1), failing));

  return foldState('D6', gate, checks, {
    currentTreeHash: ctx.currentTreeHash ?? null,
    freezeGates: /** @type {any} */ (ctx.freeze?.gates),
  });
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
  const validateErrors = Array.isArray(ctx.validateErrors) ? ctx.validateErrors : [];
  const validateFail = validateErrors.slice(0, 20).map((e, i) => ({
    id: /** @type {any} */ (e)?.documentId ?? `validate:${i}`,
    why: /** @type {any} */ (e)?.message ?? 'validate error',
  }));
  checks.push(makeCheck('freeze:validateClean', 'tree', Math.max(validateErrors.length, 1), validateFail));

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

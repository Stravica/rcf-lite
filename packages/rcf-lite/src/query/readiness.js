// Readiness compute (REQ-175; proposal 2026-09-22 §2.4, §6 v3).
//
// One pure composer over the DEFINE detection primitives:
//   1. `computeDelta` (slice 1) -> changed / added / removed / briefSince
//   2. `computeImpact` per id in changed union added -> fan-out
//   3. Eight gate check functions from `./gates.js` -> stage[]
//   4. `computeCoverage` tree-wide plus per REQ ancestor of the delta
//   5. Open decisions from the decisions ledger
//   6. Fold to `freezeable` (every stage passed / acknowledged /
//      notApplicable) and `nextAction` (first failing stage + check)
//
// Return shape mirrors proposal §2.4 exactly. The CLI (rcf define
// readiness) and the viewer's Readiness tab (slice 5) render the same
// object; the freeze verb (slice 3) refuses on any failing stage.

import { computeQueue } from '../build/queue.js';
import { computeCoverage } from './coverage.js';
import { computeDelta } from './delta.js';
import { computeImpact } from './impact.js';
import {
  STAGE_GATES,
  STAGE_ORDER,
  STAGE_SHORT_NAMES,
  checkD1Brief,
  checkD2Skeleton,
  checkD3Shapes,
  checkD4Stories,
  checkD5Crosscut,
  checkD6Consistency,
  checkD7Decisions,
  checkD8Freeze,
} from './gates.js';

/**
 * @typedef {object} ReadinessTree
 * @property {boolean} frozen
 * @property {string | null} frozenAt
 * @property {string | null} treeHash
 * @property {string} currentTreeHash
 * @property {string | null} buildAt   fbsId at the queue head, or null
 * @property {number} fbsTotal
 */

/**
 * @typedef {object} ReadinessDelta
 * @property {string[]} changed
 * @property {string[]} added
 * @property {string[]} removed
 * @property {number[]} briefSince
 * @property {import('./impact.js').ImpactNode[]} impacted
 * @property {string[]} impactedFbs
 */

/**
 * @typedef {object} CheckResult
 * @property {string} name
 * @property {boolean} ok
 * @property {'delta'|'tree'} over
 * @property {number} pass
 * @property {number} total
 * @property {Array<{ id: string, why: string }>} failing
 * @property {'productOwner'|'engineer'} persona
 * @property {string} question
 */

/**
 * @typedef {object} StageResult
 * @property {string} stage
 * @property {string} gate
 * @property {'passed'|'failing'|'acknowledged'|'notApplicable'} state
 * @property {CheckResult[]} checks
 * @property {string} [reason]
 */

/**
 * @typedef {object} Blocker
 * @property {string} stage
 * @property {string} gate
 * @property {string} check
 * @property {'productOwner'|'engineer'} persona
 * @property {'delta'|'tree'} over
 * @property {number} failingCount
 * @property {string[]} ids
 * @property {string} question
 */

/**
 * @typedef {object} LevelVerdict
 * @property {boolean} ok
 * @property {Blocker[]} blockedBy
 * @property {NextAction | null} nextAction
 */

/**
 * @typedef {object} ReadinessLevels
 * @property {LevelVerdict} intentComplete
 * @property {LevelVerdict} readyToBuild
 */

/**
 * @typedef {object} PersonaGroup
 * @property {Blocker[]} blockers
 * @property {NextAction | null} nextAction
 */

/**
 * @typedef {object} ReadinessPersonas
 * @property {PersonaGroup} productOwner
 * @property {PersonaGroup} engineer
 */

/**
 * @typedef {object} NextAction
 * @property {string} stage
 * @property {string} check
 * @property {string[]} ids
 * @property {string} command
 */

/**
 * @typedef {object} ReadinessResult
 * @property {ReadinessTree} tree
 * @property {ReadinessDelta} delta
 * @property {StageResult[]} stages
 * @property {NextAction | null} nextAction
 * @property {{ tree: import('./coverage.js').CoverageResult, delta: import('./coverage.js').CoverageResult[] }} coverage
 * @property {Array<Record<string, unknown>>} decisions
 * @property {boolean} freezeable
 * @property {ReadinessLevels} levels
 * @property {ReadinessPersonas} personas
 */

/**
 * Compute the readiness object.
 *
 * Pure over its inputs. Callers supply the ledgers bundle, freeze
 * record, testPointers map (resolveTestPointers output) and optional
 * profile switches; nothing else touches the filesystem.
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @param {object} args
 * @param {import('./delta.js').FreezeRecord | null | undefined} [args.freeze]
 * @param {import('./delta.js').LedgerBundle | undefined} [args.ledgers]
 * @param {{ skipReviewFor?: string } | undefined} [args.profile]
 * @param {string | null | undefined} [args.profileText]  rcf/.identity/profile.md contents
 * @param {Map<string, unknown> | undefined} [args.testPointers]
 * @param {Array<unknown> | undefined} [args.validateErrors]  tree-wide validate + walker errors
 * @returns {ReadinessResult}
 */
export function computeReadiness(tree, args = {}) {
  const {
    freeze = null,
    ledgers = {},
    profile = undefined,
    profileText = null,
    testPointers = undefined,
    validateErrors = [],
  } = args;

  // 1. Delta.
  const delta = computeDelta(tree, freeze, ledgers);

  // 2. Fan-out via computeImpact per id in changed union added.
  // Standalone-document ids only; ledger:<name> entries have no fan-out.
  const pivotIds = [
    ...delta.changed.filter((id) => !id.startsWith('ledger:')),
    ...delta.added.filter((id) => !id.startsWith('ledger:')),
  ];
  const pivotSet = new Set(pivotIds);
  /** @type {import('./impact.js').ImpactNode[]} */
  const impactedNodes = [];
  const impactedSeen = new Set();
  const impactedFbsSeen = new Set();
  // Skip fan-out when the tree is unfrozen: the delta IS the whole tree
  // (proposal §2.2 "before the first freeze the delta is the whole
  // tree"), so a per-id fan-out is quadratic for no signal.
  const runFanOut = delta.frozen === true;
  if (runFanOut) {
    for (const id of pivotIds) {
      const impact = computeImpact(tree, { id });
      if (!impact.found || !Array.isArray(impact.nodes)) continue;
      for (const node of impact.nodes) {
        if (node.role === 'pivot') continue;
        if (pivotSet.has(node.id)) continue;
        if (!impactedSeen.has(node.id)) {
          impactedSeen.add(node.id);
          impactedNodes.push(node);
        }
        if (node.kind === 'fbs' && node.actionNeeded === 're-execute') {
          impactedFbsSeen.add(node.id);
        }
      }
    }
  }
  const impactedFbs = [...impactedFbsSeen].sort();

  // 3. Compose scope = changed union added union impacted (dedup, sort).
  const scopeSet = new Set([
    ...delta.changed.filter((id) => !id.startsWith('ledger:')),
    ...delta.added.filter((id) => !id.startsWith('ledger:')),
    ...impactedSeen,
  ]);

  // 4. Coverage: tree-wide plus per REQ ancestor of the delta.
  const coverageTree = computeCoverage(tree, { testPointers, strict: true });
  const deltaReqIds = collectDeltaReqAncestors(tree, pivotIds);
  const coverageDelta = [];
  for (const reqId of deltaReqIds) {
    coverageDelta.push(computeCoverage(tree, { testPointers, strict: true, scopeId: reqId }));
  }

  // 5. Run the eight gate check functions in order. D8 reads the
  // prior stage states, so compose sequentially.
  /** @type {StageResult[]} */
  const stages = [];
  const currentTreeHash = delta.currentTreeHash;
  /** @type {import('./gates.js').StageContext} */
  const ctx = {
    tree,
    ledgers,
    delta,
    freeze,
    scope: scopeSet,
    validateErrors,
    // Prefer the caller-supplied probe count when it is passed; falls
    // back to the ledger scan inside checkD6Consistency.
    probeOpenCount: undefined,
    coverageTree,
    profileText,
    profile,
    currentTreeHash,
    priorStages: undefined,
  };
  stages.push(checkD1Brief(ctx));
  stages.push(checkD2Skeleton(ctx));
  stages.push(checkD3Shapes(ctx));
  stages.push(checkD4Stories(ctx));
  stages.push(checkD5Crosscut(ctx));
  stages.push(checkD6Consistency(ctx));
  stages.push(checkD7Decisions(ctx));
  stages.push(checkD8Freeze({ ...ctx, priorStages: stages.map((s) => ({ stage: s.stage, state: s.state })) }));

  // 6. Open decisions in the #241 format for the surface consumer.
  const decisions = /** @type {any} */ (ledgers?.decisions);
  const decisionEntries = Array.isArray(decisions?.decisions) ? decisions.decisions : [];
  const openDecisions = decisionEntries.filter((d) => d?.status === 'open');

  // 7. Fold freezeable + nextAction.
  const freezeable = stages.every((s) => s.state === 'passed' || s.state === 'acknowledged' || s.state === 'notApplicable');
  const nextAction = freezeable ? null : deriveNextAction(stages);

  // 7b. Fold `levels` and `personas` from stages[].checks[] alone
  // (ADR-4126, proposal section 2.1). Nothing is written. L1
  // intent-complete is "every productOwner check ok across every
  // stage"; L2 ready-to-build equals freezeable with blockers over
  // failing stages only.
  const levels = deriveLevels(stages, freezeable, nextAction);
  const personas = derivePersonas(stages, levels);

  // 8. Build the tree summary line inputs.
  const queue = computeQueue(tree);
  const fbsTotal = (tree.fbsItems ?? []).length;

  /** @type {ReadinessResult} */
  return {
    tree: {
      frozen: delta.frozen,
      frozenAt: delta.frozenAt,
      treeHash: delta.treeHash,
      currentTreeHash: delta.currentTreeHash,
      buildAt: queue.nextActionable ?? null,
      fbsTotal,
    },
    delta: {
      changed: delta.changed,
      added: delta.added,
      removed: delta.removed,
      briefSince: delta.briefSince,
      impacted: impactedNodes,
      impactedFbs,
    },
    stages,
    nextAction,
    coverage: { tree: coverageTree, delta: coverageDelta },
    decisions: openDecisions,
    freezeable,
    levels,
    personas,
  };
}

/**
 * Walk back from every delta pivot to its REQ ancestor and collect
 * the unique REQ ids. The walker records parent-child edges under
 * `parentByChild`; the walk terminates at the first REQ hit.
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @param {string[]} pivotIds
 * @returns {string[]}
 */
function collectDeltaReqAncestors(tree, pivotIds) {
  const seen = new Set();
  for (const id of pivotIds) {
    let cursor = id;
    let hops = 0;
    while (cursor && hops < 32) {
      hops += 1;
      const kind = tree.kindById?.get(cursor);
      if (kind === 'req') {
        seen.add(cursor);
        break;
      }
      // Some kinds carry an explicit reqId; use that when the parent
      // chain skips the REQ (e.g. a TC leaf whose parent is a TS).
      const doc = tree.byId?.get(cursor);
      if (doc && typeof doc === 'object' && typeof /** @type {any} */ (doc).reqId === 'string') {
        seen.add(/** @type {any} */ (doc).reqId);
        break;
      }
      const parent = tree.parentByChild?.get(cursor);
      if (!parent) break;
      cursor = parent;
    }
  }
  return [...seen].sort();
}

/**
 * Pick the first failing stage in D1..D8 order and the first failing
 * check inside it, then compose a `NextAction`. With no `persona`
 * passed, behaves exactly as 0.28.4 did (first failing stage, first
 * failing check, largest failing list). With a `persona` ('productOwner'
 * | 'engineer'), picks the first failing stage that holds a failing
 * check of that persona, then the largest failing-list check among
 * them; the command carries `--level intent` on the productOwner
 * variant and no `--level` flag otherwise (proposal section 2.1).
 *
 * The productOwner next action is defined over every stage holding a
 * failing PO check (not just stages with state `failing`), because
 * `levels.intentComplete.blockedBy` ignores stage state. In practice
 * PO checks live on blocking stages (D1, D2, D4, D7) so any failing
 * PO check also makes its stage `failing`, but the compute does not
 * rely on that coincidence.
 *
 * @param {StageResult[]} stages
 * @param {'productOwner' | 'engineer'} [persona]
 * @returns {NextAction | null}
 */
export function deriveNextAction(stages, persona) {
  const byStage = new Map(stages.map((s) => [s.stage, s]));
  for (const stageId of STAGE_ORDER) {
    const s = byStage.get(stageId);
    if (!s) continue;
    // Without a persona filter: today's rule (stage must be
    // `failing`; this skips `acknowledged` warn-with-ack stages).
    // With a persona filter: scan any stage that holds a failing
    // check of that persona. PO checks only live on blocking stages
    // so this coincides with "stage failing" in practice, but it
    // keeps the compute honest if that ever changes.
    if (!persona && s.state !== 'failing') continue;
    const failing = s.checks.filter((c) => !c.ok && (persona ? c.persona === persona : true));
    if (failing.length === 0) continue;
    // First failing check; tie-break by the largest failing list so
    // the operator sees the most impactful gap first.
    const check = failing.reduce((a, b) => (b.failing.length > a.failing.length ? b : a), failing[0]);
    const ids = [...new Set(check.failing.map((f) => f.id))].slice(0, 20);
    const shortName = STAGE_SHORT_NAMES[stageId] ?? stageId;
    const command = persona === 'productOwner'
      ? `rcf define readiness --level intent --check ${shortName}`
      : `rcf define readiness --check ${shortName}`;
    return {
      stage: stageId,
      check: check.name,
      ids,
      command,
    };
  }
  return null;
}

/**
 * Build a `Blocker` row from a stage + check pair. `ids` are
 * deduplicated and capped at 20 to match the display convention
 * `nextAction.ids` uses (proposal section 2.1).
 *
 * @param {StageResult} stage
 * @param {CheckResult} check
 * @returns {Blocker}
 */
function makeBlocker(stage, check) {
  return {
    stage: stage.stage,
    gate: stage.gate,
    check: check.name,
    persona: check.persona,
    over: check.over,
    failingCount: check.failing.length,
    ids: [...new Set(check.failing.map((f) => f.id))].slice(0, 20),
    question: check.question,
  };
}

/**
 * Fold the two levels from `stages[].checks[]` (ADR-4126, proposal
 * section 2.1). L1 ignores stage state and lists every failing PO
 * check; L2 lists every failing check in a stage whose state is
 * `failing` (checks inside an `acknowledged` stage are not blockers).
 *
 * @param {StageResult[]} stages
 * @param {boolean} freezeable
 * @param {NextAction | null} nextAction
 * @returns {ReadinessLevels}
 */
export function deriveLevels(stages, freezeable, nextAction) {
  /** @type {Blocker[]} */
  const poBlockers = [];
  /** @type {Blocker[]} */
  const buildBlockers = [];
  for (const stage of stages) {
    for (const check of stage.checks) {
      if (check.ok) continue;
      if (check.persona === 'productOwner') {
        poBlockers.push(makeBlocker(stage, check));
      }
      if (stage.state === 'failing') {
        buildBlockers.push(makeBlocker(stage, check));
      }
    }
  }
  const intentOk = poBlockers.length === 0;
  return {
    intentComplete: {
      ok: intentOk,
      blockedBy: poBlockers,
      nextAction: intentOk ? null : deriveNextAction(stages, 'productOwner'),
    },
    readyToBuild: {
      ok: freezeable,
      blockedBy: buildBlockers,
      nextAction,
    },
  };
}

/**
 * Fold the `personas` block (ADR-4126, proposal section 3.3).
 * `productOwner.blockers` deep-equals `levels.intentComplete.blockedBy`;
 * `engineer.blockers` is the failing engineer checks in failing stages
 * (the L2 blockedBy minus the PO entries).
 *
 * @param {StageResult[]} stages
 * @param {ReadinessLevels} levels
 * @returns {ReadinessPersonas}
 */
export function derivePersonas(stages, levels) {
  const engineerBlockers = levels.readyToBuild.blockedBy.filter((b) => b.persona === 'engineer');
  return {
    productOwner: {
      blockers: levels.intentComplete.blockedBy,
      nextAction: levels.intentComplete.nextAction,
    },
    engineer: {
      blockers: engineerBlockers,
      nextAction: deriveNextAction(stages, 'engineer'),
    },
  };
}

/**
 * Validate a `--level` flag value against the closed set
 * `intent | build`. Returns the value, `null` when the flag was
 * absent, or throws a usage error whose message is formatted exactly
 * like the `--check` usage line so the CLI can forward it verbatim.
 *
 * @param {string | undefined} raw
 * @returns {'intent' | 'build' | null}
 */
export function parseLevelFlag(raw) {
  if (raw === undefined || raw === null) return null;
  if (raw === 'intent' || raw === 'build') return raw;
  throw new Error(`unknown --level ${raw} (expected intent | build)`);
}

/**
 * Validate a `--persona` flag value against the closed set
 * `productOwner | engineer`. Returns the value, `null` when the flag
 * was absent, or throws a usage error with the same shape.
 *
 * @param {string | undefined} raw
 * @returns {'productOwner' | 'engineer' | null}
 */
export function parsePersonaFlag(raw) {
  if (raw === undefined || raw === null) return null;
  if (raw === 'productOwner' || raw === 'engineer') return raw;
  throw new Error(`unknown --persona ${raw} (expected productOwner | engineer)`);
}

/**
 * Format the two verdict lines shared by the CLI text report and
 * the Readiness tab (proposal section 2.3). The strings are built
 * from `levels` alone so the two surfaces cannot disagree.
 *
 * @param {ReadinessResult} result
 * @returns {{ intentComplete: string, readyToBuild: string }}
 */
export function formatVerdictLines(result) {
  const l = result.levels;
  const intentLine = l.intentComplete.ok
    ? 'Intent-complete: yes. Every product-owner question is answered.'
    : (() => {
      const n = l.intentComplete.blockedBy.length;
      const detail = l.intentComplete.blockedBy
        .map((b) => `${b.stage}/${b.check}`)
        .join(', ');
      return `Intent-complete: no; ${n} question${n === 1 ? '' : 's'} for the product owner (${detail}).`;
    })();
  const buildLine = l.readyToBuild.ok
    ? `Ready-to-build: yes. Freezeable at ${shortHash(result.tree.currentTreeHash)}.`
    : (() => {
      const blockers = l.readyToBuild.blockedBy;
      const stages = [...new Set(blockers.map((b) => b.stage))].sort();
      const total = blockers.length;
      const p = blockers.filter((b) => b.persona === 'productOwner').length;
      const e = blockers.filter((b) => b.persona === 'engineer').length;
      return `Ready-to-build: no; blocked on ${stages.join(', ')} (${total} check${total === 1 ? '' : 's'}: ${p} product owner, ${e} engineer).`;
    })();
  return { intentComplete: intentLine, readyToBuild: buildLine };
}

/**
 * Short 8-character prefix of a `sha256:<hex>` string, or '(none)' when
 * absent. Kept exported so text formatters share one convention.
 *
 * @param {string | null | undefined} hash
 * @returns {string}
 */
export function shortHash(hash) {
  if (typeof hash !== 'string' || !hash.startsWith('sha256:')) return '(none)';
  return hash.slice('sha256:'.length, 'sha256:'.length + 8);
}

/**
 * One-line tree summary matching proposal §6.2:
 *   "Frozen at 9f3a2c on 2026-09-20. 4 documents changed since, 11
 *    impacted. Build at FBS-031 of 41; 2 FBS impacted."
 *   "Unfrozen. 30 documents; the whole tree is the delta."
 *
 * @param {ReadinessResult} result
 * @returns {string}
 */
export function formatTreeLine(result) {
  const t = result.tree;
  const d = result.delta;
  if (!t.frozen) {
    const total = d.added.length + d.changed.length;
    return `Unfrozen. ${total} document${total === 1 ? '' : 's'}; the whole tree is the delta.`;
  }
  const changedCount = d.changed.length + d.added.length + d.removed.length;
  const impactedCount = d.impacted.length;
  const buildAt = t.buildAt ?? '(none)';
  const impactedFbs = d.impactedFbs.length;
  const at = t.frozenAt ? t.frozenAt.split('T')[0] : '(no timestamp)';
  return `Frozen at ${shortHash(t.treeHash)} on ${at}. ${changedCount} document${changedCount === 1 ? '' : 's'} changed since, ${impactedCount} impacted. Build at ${buildAt} of ${t.fbsTotal}; ${impactedFbs} FBS impacted.`;
}

// Re-export for CLI convenience.
export { STAGE_GATES, STAGE_ORDER, STAGE_SHORT_NAMES };

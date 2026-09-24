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
 * @typedef {object} StageResult
 * @property {string} stage
 * @property {string} gate
 * @property {'passed'|'failing'|'acknowledged'|'notApplicable'} state
 * @property {Array<{ name: string, ok: boolean, over: 'delta'|'tree', pass: number, total: number, failing: Array<{ id: string, why: string }> }>} checks
 * @property {string} [reason]
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
 * check inside it, then compose a `NextAction`.
 *
 * @param {StageResult[]} stages
 * @returns {NextAction | null}
 */
export function deriveNextAction(stages) {
  const byStage = new Map(stages.map((s) => [s.stage, s]));
  for (const stageId of STAGE_ORDER) {
    const s = byStage.get(stageId);
    if (!s || s.state !== 'failing') continue;
    // First failing check; tie-break by the largest failing list so
    // the operator sees the most impactful gap first.
    const failing = s.checks.filter((c) => !c.ok);
    if (failing.length === 0) continue;
    const check = failing.reduce((a, b) => (b.failing.length > a.failing.length ? b : a), failing[0]);
    const ids = [...new Set(check.failing.map((f) => f.id))].slice(0, 20);
    const shortName = STAGE_SHORT_NAMES[stageId] ?? stageId;
    return {
      stage: stageId,
      check: check.name,
      ids,
      command: `rcf define readiness --check ${shortName}`,
    };
  }
  return null;
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

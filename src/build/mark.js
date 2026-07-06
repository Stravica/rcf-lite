// Lifecycle marking (Phase 6 §D5). Pure transition planning for
// `rcf build <fbs-id> --mark <status>`: enum validation, forward-only
// transition-table validation, idempotent no-op detection. Returns a
// plan (or a structured error / refusal); the CLI handler executes the
// plan via the Phase 4 `updateDocument` write path. Phase 6 adds no
// new write primitive.
//
// The lifecycle is the schema enum, in order:
//   notStarted -> inProgress -> complete -> verified
// Forward jumps are legal (notStarted -> complete for trivially-shipped
// items). Backward transitions are refused (exit 4) and the message
// names the deliberate-correction escape hatch (`rcf update`).

import { rcfError } from '../errors/index.js';
import { LIFECYCLE } from './queue.js';

/**
 * @typedef {object} MarkPlan
 * @property {string} fbsId
 * @property {string} from
 * @property {string} to
 * @property {boolean} noOp - true when the item is already at `to`
 * @property {boolean} [refused] - true on a backward transition
 * @property {string} [message] - refusal message (refused plans only)
 */

/**
 * Plan a lifecycle transition. Returns an RcfError (usage) for a bad
 * status value or a non-FBS id, a refused plan for a backward
 * transition, otherwise an executable plan.
 *
 * @param {import('../store/walker.js').TreeModel} tree
 * @param {object} opts
 * @param {string} opts.fbsId
 * @param {string} opts.status - target executionStatus
 * @returns {MarkPlan | import('../errors/index.js').RcfError}
 */
export function planMark(tree, { fbsId, status }) {
  if (!LIFECYCLE.includes(status)) {
    return rcfError({
      kind: 'usage',
      message: `build: unknown --mark value '${status}' (expected ${LIFECYCLE.join(' | ')})`,
    });
  }
  const fbs = tree.byId.get(fbsId);
  if (!fbs || tree.kindById.get(fbsId) !== 'fbs') {
    return rcfError({
      kind: 'usage',
      message: `build: id ${fbsId} not found or not an FBS`,
      documentId: fbsId,
    });
  }
  const from = fbs.executionStatus;
  const fromIndex = LIFECYCLE.indexOf(from);
  const toIndex = LIFECYCLE.indexOf(status);
  if (toIndex === fromIndex) {
    return { fbsId, from, to: status, noOp: true };
  }
  if (toIndex < fromIndex) {
    return {
      fbsId,
      from,
      to: status,
      noOp: false,
      refused: true,
      message: `build: refusing backward transition ${from} -> ${status} on ${fbsId}; `
        + `for a deliberate correction use: rcf update ${fbsId} --set executionStatus=${status}`,
    };
  }
  return { fbsId, from, to: status, noOp: false };
}

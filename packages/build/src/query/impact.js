// Pure impact compute. Impact = trace-forward + trace-back + a
// labelled `actionNeeded` column per node kind + role (Phase 5 §D7).
//
// The delta over `computeTrace(..., 'both')` is the labelled
// `actionNeeded` column: it turns a raw traversal into an actionable
// re-verify / re-approve fan-out that the operator can walk through
// end-to-end.
//
// Action label rules (§D7):
//   - PRD ancestor: "re-approve"
//   - TAD ancestor: "review-arch"
//   - BS ancestor: "review-plan"
//   - REQ / US descendant: "review-scope"
//   - AC descendant: "re-approve"
//   - TS descendant: "re-verify"
//   - TC descendant: "re-run"
//   - FBS descendant: "re-execute" (cross-linked to an affected AC,
//                     or a dependent of an affected FBS)
//   - TAC / ADR descendant: "review-context" (reached via a
//                     contextRequirements cross-link, which is what
//                     the current impact fan-out surfaces)
//   - Pivot: null

import { computeTrace, kindOf } from './trace.js';

/**
 * @typedef {import('@stravica-ai/rcf-lite-core/store/walker.js').TreeModel} TreeModel
 */

/**
 * @typedef {'pivot' | 'ancestor' | 'descendant'} ImpactRole
 */

/**
 * @typedef {object} ImpactNode
 * @property {string} id
 * @property {string} kind
 * @property {ImpactRole} role
 * @property {string | null} actionNeeded
 */

/**
 * @typedef {object} ImpactEdge
 * @property {string} from
 * @property {string} to
 * @property {'parentChild' | 'crossLink'} kind
 */

/**
 * @typedef {object} ImpactResult
 * @property {string} pivot
 * @property {boolean} found - false when the pivot id is unknown
 * @property {ImpactNode[]} [nodes]
 * @property {ImpactEdge[]} [edges]
 */

/**
 * Compute impact for a pivot. Composes computeTrace('both') and layers
 * the D7 actionNeeded column per (kind, role).
 *
 * @param {TreeModel} tree
 * @param {object} opts
 * @param {string} opts.id
 * @param {boolean} [opts.includeCode] - Phase 10: extend the forward fan-out
 *   into Code Nodes.
 * @returns {ImpactResult}
 */
export function computeImpact(tree, { id, includeCode = false }) {
  const pivotKind = kindOf(tree, id);
  if (!pivotKind) return { pivot: id, found: false };

  const back = computeTrace(tree, { id, direction: 'back' });
  const fwd = computeTrace(tree, { id, direction: 'forward', includeCode });

  /** @type {ImpactNode[]} */
  const nodes = [];
  /** @type {ImpactEdge[]} */
  const edges = [];
  const seen = new Set();

  const push = (n) => {
    if (seen.has(n.id)) return;
    seen.add(n.id);
    nodes.push(n);
  };

  push({ id, kind: pivotKind, role: 'pivot', actionNeeded: null });

  const backNodes = (back.nodes ?? []).filter((n) => n.id !== id);
  for (const n of backNodes) {
    push({
      id: n.id,
      kind: n.kind,
      role: 'ancestor',
      actionNeeded: labelFor(n.kind, 'ancestor'),
    });
  }
  const fwdNodes = (fwd.nodes ?? []).filter((n) => n.id !== id);
  for (const n of fwdNodes) {
    push({
      id: n.id,
      kind: n.kind,
      role: 'descendant',
      actionNeeded: labelFor(n.kind, 'descendant'),
    });
  }

  // Edges: combine both directions. De-dupe on (from, to) so the same
  // edge doesn't appear twice when the forward and back traces share a
  // segment (they don't, structurally, but keep the guard for safety).
  const edgeKey = (e) => `${e.from}->${e.to}`;
  const edgeSeen = new Set();
  for (const e of (back.edges ?? []).concat(fwd.edges ?? [])) {
    const k = edgeKey(e);
    if (edgeSeen.has(k)) continue;
    edgeSeen.add(k);
    edges.push(e);
  }

  return { pivot: id, found: true, nodes, edges };
}

/**
 * Map (kind, role) to a D7 action label. Returns null when no rule
 * applies (either because it's the pivot or because the kind isn't
 * in the D7 table for that role - a design defensive default).
 *
 * @param {string} kind
 * @param {ImpactRole} role
 * @returns {string | null}
 */
export function labelFor(kind, role) {
  if (role === 'pivot') return null;
  if (role === 'ancestor') {
    switch (kind) {
      case 'prd': return 're-approve';
      case 'tad': return 'review-arch';
      case 'buildSequence': return 'review-plan';
      case 'req': return 'review-scope';
      case 'userStory': return 'review-scope';
      case 'ac': return 're-approve';
      case 'testSuite': return 're-verify';
      case 'tac': return 'review-arch';
      case 'adr': return 'review-arch';
      case 'fbs': return 're-execute';
      default: return null;
    }
  }
  // descendant
  switch (kind) {
    case 'prd': return 're-approve';
    case 'tad': return 'review-arch';
    case 'buildSequence': return 'review-plan';
    case 'req': return 'review-scope';
    case 'userStory': return 'review-scope';
    case 'ac': return 're-approve';
    case 'testSuite': return 're-verify';
    case 'tc': return 're-run';
    case 'fbs': return 're-execute';
    case 'tac': return 'review-context';
    case 'adr': return 'review-context';
    // Phase 10 (X2 CodeNode bridge): a code node reached forward from a
    // spec change is source that may need re-implementation + re-test.
    case 'codeNode': return 're-verify-code';
    default: return null;
  }
}

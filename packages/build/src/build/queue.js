// Build queue semantics (Phase 6 §D2). Pure projection of the FBS
// documents into a deterministic queue: per-item derived state
// (actionable / blocked / inProgress / complete / verified), cycle
// detection over the dependency graph, aggregate totals and next-item
// selection. No I/O, no wall clock, no mutation of the tree.
//
// An FBS item is ACTIONABLE when its executionStatus is `notStarted`
// AND every id in dependsOnFbsIds resolves to an FBS whose status is
// `complete` or `verified`. `notStarted` with an unsatisfied dependency
// is BLOCKED. `inProgress` is neither: it is in flight and selection
// skips it (the envelope surfaces it so a harness can notice an
// abandoned claim). Dependency cycles make every member permanently
// blocked; the queue labels them `blocked (cycle)` rather than crashing
// (`rcf validate` remains the integrity surface).

/** Lifecycle order (common.schema.json executionStatus enum). */
export const LIFECYCLE = ['notStarted', 'inProgress', 'complete', 'verified'];

const SATISFIED = new Set(['complete', 'verified']);

/**
 * @typedef {object} QueueItem
 * @property {string} fbsId
 * @property {number} buildOrder
 * @property {string} title
 * @property {string} executionStatus
 * @property {string[]} dependsOnFbsIds
 * @property {('actionable'|'blocked'|'inProgress'|'complete'|'verified')} state
 * @property {string[]} blockedBy - dependency ids not yet complete/verified
 * @property {boolean} [cycle] - present (true) on blocked cycle members
 */

/**
 * @typedef {object} QueueResult
 * @property {{bsId: string, title: string, generationStrategy: string}|null} bs
 * @property {object} totals
 * @property {string|null} nextActionable
 * @property {QueueItem[]} items
 */

/**
 * Sort comparator: buildOrder ascending, fbsId lexicographic tie-break
 * (§D2 - the schema does not enforce buildOrder uniqueness, so the
 * tie-break keeps the total order deterministic).
 *
 * @param {{buildOrder?: number, fbsId?: string}} a
 * @param {{buildOrder?: number, fbsId?: string}} b
 * @returns {number}
 */
export function byBuildOrder(a, b) {
  const orderA = a.buildOrder ?? 0;
  const orderB = b.buildOrder ?? 0;
  if (orderA !== orderB) return orderA - orderB;
  return (a.fbsId ?? '').localeCompare(b.fbsId ?? '');
}

/**
 * Find every FBS id that sits on a dependency cycle. Standard
 * iterative DFS with a colour map over the dependsOnFbsIds edges;
 * when a back edge closes a loop, every node on the current stack
 * segment from the loop entry is a cycle member.
 *
 * @param {Map<string, object>} fbsById
 * @returns {Set<string>}
 */
function findCycleMembers(fbsById) {
  const members = new Set();
  const state = new Map(); // id -> 'visiting' | 'done'
  const stack = [];

  const visit = (startId) => {
    // Iterative DFS frame stack: [id, depIndex].
    const frames = [[startId, 0]];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const [id] = frame;
      if (frame[1] === 0) {
        state.set(id, 'visiting');
        stack.push(id);
      }
      const deps = fbsById.get(id)?.dependsOnFbsIds ?? [];
      if (frame[1] >= deps.length) {
        state.set(id, 'done');
        stack.pop();
        frames.pop();
        continue;
      }
      const depId = deps[frame[1]];
      frame[1] += 1;
      if (!fbsById.has(depId)) continue;
      const depState = state.get(depId);
      if (depState === 'visiting') {
        // Back edge: every id on the stack from depId onward is a member.
        const from = stack.indexOf(depId);
        for (let i = from; i < stack.length; i += 1) members.add(stack[i]);
      } else if (depState === undefined) {
        frames.push([depId, 0]);
      }
    }
  };

  for (const id of fbsById.keys()) {
    if (!state.has(id)) visit(id);
  }
  return members;
}

/**
 * Compute the queue over a walked tree. Deterministic: same tree,
 * same result, always.
 *
 * @param {import('../store/walker.js').TreeModel} tree
 * @returns {QueueResult}
 */
export function computeQueue(tree) {
  const fbsItems = [...(tree.fbsItems ?? [])].sort(byBuildOrder);
  const fbsById = new Map(fbsItems.map((f) => [f.fbsId, f]));
  const cycleMembers = findCycleMembers(fbsById);

  const items = fbsItems.map((fbs) => {
    const deps = fbs.dependsOnFbsIds ?? [];
    const blockedBy = deps
      .filter((depId) => !SATISFIED.has(fbsById.get(depId)?.executionStatus))
      .map((depId) => fbsById.get(depId) ?? { fbsId: depId, buildOrder: 0 })
      .sort(byBuildOrder)
      .map((dep) => dep.fbsId);
    let state;
    if (fbs.executionStatus === 'notStarted') {
      state = blockedBy.length === 0 ? 'actionable' : 'blocked';
    } else {
      state = fbs.executionStatus;
    }
    const item = {
      fbsId: fbs.fbsId,
      buildOrder: fbs.buildOrder,
      title: fbs.title,
      executionStatus: fbs.executionStatus,
      dependsOnFbsIds: deps,
      state,
      blockedBy,
    };
    if (state === 'blocked' && cycleMembers.has(fbs.fbsId)) item.cycle = true;
    return item;
  });

  const totals = {
    items: items.length,
    notStarted: items.filter((i) => i.executionStatus === 'notStarted').length,
    inProgress: items.filter((i) => i.executionStatus === 'inProgress').length,
    complete: items.filter((i) => i.executionStatus === 'complete').length,
    verified: items.filter((i) => i.executionStatus === 'verified').length,
    actionable: items.filter((i) => i.state === 'actionable').length,
    blocked: items.filter((i) => i.state === 'blocked').length,
  };

  const next = selectNextItem(items);
  const bs = tree.bs
    ? { bsId: tree.bs.bsId, title: tree.bs.title, generationStrategy: tree.bs.generationStrategy }
    : null;

  return { bs, totals, nextActionable: next ? next.fbsId : null, items };
}

/**
 * Select the next actionable item from a computed queue: lowest
 * buildOrder (fbsId tie-break) among actionable items. Items are
 * already in total order, so the first actionable wins.
 *
 * @param {QueueItem[]} items
 * @returns {QueueItem|null}
 */
function selectNextItem(items) {
  return items.find((i) => i.state === 'actionable') ?? null;
}

/**
 * Select the next actionable FBS item from a QueueResult.
 *
 * @param {QueueResult} queue
 * @returns {QueueItem|null}
 */
export function selectNext(queue) {
  return selectNextItem(queue.items);
}

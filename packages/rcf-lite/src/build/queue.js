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
//
// Each item also carries a TIER: the length of its longest dependency
// chain (tier 0 = no dependencies). Items sharing a tier have no
// dependency path between them, so a tier is a parallel-safe group -
// its members can be built concurrently (AC-502-2). This is a port of
// the full RCF platform's `computeTiers` (rcf-common build-graph),
// adapted to the queue's data model and cycle posture: a cycle member,
// or any item whose dependency chain runs into a cycle, has no defined
// chain length, so its tier is null and it joins no group (it is
// already reported `blocked (cycle)` / blocked above).

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
 * @property {number|null} tier - parallel-safe group (longest dependency
 *   chain length; null when the chain runs into a cycle)
 * @property {('actionable'|'blocked'|'inProgress'|'complete'|'verified')} state
 * @property {string[]} blockedBy - dependency ids not yet complete/verified
 * @property {boolean} [cycle] - present (true) on blocked cycle members
 */

/**
 * @typedef {object} TierGroup
 * @property {number} tier - 0-based tier number (0 = no dependencies)
 * @property {string[]} fbsIds - members, in queue order; no dependency
 *   path exists between any two of them, so they are parallel-safe
 */

/**
 * @typedef {object} QueueResult
 * @property {{bsId: string, title: string, generationStrategy: string}|null} bs
 * @property {object} totals
 * @property {string|null} nextActionable
 * @property {TierGroup[]} tiers - parallel-safe groups, tier ascending
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
 * Compute the tier of every FBS id: the length of its longest
 * dependency chain (tier 0 = no dependencies). Port of the platform's
 * `computeTiers` memoised longest-chain DFS, iterative in the style of
 * findCycleMembers. Cycle handling reuses the members findCycleMembers
 * already detected rather than re-implementing detection: a member, or
 * any item whose chain reaches one, gets tier null (no defined chain
 * length) - the walk short-circuits there, so a cyclic graph can never
 * loop it. A dependency id that resolves to no FBS contributes chain
 * length 0 (same as the platform port; `rcf validate` is the
 * broken-reference surface).
 *
 * @param {Map<string, object>} fbsById
 * @param {Set<string>} cycleMembers
 * @returns {Map<string, number|null>}
 */
function computeTiers(fbsById, cycleMembers) {
  const tiers = new Map(); // id -> number | null

  const compute = (startId) => {
    // Iterative DFS frame stack: [id, depIndex, maxDepTier]; maxDepTier
    // null = poisoned by a cycle somewhere beneath this item.
    const frames = [[startId, 0, -1]];
    while (frames.length > 0) {
      const frame = frames[frames.length - 1];
      const [id] = frame;
      if (cycleMembers.has(id)) {
        tiers.set(id, null);
        frames.pop();
        continue;
      }
      const deps = fbsById.get(id)?.dependsOnFbsIds ?? [];
      if (frame[1] >= deps.length) {
        tiers.set(id, frame[2] === null ? null : frame[2] + 1);
        frames.pop();
        continue;
      }
      const depId = deps[frame[1]];
      frame[1] += 1;
      if (frame[2] === null) continue; // already poisoned; drain remaining deps
      const depTier = fbsById.has(depId) ? tiers.get(depId) : 0;
      if (depTier === undefined) {
        // Unresolved dependency: compute it first, then revisit this edge.
        frame[1] -= 1;
        frames.push([depId, 0, -1]);
      } else if (depTier === null) {
        frame[2] = null;
      } else if (depTier > frame[2]) {
        frame[2] = depTier;
      }
    }
  };

  for (const id of fbsById.keys()) {
    if (!tiers.has(id)) compute(id);
  }
  return tiers;
}

/**
 * Group tiered items into parallel-safe TierGroups, tier ascending,
 * members in queue order. Null-tier (cycle-tainted) items join no
 * group.
 *
 * @param {QueueItem[]} items - already in queue order
 * @returns {TierGroup[]}
 */
function groupTiers(items) {
  const byTier = new Map(); // tier -> fbsIds
  for (const item of items) {
    if (item.tier === null) continue;
    if (!byTier.has(item.tier)) byTier.set(item.tier, []);
    byTier.get(item.tier).push(item.fbsId);
  }
  return [...byTier.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tier, fbsIds]) => ({ tier, fbsIds }));
}

/**
 * Compute the queue over a walked tree. Deterministic: same tree,
 * same result, always.
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @returns {QueueResult}
 */
export function computeQueue(tree) {
  const fbsItems = [...(tree.fbsItems ?? [])].sort(byBuildOrder);
  const fbsById = new Map(fbsItems.map((f) => [f.fbsId, f]));
  const cycleMembers = findCycleMembers(fbsById);
  const tierById = computeTiers(fbsById, cycleMembers);

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
      tier: tierById.get(fbs.fbsId),
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

  return { bs, totals, nextActionable: next ? next.fbsId : null, tiers: groupTiers(items), items };
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

// Journey-step binding state (FBS-215, REQ-189, US-18906, TAC-4142).
//
// Pure derivation: given the walked tree (fbsItems with optional
// journeyStepIds[] and executionStatus) and the parsed journey record,
// compute the per-step StepState the queue, show and bundle surfaces
// print. No I/O, no wall clock, no mutation.
//
// AC-18906-2 state ladder: a step with no FBS naming it is `unbound`;
// otherwise the state is the LEAST ADVANCED bound FBS's executionStatus
// mapped from the lifecycle enum
//   notStarted -> queued
//   inProgress -> inProgress
//   complete   -> built
//   verified   -> verified
//
// AC-18906-5 edge: complete + inProgress -> inProgress (least advanced
// of the two bindings); complete + verified -> built (complete is less
// advanced than verified).
//
// AC-18906-6 must-not: these states never flow into audit coverage,
// trace or impact; they are a review-surface signal only.
//
// Node built-ins only.

/** StepState.state enum, ordered least advanced to most advanced. */
export const STEP_STATES = /** @type {const} */ (['unbound', 'queued', 'inProgress', 'built', 'verified']);

/** executionStatus -> StepState.state mapping (AC-18906-2). */
export const STATUS_TO_STATE = /** @type {const} */ ({
  notStarted: 'queued',
  inProgress: 'inProgress',
  complete: 'built',
  verified: 'verified',
});

/** Internal order used to pick the least advanced binding. Mirrors
 *  STEP_STATES ordering but with no `unbound` entry (a bound step is
 *  never unbound). */
const BOUND_ORDER = ['queued', 'inProgress', 'built', 'verified'];

/**
 * @typedef {object} StepState
 * @property {string} stepId      JNY-nnn-nnn
 * @property {string} journeyId   JNY-nnn
 * @property {('unbound'|'queued'|'inProgress'|'built'|'verified')} state
 * @property {string[]} fbsIds    build specs that name this step; empty when state=unbound
 */

/**
 * Compute the state of every journey step in the record. Returns an
 * array of StepState rows in record order (journeys walked in order,
 * steps within each journey in order). Deterministic.
 *
 * @param {object} args
 * @param {import('#core/store/walker.js').TreeModel} args.tree
 * @param {import('./record.js').JourneyRecord|null} args.record
 * @returns {StepState[]}
 */
export function computeStepStates({ tree, record }) {
  if (!record || !Array.isArray(record.journeys)) return [];
  const bindings = collectStepBindings(tree);
  const states = [];
  for (const journey of record.journeys) {
    for (const step of journey.steps ?? []) {
      const row = bindings.get(step.id);
      if (!row || row.fbsIds.length === 0) {
        states.push({
          stepId: step.id,
          journeyId: journey.id,
          state: 'unbound',
          fbsIds: [],
        });
        continue;
      }
      const state = leastAdvancedState(row.statuses);
      states.push({
        stepId: step.id,
        journeyId: journey.id,
        state,
        fbsIds: [...row.fbsIds].sort(),
      });
    }
  }
  return states;
}

/**
 * Collect the FBS bindings on every step id that appears in any FBS's
 * journeyStepIds[]. Keyed on step id; value is { fbsIds, statuses }.
 * Deterministic over the input order.
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @returns {Map<string, { fbsIds: string[], statuses: string[] }>}
 */
function collectStepBindings(tree) {
  /** @type {Map<string, { fbsIds: string[], statuses: string[] }>} */
  const map = new Map();
  for (const fbs of tree.fbsItems ?? []) {
    if (!Array.isArray(fbs.journeyStepIds)) continue;
    const status = typeof fbs.executionStatus === 'string' ? fbs.executionStatus : 'notStarted';
    for (const stepId of fbs.journeyStepIds) {
      if (typeof stepId !== 'string' || stepId.length === 0) continue;
      let row = map.get(stepId);
      if (!row) {
        row = { fbsIds: [], statuses: [] };
        map.set(stepId, row);
      }
      if (!row.fbsIds.includes(fbs.fbsId)) {
        row.fbsIds.push(fbs.fbsId);
        row.statuses.push(status);
      }
    }
  }
  return map;
}

/**
 * Pick the least advanced bound state across the given executionStatus
 * list. Statuses are mapped through STATUS_TO_STATE; the smallest rank
 * on BOUND_ORDER wins. An unknown or missing status defaults to
 * `queued` (same as `notStarted`), so a drift to a non-enum status does
 * not drop a binding from the review surface.
 *
 * @param {string[]} statuses
 * @returns {'queued'|'inProgress'|'built'|'verified'}
 */
function leastAdvancedState(statuses) {
  let best = BOUND_ORDER.length - 1;
  for (const s of statuses) {
    const state = STATUS_TO_STATE[/** @type {keyof typeof STATUS_TO_STATE} */ (s)] ?? 'queued';
    const rank = BOUND_ORDER.indexOf(state);
    if (rank >= 0 && rank < best) best = rank;
  }
  return /** @type {'queued'|'inProgress'|'built'|'verified'} */ (BOUND_ORDER[best]);
}

/**
 * Resolve a journey step id to its parent journey + screen record from
 * the parsed journey record. Returns null when the step id does not
 * resolve. Used by the bundle to print bound-step detail (id, label,
 * screen slug, wireframe path) and by `journey show` to pair StepState
 * rows with their authored labels.
 *
 * @param {import('./record.js').JourneyRecord|null} record
 * @param {string} stepId
 * @returns {{ journey: object, step: object, screen: object|null }|null}
 */
export function resolveStep(record, stepId) {
  if (!record || !Array.isArray(record.journeys)) return null;
  for (const journey of record.journeys) {
    for (const step of journey.steps ?? []) {
      if (step.id === stepId) {
        const screen = (record.screens ?? []).find((s) => s.id === step.screenId) ?? null;
        return { journey, step, screen };
      }
    }
  }
  return null;
}

/**
 * All journey step ids that exist on the record (used by validation to
 * decide a brokenReference on fbs.journeyStepIds[]).
 *
 * @param {import('./record.js').JourneyRecord|null} record
 * @returns {Set<string>}
 */
export function allStepIds(record) {
  const ids = new Set();
  if (!record || !Array.isArray(record.journeys)) return ids;
  for (const journey of record.journeys) {
    for (const step of journey.steps ?? []) {
      if (typeof step.id === 'string') ids.add(step.id);
    }
  }
  return ids;
}

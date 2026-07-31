// Design-shape questions catalogue for `rcf preflight`
// (verification-integrity-cluster-spec ADDENDUM §A).
//
// The v1 catalogue carries exactly ONE question — `auth.htmlLoginPage` —
// per the plan-committed Baz-approved scope. Additional questions land
// in v2 only on the evidence-gated triggers named in §A.3 (three
// separate projects that would have benefited, OR a case-study defect
// the existing surface cannot express). Broadening speculatively
// re-introduces the elicitation surface bloat this addendum exists to
// avoid.
//
// Two exports:
// - CATALOGUE_V1: the versioned question set, one entry per question.
// - selectApplicableQuestions(reqs): given a list of REQs, decide which
//   questions to pose. Deterministic; the interactive session drives it,
//   the non-interactive path reads the same catalogue when validating a
//   pre-filled input file.
//
// The catalogue is data, not logic. Downstream consumers own the
// side-effects (writing designShapeAnswers into the preFlightConfig
// record; the Track B / Track C+D field composition documented in
// ADDENDUM §A.2 and §A.5).

import { matchReqShapeSignals } from '@stravica-ai/rcf-lite-core/patterns/req-shapes';

/**
 * @typedef {'reqScoped'} DesignShapeQuestionScope
 */

/**
 * @typedef {object} DesignShapeAnswerChoice
 * @property {string} value           the answer id written into designShapeAnswers[]
 * @property {string} display         operator-facing label
 * @property {boolean} triggersOptOut whether choosing this writes into baselineAcOptOuts[]
 * @property {string} [uiBaselineWritePath]  dot path into uiBaseline.defaults when known
 * @property {boolean|string} [uiBaselineWriteValue] value to write at that path
 */

/**
 * @typedef {object} DesignShapeQuestion
 * @property {string} id              catalogue id (for example, auth.htmlLoginPage)
 * @property {DesignShapeQuestionScope} scope
 * @property {(reqDoc: object) => boolean} trigger  returns true when the REQ should be asked this question
 * @property {string} prompt          canonical prompt text
 * @property {DesignShapeAnswerChoice[]} choices
 * @property {number} reasonMinLength minimum reason length when the answer triggers a ledger write; matches Track C+D floor
 * @property {string} baselineKey     Track C+D baseline key this question backs, for opt-out ledger writes
 */

/**
 * True when a REQ carries the `auth` shape. Reads
 * `req.shapeClassification.shapes[]` when the classifier has run (Track
 * C+D populates this); falls back to a live `matchReqShapeSignals` pass
 * over the REQ's title, description and rationale when the field is
 * absent (Track C+D classifier not yet run on this repo).
 *
 * @param {object} reqDoc
 * @returns {boolean}
 */
function reqCarriesAuthShape(reqDoc) {
  const classified = reqDoc?.shapeClassification?.shapes;
  if (Array.isArray(classified) && classified.length > 0) {
    return classified.includes('auth');
  }
  const parts = [reqDoc?.title, reqDoc?.description, reqDoc?.rationale]
    .filter((s) => typeof s === 'string' && s.length > 0);
  for (const text of parts) {
    for (const m of matchReqShapeSignals(text)) {
      if (m.shape === 'auth') return true;
    }
  }
  return false;
}

/**
 * Deep-freeze helper. Object.freeze is shallow, so a caller could mutate
 * a nested field even on an outwardly frozen object. Review N-6
 * (non-blocking): the catalogue is a spec-committed data surface and
 * must not drift in memory. This helper recurses through plain objects
 * and arrays, freezing every reachable value, and returns the input
 * for chaining. Functions (used as `trigger`) are frozen at the field
 * level (Object.freeze on the containing object) but not descended
 * into.
 *
 * @template T
 * @param {T} value
 * @returns {Readonly<T>}
 */
function deepFreeze(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Reflect.ownKeys(value)) {
    const nested = /** @type {any} */ (value)[key];
    if (nested !== null && typeof nested === 'object' && !Object.isFrozen(nested)) {
      deepFreeze(nested);
    }
  }
  return value;
}

/**
 * Ratified catalogue. Editing this array in-place is a spec change;
 * adding a question requires evidence per §A.3. Deep-frozen so the
 * shape cannot drift in memory even at nested field level (review
 * N-6).
 *
 * @type {Readonly<DesignShapeQuestion[]>}
 */
export const CATALOGUE_V1 = deepFreeze([
  {
    id: 'auth.htmlLoginPage',
    scope: 'reqScoped',
    trigger: reqCarriesAuthShape,
    prompt: 'HTML login page or API-only?',
    choices: [
      {
        value: 'htmlLoginPage',
        display: 'HTML login page',
        triggersOptOut: false,
        uiBaselineWritePath: 'defaults.authFlow.htmlLoginPageRequired',
        uiBaselineWriteValue: true,
      },
      {
        value: 'apiOnly',
        display: 'API-only',
        triggersOptOut: true,
        uiBaselineWritePath: 'defaults.authFlow.htmlLoginPageRequired',
        uiBaselineWriteValue: false,
      },
    ],
    reasonMinLength: 20,
    baselineKey: 'auth.htmlLoginPage',
  },
]);

/**
 * Given the REQs in scope, decide which questions to pose against each
 * REQ. Returns one entry per (question, req) pair whose trigger fires;
 * the interactive session iterates in the returned order.
 *
 * @param {object[]} reqs
 * @param {Readonly<DesignShapeQuestion[]>} [catalogue]
 * @returns {Array<{ question: DesignShapeQuestion, reqId: string }>}
 */
export function selectApplicableQuestions(reqs, catalogue = CATALOGUE_V1) {
  /** @type {Array<{ question: DesignShapeQuestion, reqId: string }>} */
  const out = [];
  for (const req of reqs ?? []) {
    if (!req?.reqId) continue;
    for (const question of catalogue) {
      if (question.scope !== 'reqScoped') continue;
      if (question.trigger(req)) {
        out.push({ question, reqId: req.reqId });
      }
    }
  }
  return out;
}

/**
 * Validate a design-shape answer against the catalogue. Returns null on
 * a valid answer, or a string message describing the problem.
 *
 * @param {object} args
 * @param {string} args.questionId
 * @param {string} args.answer
 * @param {string} [args.reason]
 * @returns {string|null}
 */
export function validateDesignShapeAnswer({ questionId, answer, reason }) {
  const question = CATALOGUE_V1.find((q) => q.id === questionId);
  if (!question) return `unknown design-shape question '${questionId}'`;
  const choice = question.choices.find((c) => c.value === answer);
  if (!choice) {
    const values = question.choices.map((c) => c.value).join(' | ');
    return `unknown answer '${answer}' for question '${questionId}' (expected ${values})`;
  }
  if (choice.triggersOptOut) {
    if (typeof reason !== 'string' || reason.length < question.reasonMinLength) {
      return `answer '${answer}' for question '${questionId}' writes a baseline opt-out; reason must be at least ${question.reasonMinLength} characters`;
    }
  }
  return null;
}

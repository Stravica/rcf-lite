// Barrel: pre-flight surface for verification-integrity-cluster-spec §4.
//
// Consumers reach the pre-flight surface through this barrel so the
// internal file layout (secrets side-file, scanner, session, design
// shapes, manifest writer) can evolve without churning callers. The
// gitignore aggregator seam is the sole exception: `managed-gitignore.js`
// imports `preflightEntry` directly from `./secrets.js` to keep the
// aggregator's own import list flat, one entry per module (0.6.0 spec
// §4.1 D-4 pattern).

import {
  CATALOGUE_V1,
} from './design-shapes.js';
import {
  composeOptOutRecord,
} from './manifest-writer.js';

export {
  preflightEntry,
  preflightSecretsPath,
  loadPreflightSecretsFile,
  recordPreflightSecret,
} from './secrets.js';

export {
  scanForServiceCandidates,
  CATEGORY_DISPLAY_NAMES,
} from './scanner.js';

export {
  CATALOGUE_V1,
  selectApplicableQuestions,
  validateDesignShapeAnswer,
} from './design-shapes.js';

export {
  composePreflightRecord,
  composeOptOutRecord,
  nextPreflightId,
  nextOptOutId,
  writePreflightRecord,
} from './manifest-writer.js';

export {
  runInteractiveSession,
  normaliseNonInteractiveInput,
} from './session.js';

/**
 * Compose the baselineAcOptOuts entries triggered by design-shape
 * answers on a preflight record. Called by the CLI handler after
 * `composePreflightRecord` so the `linkedPreFlightConfigRef` can point
 * at the composed record's id.
 *
 * @param {object} args
 * @param {object|null} args.manifest
 * @param {object} args.preflightRecord   the composed record (id already allocated)
 * @param {import('./manifest-writer.js').PreflightDesignShapeAnswer[]} args.designShapeAnswers
 * @param {Date} [args.now]
 * @returns {object[]}
 */
export function composeDesignShapeOptOuts({ manifest, preflightRecord, designShapeAnswers, now = new Date() }) {
  const optOuts = [];
  let dateCursor = now;
  for (const answer of designShapeAnswers) {
    const question = CATALOGUE_V1.find((q) => q.id === answer.questionId);
    if (!question) continue;
    const choice = question.choices.find((c) => c.value === answer.answer);
    if (!choice || !choice.triggersOptOut) continue;
    // Compose one opt-out at a time so the id monotonic counter walks
    // forward correctly on a single-session batch. We synthesise a
    // provisional manifest snapshot per compose so `nextOptOutId` sees
    // any records the previous compose calls in this loop added.
    const provisional = {
      ...(manifest ?? {}),
      baselineAcOptOuts: [...(manifest?.baselineAcOptOuts ?? []), ...optOuts],
    };
    const linkedPreFlightConfigRef = `${preflightRecord.id}#designShapeAnswers.${answer.questionId}`;
    const record = composeOptOutRecord({
      manifest: provisional,
      baselineKey: question.baselineKey,
      reason: answer.reason ?? '',
      reqId: answer.reqId,
      linkedPreFlightConfigRef,
      now: dateCursor,
    });
    optOuts.push(record);
  }
  return optOuts;
}

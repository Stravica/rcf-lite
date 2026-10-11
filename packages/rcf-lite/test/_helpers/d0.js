// Shared test helper for FBS-214 (REQ-189, D0 UX intake gate).
//
// `rcf init` seeds a journey record whose `ui` is `null` (FBS-211,
// ADR-4145): new projects must `declare` before any chain-write
// (ledger brief add, create, blueprint add) runs. The D0 door
// enforces this in production. Tests that scaffold a tree through
// initProject and then exercise the gated verbs need to pre-declare
// a UI posture; declaring `none` folds D0 to notApplicable so the
// door passes without reading any wireframe. The helper is a one-
// liner: await declareUiNoneForTests(root).

import {
  declaredJourneyRecord,
  writeJourneyRecord,
} from '../../src/discovery/record.js';

/**
 * Overwrite the init-seeded journey record so D0 folds to
 * notApplicable (ui === 'none'). Use after `initProject` in tests
 * that exercise `rcf define create`, `rcf define ledger brief add`
 * or `rcf define blueprint add`.
 *
 * @param {string} projectRoot
 * @returns {Promise<void>}
 */
export async function declareUiNoneForTests(projectRoot) {
  await writeJourneyRecord({
    projectRoot,
    record: declaredJourneyRecord('none', { by: 'test', reason: 'test fixture: D0 fold to notApplicable so chain-write verbs pass' }),
  });
}

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
// items) but the mark ladder caps at `complete`: `--mark verified` is
// refused (exit 4) and points to the finalise gate (`rcf finalise`), which
// is the only path that writes `verified` after an independent verify run.
// Backward transitions are refused (exit 4) and the message names the
// deliberate-correction escape hatch (`rcf update`).

import { rcfError } from '@stravica-ai/rcf-lite-core/errors';
import { LIFECYCLE } from './queue.js';

// Phase 10 (X2 CodeNode bridge, D17, operator ruling 2026-07-10): the
// mark-complete CN gate. The no-code-nodes declaration is a dedicated
// `noCodeNodes: boolean` field on the FBS schema (rcf-schemas@0.3.1) - NOT
// a free-form convention string. An unvalidated magic value would silently
// fail on a typo, which is exactly the failure mode this feature exists to
// make visible (operator ruling 2026-07-10).
/**
 * True when the FBS already carries the `--no-code-nodes` declaration.
 * @param {object} fbs
 * @returns {boolean}
 */
export function hasNoCodeNodesDeclaration(fbs) {
  return fbs?.noCodeNodes === true;
}

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
 * @param {import('@stravica-ai/rcf-lite-core/store/walker.js').TreeModel} tree
 * @param {object} opts
 * @param {string} opts.fbsId
 * @param {string} opts.status - target executionStatus
 * @returns {MarkPlan | import('@stravica-ai/rcf-lite-core/errors').RcfError}
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
  // The mark ladder caps at `complete` (w-2026-07-22-004). `verified` means
  // "independently verified against the running deploy" - it is written only by
  // the finalise gate (`rcf finalise`), which spawns a fresh rcf-verify run.
  // Letting `--mark verified` promote with no verify run would let the builder
  // sidestep that gate with one flag, defeating the spec-9 independence
  // guarantee. Refused as part of the mark-refusal family (exit 4); the message
  // names the finalise gate and keeps `rcf update` as the explicit manual
  // override (unchanged - a deliberate, logged operator decision).
  if (status === 'verified') {
    return {
      fbsId,
      from,
      to: status,
      noOp: false,
      refused: true,
      message: `build: refusing --mark verified on ${fbsId}; 'verified' is written only by the `
        + `independent verify gate, not by --mark. Promote it with: rcf finalise ${fbsId} --url <deploy-url>. `
        + `For a deliberate manual override (no verify run) use: rcf update ${fbsId} --set executionStatus=verified`,
    };
  }
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

/**
 * The mark-complete CN gate (D17). Deterministic edge counting: an AC is
 * "covered" when `tree.cnByAcId` carries at least one implementing CN.
 * Called only when the target status is `complete`; the caller (cli/build)
 * skips this entirely when the FBS already carries the no-code-nodes
 * declaration or the invocation supplies `--no-code-nodes`.
 *
 * @param {import('@stravica-ai/rcf-lite-core/store/walker.js').TreeModel} tree
 * @param {object} fbs - the FBS document being marked complete
 * @returns {{ ok: true } | { ok: false, missingAcIds: string[] }}
 */
export function checkCodeNodeGate(tree, fbs) {
  const missingAcIds = (fbs.acIds ?? []).filter((acId) => (tree.cnByAcId?.get(acId) ?? []).length === 0);
  if (missingAcIds.length === 0) return { ok: true };
  return { ok: false, missingAcIds: [...missingAcIds].sort() };
}

// Track B (ui-design-gate-0.7.0-spec §5.2, §5.5): the `--mark complete`
// design gate. Refuses when the FBS is uiBearing=true and
// designStageComplete is not true on the FBS record. The gate is the
// boolean primitive per §12 O-3 (Decided); the executionStatus enum is
// unchanged.
/**
 * @param {object} fbs
 * @returns {{ ok: true } | { ok: false, reason: 'designStageIncomplete' }}
 */
export function checkDesignGate(fbs) {
  if (fbs?.uiBearing !== true) return { ok: true };
  if (fbs?.designStageComplete === true) return { ok: true };
  return { ok: false, reason: 'designStageIncomplete' };
}

// Track B (ui-design-gate-0.7.0-spec §7 mandate 10). Refuses when the
// operator's own attestation says the wrong order was authored, and
// (optionally) when a git-history probe unambiguously contradicts the
// operator's attestation. The git probe is out of scope for the pure
// mark.js module; the caller (cli/build) supplies the probe result.
/**
 * @param {object} fbs
 * @param {object} [historyProbe]  optional git-history corroboration result
 * @param {boolean} [historyProbe.inconclusive]  true when git says nothing
 * @param {boolean} [historyProbe.tokensCreatedFirst] true when history says tokens preceded contrast test
 * @returns {{ ok: true } | { ok: false, reason: string, message: string }}
 */
export function checkContrastBeforePaletteGate(fbs, historyProbe = { inconclusive: true }) {
  if (fbs?.uiBearing !== true) return { ok: true };
  const stage = fbs?.designStage;
  if (!stage?.themeAndA11y) return { ok: true }; // gate deferred to design-mark-complete surface
  const boolean = stage.themeAndA11y.contrastTestAuthoredBeforePalette;
  if (boolean === false) {
    return {
      ok: false,
      reason: 'contrastTestAfterPalette',
      message: `build --mark complete: refused - ${fbs.fbsId} designStage.themeAndA11y.contrastTestAuthoredBeforePalette is false. `
        + 'Author the contrast test before the palette, or record the reversal by ratifying the ordering explicitly.',
    };
  }
  if (boolean === true && historyProbe && historyProbe.inconclusive !== true && historyProbe.tokensCreatedFirst === true) {
    return {
      ok: false,
      reason: 'contrastGitHistoryConflict',
      message: `build --mark complete: refused - ${fbs.fbsId} attests contrastTestAuthoredBeforePalette=true, but git history shows the tokens module (${stage.themeAndA11y.themeTokensModule}) was created before the contrast test (${stage.themeAndA11y.contrastTestPath}). `
        + 'Reconcile the attestation with the history: rewrite the test-authoring order in the log, or set contrastTestAuthoredBeforePalette=false and accept the ruling.',
    };
  }
  return { ok: true };
}

// Shared validate-composed-record helper (0.28.2, issues #230 / #232
// and the three folded verbs review / ui-baseline init / browser-verify,
// per Barry's 2026-09-21 ruling).
//
// The bug: five discover verbs shipped a `--dry-run` branch that
// composed a manifest record and printed it without ever running the
// same schema pass the write path runs. A `--dry-run` that passed and
// a real run that failed on schema made the preview untrustworthy for
// exactly the non-interactive case it exists to serve.
//
// The fix: this helper synthesises the "next manifest" for each verb
// the same way the writer would, then runs `validateDocument` without
// touching disk. The dry-run branch of each CLI calls this helper and
// exits 3 on a validation miss, matching the exit code the write path
// returns today.

import { validateDocument } from './validator.js';

/**
 * @typedef {'intake' | 'preflight' | 'review' | 'uiBaselineInit' | 'browserVerify'} DryRunVerb
 */

/**
 * @param {object} args
 * @param {object} args.tree                     the walked tree (carries `manifest`)
 * @param {object} args.record                   the composed record to be written
 * @param {DryRunVerb} args.verb                 which verb is composing
 * @param {object[]} [args.extraRecords]          preflight-only: the composed opt-outs
 * @returns {import('../errors/index.js').RcfError | null}
 *   Returns the same shape `validateDocument` returns, so the CLI can
 *   forward the error to stderr as it would on the write path.
 */
export function validateComposedRecord({ tree, record, verb, extraRecords = [] }) {
  const manifest = tree?.manifest ?? {};
  const nextManifest = buildNextManifest({ manifest, record, verb, extraRecords });
  return validateDocument({ doc: nextManifest, kind: 'manifest', filePath: 'rcf/manifest.json' });
}

/**
 * Return the next-manifest shape each writer synthesises before its own
 * `validateDocument` call. Kept in this module so a single test can
 * assert the dry-run branch and the write branch stay in step across
 * every verb.
 *
 * @param {object} args
 * @param {object} args.manifest
 * @param {object} args.record
 * @param {DryRunVerb} args.verb
 * @param {object[]} [args.extraRecords]
 * @returns {object}
 */
export function buildNextManifest({ manifest, record, verb, extraRecords = [] }) {
  const base = { ...(manifest ?? {}) };
  switch (verb) {
    case 'intake': {
      return { ...base, intakeClassification: record };
    }
    case 'preflight': {
      const existing = Array.isArray(base.preFlightConfig) ? base.preFlightConfig : [];
      const next = { ...base, preFlightConfig: [...existing, record] };
      if (Array.isArray(extraRecords) && extraRecords.length > 0) {
        const existingOptOuts = Array.isArray(next.baselineAcOptOuts) ? next.baselineAcOptOuts : [];
        next.baselineAcOptOuts = [...existingOptOuts, ...extraRecords];
      }
      return next;
    }
    case 'review': {
      const existing = Array.isArray(base.reviewAudit) ? base.reviewAudit : [];
      return { ...base, reviewAudit: [...existing, record] };
    }
    case 'uiBaselineInit': {
      // Mirror writeUiBaselineRecord: prior uiBaseline moves into
      // uiBaselineHistory, and the record replaces the top slot.
      const next = { ...base };
      const prior = next.uiBaseline ?? null;
      if (prior && prior.id !== record.id) {
        const history = Array.isArray(next.uiBaselineHistory) ? next.uiBaselineHistory : [];
        next.uiBaselineHistory = [...history, prior];
      }
      next.uiBaseline = record;
      return next;
    }
    case 'browserVerify': {
      const existing = Array.isArray(base.browserVerification) ? base.browserVerification : [];
      return { ...base, browserVerification: [...existing, record] };
    }
    default:
      throw new Error(`validateComposedRecord: unknown verb ${verb}`);
  }
}

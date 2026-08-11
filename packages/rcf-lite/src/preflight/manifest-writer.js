// Pre-flight manifest writer
// (verification-integrity-cluster-spec §3.3, ADDENDUM §A.2).
//
// Composes and persists `preFlightConfig[]` records on the project
// manifest. The record shape is defined by the 0.4.0 manifest schema
// (`$defs/preFlightConfigRecord`); this module owns id allocation,
// timestamping, per-service entry composition, design-shape answer
// composition, and the `baselineAcOptOuts[]` fold that happens when a
// design-shape answer triggers a ledger write per §A.2.
//
// The writer takes an already-loaded walker tree and a session summary,
// runs the composition, and calls the core store's `updateDocument`
// against the manifest. All secrets discipline is upstream: this module
// never sees a credential value; the session's per-service records carry
// only booleans (`credentialSupplied`, `sandboxProvisioned`) and the
// env-var NAME (side-file, not chain).

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { rcfError } from '#core/errors';
import { validateDocument } from '#core/store';

/**
 * @typedef {object} PreflightServiceRuling
 * @property {string} id
 * @property {string} displayName
 * @property {string[]} sourceRefs
 * @property {'live'|'sandboxed'|'mocked'|'declaredMockOnly'|'notShipped'} attestationMode
 * @property {boolean} credentialSupplied
 * @property {boolean} sandboxProvisioned
 * @property {string} [operatorReason]
 * @property {string[]} [affectedFbsIds]
 */

/**
 * @typedef {object} PreflightDesignShapeAnswer
 * @property {string} questionId
 * @property {string} [reqId]
 * @property {string} answer
 * @property {string} [reason]
 */

/**
 * @typedef {object} BaselineOptOutWrite
 * @property {string} baselineKey
 * @property {'req'|'project'} scope
 * @property {string} reason
 * @property {string} [reqId]
 * @property {string} linkedPreFlightConfigRef
 */

/**
 * Compute the next preFlightConfig id for today: monotonic
 * `pfc-YYYY-MM-DD-NNN`. Reads the manifest's existing preFlightConfig
 * to find the highest suffix for the given date.
 *
 * @param {object|null} manifest
 * @param {Date} now
 * @returns {string}
 */
export function nextPreflightId(manifest, now) {
  const y = now.getUTCFullYear().toString().padStart(4, '0');
  const m = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = now.getUTCDate().toString().padStart(2, '0');
  const prefix = `pfc-${y}-${m}-${d}-`;
  const existing = Array.isArray(manifest?.preFlightConfig) ? manifest.preFlightConfig : [];
  let maxN = 0;
  for (const rec of existing) {
    if (typeof rec?.id !== 'string' || !rec.id.startsWith(prefix)) continue;
    const suffix = rec.id.slice(prefix.length);
    const n = Number.parseInt(suffix, 10);
    if (Number.isFinite(n) && n > maxN) maxN = n;
  }
  const next = (maxN + 1).toString().padStart(3, '0');
  return `${prefix}${next}`;
}

/**
 * Compute the next baselineAcOptOuts id: monotonic `boo-YYYY-MM-DD-NNN`.
 *
 * @param {object|null} manifest
 * @param {Date} now
 * @returns {string}
 */
export function nextOptOutId(manifest, now) {
  const y = now.getUTCFullYear().toString().padStart(4, '0');
  const m = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = now.getUTCDate().toString().padStart(2, '0');
  const prefix = `boo-${y}-${m}-${d}-`;
  const existing = Array.isArray(manifest?.baselineAcOptOuts) ? manifest.baselineAcOptOuts : [];
  let maxN = 0;
  for (const rec of existing) {
    if (typeof rec?.id !== 'string' || !rec.id.startsWith(prefix)) continue;
    const n = Number.parseInt(rec.id.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > maxN) maxN = n;
  }
  return `${prefix}${(maxN + 1).toString().padStart(3, '0')}`;
}

/**
 * Compose one preFlightConfig record from a session. The record's
 * `id` is monotonic per date; `createdAt` and `operatorAckAt` are the
 * same instant for a completed session.
 *
 * @param {object} args
 * @param {object|null} args.manifest
 * @param {string} args.prdId
 * @param {PreflightServiceRuling[]} args.services
 * @param {PreflightDesignShapeAnswer[]} [args.designShapeAnswers]
 * @param {Date} [args.now]
 * @returns {object}
 */
export function composePreflightRecord({
  manifest, prdId, services, designShapeAnswers = [], now = new Date(),
}) {
  const isoNow = now.toISOString();
  const id = nextPreflightId(manifest, now);
  const servicesInScope = services.map((s) => {
    const entry = {
      id: s.id,
      displayName: s.displayName,
      sourceRefs: Array.isArray(s.sourceRefs) ? [...s.sourceRefs] : [],
      attestationMode: s.attestationMode,
      credentialSupplied: Boolean(s.credentialSupplied),
      sandboxProvisioned: Boolean(s.sandboxProvisioned),
    };
    if (typeof s.operatorReason === 'string' && s.operatorReason.length > 0) {
      entry.operatorReason = s.operatorReason;
    }
    if (Array.isArray(s.affectedFbsIds) && s.affectedFbsIds.length > 0) {
      entry.affectedFbsIds = [...s.affectedFbsIds];
    }
    return entry;
  });
  const record = {
    id,
    createdAt: isoNow,
    prdId,
    servicesInScope,
    operatorAckAt: isoNow,
  };
  if (Array.isArray(designShapeAnswers) && designShapeAnswers.length > 0) {
    record.designShapeAnswers = designShapeAnswers.map((a) => {
      const entry = { questionId: a.questionId, answer: a.answer, answeredAt: isoNow };
      if (typeof a.reqId === 'string' && a.reqId.length > 0) entry.reqId = a.reqId;
      if (typeof a.reason === 'string' && a.reason.length > 0) entry.reason = a.reason;
      return entry;
    });
  }
  return record;
}

/**
 * Compose a baselineAcOptOuts entry for a design-shape answer that
 * triggers a ledger write (ADDENDUM §A.2). The record is REQ-scoped
 * when the answer is REQ-scoped; project scope requires an explicit
 * upstream ruling.
 *
 * @param {object} args
 * @param {object|null} args.manifest
 * @param {string} args.baselineKey
 * @param {string} args.reason
 * @param {string} [args.reqId]
 * @param {string} args.linkedPreFlightConfigRef
 * @param {Date} [args.now]
 * @returns {object}
 */
export function composeOptOutRecord({
  manifest, baselineKey, reason, reqId, linkedPreFlightConfigRef, now = new Date(),
}) {
  const isoNow = now.toISOString();
  const id = nextOptOutId(manifest, now);
  const record = {
    id,
    createdAt: isoNow,
    baselineKey,
    scope: reqId ? 'req' : 'project',
    reason,
    operatorAckAt: isoNow,
    linkedPreFlightConfigRef,
  };
  if (reqId) record.reqId = reqId;
  return record;
}

/**
 * Persist a preflight session: append the composed record onto the
 * manifest's `preFlightConfig[]` and any triggered opt-out records onto
 * `baselineAcOptOuts[]`. Validates the composed manifest against the
 * schema BEFORE writing; on validation failure the on-disk manifest is
 * untouched. Atomic write via a `.tmp` rename so a partial write cannot
 * leave the manifest half-composed.
 *
 * The store's `updateDocument` verb accepts child-doc and root-doc ids
 * (PRD / TAD / BS) via `pathForId`, but the manifest sits outside that
 * id space; every other manifest mutation the codebase performs also
 * goes direct-to-disk (see `initProject` in `core/store/init.js`), which
 * this helper mirrors.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('#core/store/walker.js').TreeModel} args.tree
 * @param {object} args.record         the composed preFlightConfig record
 * @param {object[]} [args.optOuts]    composed baselineAcOptOuts entries
 * @param {object} [args.uiBaselineWrites]  optional deep-set writes for uiBaseline.defaults (Track B fenced-TODO)
 * @param {object} [args.options]
 * @returns {Promise<{ record: object, optOutIds: string[], skippedUiBaseline: boolean } | import('#core/errors').RcfError>}
 */
export async function writePreflightRecord({
  projectRoot, tree, record, optOuts = [], options = {},
}) {
  const manifest = tree.manifest ?? {};
  const nextManifest = { ...manifest };

  const existingPfc = Array.isArray(nextManifest.preFlightConfig) ? nextManifest.preFlightConfig : [];
  nextManifest.preFlightConfig = [...existingPfc, record];

  if (optOuts.length > 0) {
    const existingOptOuts = Array.isArray(nextManifest.baselineAcOptOuts) ? nextManifest.baselineAcOptOuts : [];
    nextManifest.baselineAcOptOuts = [...existingOptOuts, ...optOuts];
  }

  const relPath = 'rcf/manifest.json';
  const validation = validateDocument({ doc: nextManifest, kind: 'manifest', filePath: relPath });
  if (validation) return validation;

  const absPath = join(projectRoot, 'rcf', 'manifest.json');
  if (options.dryRun) {
    return { record, optOutIds: optOuts.map((o) => o.id), skippedUiBaseline: true, dryRun: true };
  }
  try {
    await mkdir(dirname(absPath), { recursive: true });
    const tmp = `${absPath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
    try {
      await rename(tmp, absPath);
    } catch (err) {
      try { await unlink(tmp); } catch { /* ignore */ }
      throw err;
    }
  } catch (err) {
    return rcfError({
      kind: 'ioFailure',
      message: `preflight: manifest write failed: ${err.message}`,
      filePath: relPath,
      stack: err.stack,
    });
  }
  return {
    record,
    optOutIds: optOuts.map((o) => o.id),
    // Track A does NOT build the uiBaseline init machinery (that's
    // Track B). When a design-shape answer would write into
    // `uiBaseline.defaults.authFlow.htmlLoginPageRequired` and no
    // `uiBaseline` record exists yet, the answer stays in
    // designShapeAnswers[] and (when the answer is API-only) in the
    // baselineAcOptOuts[] ledger, exactly as ADDENDUM §A.2 specifies.
    // The uiBaseline write itself is fenced pending Track B — the
    // linkedPreFlightConfigRef on the opt-out record is the seam
    // Track B reads.
    skippedUiBaseline: true,
  };
}

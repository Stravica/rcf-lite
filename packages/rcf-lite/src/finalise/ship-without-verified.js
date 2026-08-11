// Ship-without-verified acknowledgement writer
// (verification-integrity-cluster-spec section 5.2, review finding B-1).
//
// When `rcf finalise --ship-without-verified` acknowledges MOCK-ONLY-DECLARED
// or BLOCKED-BY-DECLARATION per-AC verdicts on a verify report and leaves
// the FBS at 'complete' (spec section 5.2), the ack lands on the manifest
// under the optional `shipWithoutVerified[]` array added in
// @stravica-ai/rcf-schemas 0.4.1. Stdout is not durable and not greppable
// at ship time; the manifest record is both. Schema shape:
//
//   { id: swv-<fbsId>-<n>, fbsId, ackedAt,
//     declaredAcs[{acId, verdict, reason?}], reportPath }
//
// Id allocation mirrors reviewAudit's `ra-<fbsId>-<n>` monotonic pattern
// (packages/build/src/review/index.js:nextReviewAuditId) so a re-ack of
// the same FBS increments deterministically.

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { rcfError } from '#core/errors';
import { validateDocument } from '#core/store';

/**
 * @typedef {object} ShipWithoutVerifiedDeclaredAc
 * @property {string} acId
 * @property {'MOCK-ONLY-DECLARED'|'BLOCKED-BY-DECLARATION'} verdict
 * @property {string} [reason]
 */

/**
 * @typedef {object} ShipWithoutVerifiedRecord
 * @property {string} id            `swv-<fbsId>-<n>` monotonic per FBS.
 * @property {string} fbsId
 * @property {string} ackedAt       ISO timestamp.
 * @property {ShipWithoutVerifiedDeclaredAc[]} declaredAcs  minItems 1.
 * @property {string} reportPath
 */

/**
 * Monotonic id allocator for the shipWithoutVerified array. Mirrors
 * `nextReviewAuditId` (review/index.js).
 *
 * @param {object|null} manifest
 * @param {string} fbsId
 * @returns {string}
 */
export function nextShipWithoutVerifiedId(manifest, fbsId) {
  const prefix = `swv-${fbsId}-`;
  const existing = Array.isArray(manifest?.shipWithoutVerified) ? manifest.shipWithoutVerified : [];
  let maxN = 0;
  for (const rec of existing) {
    if (typeof rec?.id !== 'string' || !rec.id.startsWith(prefix)) continue;
    const n = Number.parseInt(rec.id.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > maxN) maxN = n;
  }
  return `${prefix}${maxN + 1}`;
}

/**
 * Compose the record. Timestamps at UTC ISO.
 *
 * @param {object} args
 * @param {object|null} args.manifest
 * @param {string} args.fbsId
 * @param {ShipWithoutVerifiedDeclaredAc[]} args.declaredAcs
 * @param {string} args.reportPath
 * @param {Date} [args.now]
 * @returns {ShipWithoutVerifiedRecord}
 */
export function composeShipWithoutVerifiedRecord({
  manifest, fbsId, declaredAcs, reportPath, now = new Date(),
}) {
  return {
    id: nextShipWithoutVerifiedId(manifest, fbsId),
    fbsId,
    ackedAt: now.toISOString(),
    declaredAcs: declaredAcs.map((a) => {
      const out = { acId: a.acId, verdict: a.verdict };
      if (typeof a.reason === 'string' && a.reason.length > 0) out.reason = a.reason;
      return out;
    }),
    reportPath,
  };
}

/**
 * Persist a ship-without-verified acknowledgement onto the manifest.
 * Reads `tree.manifest` for the current state, appends the composed
 * record to `manifest.shipWithoutVerified[]`, validates the composed
 * manifest against the 0.4.1 schema, and writes it atomically. On
 * validation failure the on-disk manifest is untouched (mirrors the
 * preflight manifest-writer discipline).
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {object} args.tree
 * @param {ShipWithoutVerifiedRecord} args.record
 * @returns {Promise<{ record: ShipWithoutVerifiedRecord } | import('#core/errors').RcfError>}
 */
export async function writeShipWithoutVerifiedRecord({ projectRoot, tree, record }) {
  const manifest = tree.manifest ?? {};
  const nextManifest = { ...manifest };
  const existing = Array.isArray(nextManifest.shipWithoutVerified) ? nextManifest.shipWithoutVerified : [];
  nextManifest.shipWithoutVerified = [...existing, record];

  const relPath = 'rcf/manifest.json';
  const validation = validateDocument({ doc: nextManifest, kind: 'manifest', filePath: relPath });
  if (validation) return validation;

  const absPath = join(projectRoot, 'rcf', 'manifest.json');
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
      message: `finalise: ship-without-verified manifest write failed: ${err.message}`,
      filePath: relPath,
      stack: err.stack,
    });
  }
  return { record };
}

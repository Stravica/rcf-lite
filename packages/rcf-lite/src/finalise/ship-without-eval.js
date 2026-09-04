// Ship-without-eval acknowledgement writer. Sister of
// ship-without-verified.js. rcf-eval-node spec 2026-09-04 sections 5.2
// and 8: `rcf finalise --ship-without-eval "<reason>"` acknowledges
// EVAL-MISSING / EVAL-BELOW-THRESHOLD per-AC verdicts on a verify
// report and lets finalise proceed with an audit-log entry.
//
// Landing shape mirrors ship-without-verified: an optional
// `shipWithoutEval[]` array on the manifest, with monotonic ids
// `swe-<fbsId>-<n>`, the operator's reason string, the declared AC
// verdicts, the report path, and an ISO timestamp. rcf-schemas 0.6.0
// does not yet declare this field on the manifest schema; consumers
// treat its absence as "no acks" and its presence as data.

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { rcfError } from '#core/errors';

/**
 * @typedef {object} ShipWithoutEvalDeclaredAc
 * @property {string} acId
 * @property {'EVAL-MISSING'|'EVAL-BELOW-THRESHOLD'} verdict
 * @property {string} [reason]  reason as reported by the verdict layer
 */

/**
 * @typedef {object} ShipWithoutEvalRecord
 * @property {string} id            `swe-<fbsId>-<n>` monotonic per FBS.
 * @property {string} fbsId
 * @property {string} ackedAt       ISO timestamp.
 * @property {string} reason        operator-supplied reason (--ship-without-eval "…").
 * @property {ShipWithoutEvalDeclaredAc[]} declaredAcs  minItems 1.
 * @property {string} reportPath
 */

/**
 * Monotonic id allocator for the shipWithoutEval array. Mirrors
 * `nextShipWithoutVerifiedId` (ship-without-verified.js).
 *
 * @param {object|null} manifest
 * @param {string} fbsId
 * @returns {string}
 */
export function nextShipWithoutEvalId(manifest, fbsId) {
  const prefix = `swe-${fbsId}-`;
  const existing = Array.isArray(manifest?.shipWithoutEval) ? manifest.shipWithoutEval : [];
  let maxN = 0;
  for (const rec of existing) {
    if (typeof rec?.id !== 'string' || !rec.id.startsWith(prefix)) continue;
    const n = Number.parseInt(rec.id.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > maxN) maxN = n;
  }
  return `${prefix}${maxN + 1}`;
}

/**
 * Compose the ack record.
 *
 * @param {object} args
 * @param {object|null} args.manifest
 * @param {string} args.fbsId
 * @param {string} args.reason
 * @param {ShipWithoutEvalDeclaredAc[]} args.declaredAcs
 * @param {string} args.reportPath
 * @param {Date} [args.now]
 * @returns {ShipWithoutEvalRecord}
 */
export function composeShipWithoutEvalRecord({
  manifest, fbsId, reason, declaredAcs, reportPath, now = new Date(),
}) {
  return {
    id: nextShipWithoutEvalId(manifest, fbsId),
    fbsId,
    ackedAt: now.toISOString(),
    reason,
    declaredAcs: declaredAcs.map((a) => {
      const out = { acId: a.acId, verdict: a.verdict };
      if (typeof a.reason === 'string' && a.reason.length > 0) out.reason = a.reason;
      return out;
    }),
    reportPath,
  };
}

/**
 * Persist a ship-without-eval acknowledgement onto the manifest.
 * Manifest write is atomic (tmp + rename). rcf-schemas 0.6.0's manifest
 * schema does not declare this field, so the write path skips the
 * validator (spec section 9: extensions land at a later minor).
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {object} args.tree
 * @param {ShipWithoutEvalRecord} args.record
 * @returns {Promise<{ record: ShipWithoutEvalRecord } | import('#core/errors').RcfError>}
 */
export async function writeShipWithoutEvalRecord({ projectRoot, tree, record }) {
  const manifest = tree.manifest ?? {};
  const nextManifest = { ...manifest };
  const existing = Array.isArray(nextManifest.shipWithoutEval) ? nextManifest.shipWithoutEval : [];
  nextManifest.shipWithoutEval = [...existing, record];

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
      message: `finalise: ship-without-eval manifest write failed: ${err.message}`,
      filePath: 'rcf/manifest.json',
      stack: err.stack,
    });
  }
  return { record };
}

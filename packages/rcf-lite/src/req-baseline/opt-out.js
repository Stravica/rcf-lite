// Baseline-AC opt-out ledger (spec §5.4).
//
// Writes and removes entries on manifest.baselineAcOptOuts[]. Composes
// with the design-shape answer opt-out surface that Track A owns
// (preflight/manifest-writer.js already carries composeOptOutRecord for
// the preflight-driven case); this module is the C+D-native writer for
// operator rulings recorded outside a preflight session.
//
// Both surfaces write to the same array; both use the same
// boo-YYYY-MM-DD-NNN monotonic id scheme so id collisions across
// surfaces are impossible.

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { rcfError, isRcfError } from '#core/errors';
import { validateDocument } from '#core/store';

const OPT_OUT_ID_RE = /^boo-\d{4}-\d{2}-\d{2}-(\d{3})$/;

/**
 * Compose the next monotonic opt-out id for the current date. Reads the
 * existing manifest to find the max NNN suffix for the same YYYY-MM-DD.
 *
 * @param {object|null} manifest
 * @param {Date} [now]
 * @returns {string}
 */
export function nextOptOutId(manifest, now = new Date()) {
  const yyyy = now.getUTCFullYear().toString().padStart(4, '0');
  const mm = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = now.getUTCDate().toString().padStart(2, '0');
  const prefix = `boo-${yyyy}-${mm}-${dd}-`;
  const existing = Array.isArray(manifest?.baselineAcOptOuts) ? manifest.baselineAcOptOuts : [];
  let maxN = 0;
  for (const rec of existing) {
    if (typeof rec?.id !== 'string') continue;
    const m = rec.id.match(OPT_OUT_ID_RE);
    if (!m) continue;
    if (!rec.id.startsWith(prefix)) continue;
    const n = Number.parseInt(m[1], 10);
    if (Number.isFinite(n) && n > maxN) maxN = n;
  }
  return `${prefix}${(maxN + 1).toString().padStart(3, '0')}`;
}

/**
 * Compose a C+D-native opt-out record (no preflight linkage).
 *
 * @param {object} args
 * @param {object|null} args.manifest
 * @param {string} args.reqId
 * @param {string} args.baselineKey
 * @param {string} args.reason              minLength 20 (schema-enforced)
 * @param {'req'|'project'} [args.scope]    defaults to req
 * @param {Date} [args.now]
 * @returns {object}
 */
export function composeOptOutRecord({ manifest, reqId, baselineKey, reason, scope = 'req', now = new Date() }) {
  const isoNow = now.toISOString();
  const id = nextOptOutId(manifest, now);
  const record = {
    id,
    createdAt: isoNow,
    baselineKey,
    scope,
    reason,
    operatorAckAt: isoNow,
  };
  if (scope === 'req') record.reqId = reqId;
  return record;
}

/**
 * Write a new opt-out record atomically.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('#core/store/walker.js').TreeModel} args.tree
 * @param {string} args.reqId
 * @param {string} args.baselineKey
 * @param {string} args.reason
 * @param {'req'|'project'} [args.scope]
 * @param {Date} [args.now]
 * @returns {Promise<{ id: string, record: object } | import('#core/errors').RcfError>}
 */
export async function writeOptOut({ projectRoot, tree, reqId, baselineKey, reason, scope = 'req', now = new Date() }) {
  const manifest = tree?.manifest ?? {};
  const record = composeOptOutRecord({ manifest, reqId, baselineKey, reason, scope, now });
  const nextManifest = {
    ...manifest,
    baselineAcOptOuts: [
      ...(Array.isArray(manifest.baselineAcOptOuts) ? manifest.baselineAcOptOuts : []),
      record,
    ],
  };
  const validation = validateDocument({ doc: nextManifest, kind: 'manifest', filePath: 'rcf/manifest.json' });
  if (validation) return validation;
  const abs = join(projectRoot, 'rcf', 'manifest.json');
  try {
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.tmp`;
    await writeFile(tmp, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
    try {
      await rename(tmp, abs);
    } catch (err) {
      try { await unlink(tmp); } catch { /* ignore */ }
      throw err;
    }
  } catch (err) {
    return rcfError({
      kind: 'ioFailure',
      message: `req-baseline opt-out: manifest write failed: ${err.message}`,
      filePath: 'rcf/manifest.json',
      stack: err.stack,
    });
  }
  return { id: record.id, record };
}

/**
 * Remove any existing opt-out matching the reqId/baselineKey. Deletes
 * both req-scoped and project-scoped matches for the same baselineKey
 * so a stale opt-out cannot linger.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('#core/store/walker.js').TreeModel} args.tree
 * @param {string} args.reqId
 * @param {string} args.baselineKey
 * @returns {Promise<{ removed: number } | import('#core/errors').RcfError>}
 */
export async function removeOptOut({ projectRoot, tree, reqId, baselineKey }) {
  const manifest = tree?.manifest ?? {};
  const existing = Array.isArray(manifest.baselineAcOptOuts) ? manifest.baselineAcOptOuts : [];
  const remaining = existing.filter((r) => !(r?.baselineKey === baselineKey && (r?.scope === 'project' || r?.reqId === reqId)));
  const removed = existing.length - remaining.length;
  if (removed === 0) return { removed: 0 };
  const nextManifest = { ...manifest, baselineAcOptOuts: remaining };
  const validation = validateDocument({ doc: nextManifest, kind: 'manifest', filePath: 'rcf/manifest.json' });
  if (validation) return validation;
  const abs = join(projectRoot, 'rcf', 'manifest.json');
  try {
    const tmp = `${abs}.tmp`;
    await writeFile(tmp, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
    try {
      await rename(tmp, abs);
    } catch (err) {
      try { await unlink(tmp); } catch { /* ignore */ }
      throw err;
    }
  } catch (err) {
    return rcfError({
      kind: 'ioFailure',
      message: `req-baseline opt-out --remove: manifest write failed: ${err.message}`,
      filePath: 'rcf/manifest.json',
      stack: err.stack,
    });
  }
  return { removed };
}

/**
 * Build a Set of baselineKeys opted out for a given REQ.
 *
 * @param {object|null} manifest
 * @param {string} reqId
 * @returns {Set<string>}
 */
export function optOutMap(manifest, reqId) {
  const entries = Array.isArray(manifest?.baselineAcOptOuts) ? manifest.baselineAcOptOuts : [];
  const out = new Set();
  for (const r of entries) {
    if (!r || typeof r.baselineKey !== 'string') continue;
    if (r.scope === 'project') out.add(r.baselineKey);
    else if (r.scope === 'req' && r.reqId === reqId) out.add(r.baselineKey);
  }
  return out;
}

/**
 * Convenience predicate.
 *
 * @param {object|null} manifest
 * @param {string} reqId
 * @param {string} baselineKey
 * @returns {boolean}
 */
export function isOptedOut(manifest, reqId, baselineKey) {
  return optOutMap(manifest, reqId).has(baselineKey);
}

// Kept exported for consumers that need the RcfError predicate alongside
// the writer helpers.
void isRcfError;

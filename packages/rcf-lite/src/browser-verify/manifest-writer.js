// Browser-verification record composer + writer
// (ui-design-gate-0.7.0-spec §3.3, §8).

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { rcfError } from '#core/errors';
import { validateDocument } from '#core/store';

/**
 * Compute the next `bv-<fbsId>-<n>` id: monotonic per FBS.
 *
 * @param {object|null} manifest
 * @param {string} fbsId
 * @returns {string}
 */
export function nextBrowserVerificationId(manifest, fbsId) {
  const prefix = `bv-${fbsId}-`;
  const existing = Array.isArray(manifest?.browserVerification) ? manifest.browserVerification : [];
  let maxN = 0;
  for (const rec of existing) {
    if (typeof rec?.id !== 'string' || !rec.id.startsWith(prefix)) continue;
    const n = Number.parseInt(rec.id.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > maxN) maxN = n;
  }
  return `${prefix}${maxN + 1}`;
}

/**
 * Aggregate the record verdict per spec §8.5:
 *   block if any invariant severity=block verdict=fail, OR any auth smoke fail;
 *   warn if any invariant severity=warn verdict=fail (and no block);
 *   pass otherwise.
 *
 * @param {Array<{ invariant: string, verdict: 'pass'|'warn'|'fail', severity: 'block'|'warn'|'advisory' }>} invariantChecks
 * @param {Array<{ verdict: 'pass'|'warn'|'fail' }>} authSmokeChecks
 * @returns {'pass'|'warn'|'block'}
 */
export function aggregateVerdict(invariantChecks, authSmokeChecks) {
  for (const check of invariantChecks) {
    if (check.severity === 'block' && check.verdict === 'fail') return 'block';
  }
  for (const check of authSmokeChecks ?? []) {
    if (check.verdict === 'fail') return 'block';
  }
  for (const check of invariantChecks) {
    if (check.severity === 'warn' && (check.verdict === 'fail' || check.verdict === 'warn')) return 'warn';
  }
  return 'pass';
}

/**
 * Compose a `browserVerification` record ready to append.
 *
 * @param {object} args
 * @param {object|null} args.manifest
 * @param {string} args.fbsId
 * @param {'operatorSession'|'agentScreenshotCritique'} args.mode
 * @param {'deployed'|'ci'|'local-dev'} args.runtimeProfile
 * @param {string} args.runtimeUrl
 * @param {Array<{ path: string, screenshotPath: string, themeApplied: 'light'|'dark' }>} args.routesChecked
 * @param {Array<{ invariant: string, verdict: 'pass'|'warn'|'fail', detail?: string, severity: 'block'|'warn'|'advisory' }>} args.invariantChecks
 * @param {Array<{ check: string, status?: number, contentType?: string, verdict: 'pass'|'warn'|'fail', detail?: string }>} [args.authSmokeChecks]
 * @param {string} [args.notes]
 * @param {Date} [args.now]
 * @returns {object}
 */
export function composeBrowserVerificationRecord({
  manifest, fbsId, mode, runtimeProfile, runtimeUrl, routesChecked,
  invariantChecks, authSmokeChecks = [], notes, now = new Date(),
}) {
  const id = nextBrowserVerificationId(manifest, fbsId);
  const verdict = aggregateVerdict(invariantChecks, authSmokeChecks);
  const record = {
    id,
    fbsId,
    createdAt: now.toISOString(),
    mode,
    runtimeProfile,
    runtimeUrl,
    routesChecked: routesChecked.map((r) => ({ path: r.path, screenshotPath: r.screenshotPath, themeApplied: r.themeApplied })),
    invariantChecks: invariantChecks.map((c) => stripSeverity(c)),
    verdict,
  };
  if (authSmokeChecks && authSmokeChecks.length > 0) record.authSmokeChecks = authSmokeChecks;
  if (typeof notes === 'string' && notes.length > 0) record.notes = notes;
  return record;
}

function stripSeverity(check) {
  const out = { invariant: check.invariant, verdict: check.verdict };
  if (typeof check.detail === 'string' && check.detail.length > 0) out.detail = check.detail;
  return out;
}

/**
 * Persist a composed `browserVerification` record on the manifest.
 * Atomic tmp-and-rename, schema-validated before write.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('#core/store/walker.js').TreeModel} args.tree
 * @param {object} args.record
 * @param {object} [args.options]
 * @returns {Promise<{ record: object } | import('#core/errors').RcfError>}
 */
export async function writeBrowserVerificationRecord({ projectRoot, tree, record, options = {} }) {
  const manifest = tree.manifest ?? {};
  const nextManifest = { ...manifest };
  const existing = Array.isArray(nextManifest.browserVerification) ? nextManifest.browserVerification : [];
  nextManifest.browserVerification = [...existing, record];

  const relPath = 'rcf/manifest.json';
  const validation = validateDocument({ doc: nextManifest, kind: 'manifest', filePath: relPath });
  if (validation) return validation;

  if (options.dryRun) return { record, dryRun: true };

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
      message: `browser-verify: manifest write failed: ${err.message}`,
      filePath: relPath,
      stack: err.stack,
    });
  }
  return { record };
}

/**
 * Append `operatorAckAt` or `operatorShipDespiteBlockReason` to the
 * latest `browserVerification` record for a FBS.
 *
 * @param {object} args
 * @returns {Promise<{ record: object } | import('#core/errors').RcfError>}
 */
export async function writeBrowserVerificationAck({
  projectRoot, tree, fbsId, operatorAckAt, operatorShipDespiteBlockReason, now = new Date(),
}) {
  const manifest = tree.manifest ?? {};
  const records = Array.isArray(manifest.browserVerification) ? manifest.browserVerification : [];
  const latestIdx = findLatestRecordIndex(records, fbsId);
  if (latestIdx < 0) {
    return rcfError({
      kind: 'usage',
      message: `browser-verify --ack: no browserVerification record exists for ${fbsId} yet.`,
    });
  }
  const isoNow = now.toISOString();
  const nextManifest = { ...manifest };
  const next = [...records];
  const target = { ...next[latestIdx] };
  if (operatorAckAt) target.operatorAckAt = operatorAckAt === true ? isoNow : String(operatorAckAt);
  if (operatorShipDespiteBlockReason) target.operatorShipDespiteBlockReason = operatorShipDespiteBlockReason;
  next[latestIdx] = target;
  nextManifest.browserVerification = next;
  const relPath = 'rcf/manifest.json';
  const validation = validateDocument({ doc: nextManifest, kind: 'manifest', filePath: relPath });
  if (validation) return validation;
  const absPath = join(projectRoot, 'rcf', 'manifest.json');
  try {
    await mkdir(dirname(absPath), { recursive: true });
    const tmp = `${absPath}.tmp`;
    await writeFile(tmp, `${JSON.stringify(nextManifest, null, 2)}\n`, 'utf8');
    try { await rename(tmp, absPath); } catch (err) {
      try { await unlink(tmp); } catch { /* ignore */ }
      throw err;
    }
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `browser-verify --ack: manifest write failed: ${err.message}`, filePath: relPath, stack: err.stack });
  }
  return { record: target };
}

function findLatestRecordIndex(records, fbsId) {
  for (let i = records.length - 1; i >= 0; i -= 1) if (records[i]?.fbsId === fbsId) return i;
  return -1;
}

// UI-baseline manifest writer (ui-design-gate-0.7.0-spec §3.2, §5.4).
//
// Owns id allocation (`uib-YYYY-MM-DD-NNN` monotonic per project),
// atomic tmp-and-rename write against `rcf/manifest.json`, and
// `uiBaselineHistory[]` folding on `--reset`. Every field is optional
// on the schema; the enforcement happens via the interactive session
// walking every field before writing `operatorAckAt`.
//
// The preflight seam (spec §3.2 + Track A preflight `skippedUiBaseline`
// note): when the operator ratifies a `uiBaseline`, we look up
// preflight-recorded design-shape answers whose `uiBaselineWritePath`
// targets `defaults.*` and apply the deferred writes automatically.
// Only APPLIED once (idempotent): the corresponding
// `baselineAcOptOuts[]` entries stay in place as the durable ledger;
// the seam itself is one-way from preflight into the baseline defaults.

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { rcfError } from '@stravica-ai/rcf-lite-core/errors';
import { validateDocument } from '@stravica-ai/rcf-lite-core/store';

import { composeDefaults, deepGet, deepSet } from './defaults.js';
import { CATALOGUE_V1 } from '../preflight/design-shapes.js';

/**
 * Compute the next `uib-YYYY-MM-DD-NNN` id: monotonic per project.
 *
 * @param {object|null} manifest
 * @param {Date} now
 * @returns {string}
 */
export function nextUiBaselineId(manifest, now) {
  const y = now.getUTCFullYear().toString().padStart(4, '0');
  const m = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = now.getUTCDate().toString().padStart(2, '0');
  const prefix = `uib-${y}-${m}-${d}-`;
  const active = manifest?.uiBaseline?.id;
  const history = Array.isArray(manifest?.uiBaselineHistory) ? manifest.uiBaselineHistory : [];
  const ids = [active, ...history.map((h) => h?.id)].filter((id) => typeof id === 'string' && id.startsWith(prefix));
  let maxN = 0;
  for (const id of ids) {
    const n = Number.parseInt(id.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > maxN) maxN = n;
  }
  return `${prefix}${(maxN + 1).toString().padStart(3, '0')}`;
}

/**
 * Compose a fresh `uiBaseline` record. Applies preflight seam pickups
 * (spec §3.2) that would otherwise sit fenced in preflight's
 * `skippedUiBaseline` seam, plus any operator-supplied opt-outs.
 *
 * @param {object} args
 * @param {object|null} args.manifest
 * @param {string} args.prdId
 * @param {Array<{ field: string, reason: string }>} [args.optOuts]
 * @param {object} [args.overrides]  dot-path -> value overrides (e.g. from preflight seam)
 * @param {Date} [args.now]
 * @returns {object}
 */
export function composeUiBaselineRecord({
  manifest, prdId, optOuts = [], overrides = {}, now = new Date(),
}) {
  const isoNow = now.toISOString();
  const id = nextUiBaselineId(manifest, now);
  const defaults = composeDefaults(overrides);
  const record = {
    id,
    createdAt: isoNow,
    prdId,
    defaults,
    operatorAckAt: isoNow,
  };
  if (optOuts.length > 0) {
    record.operatorOptOuts = optOuts.map((o) => ({
      field: o.field,
      reason: o.reason,
      operatorAckAt: isoNow,
    }));
  }
  return record;
}

/**
 * Given a manifest and its preFlightConfig[] record set, collect the
 * dot-path overrides the preflight design-shape answers imply for
 * `uiBaseline.defaults`. Idempotent seam: the answers stay in
 * preflight; the values land as defaults on baseline creation.
 *
 * Generalised (Track B review N-4): reads
 * `uiBaselineWritePath` + `uiBaselineWriteValue` off the catalogue's
 * per-choice metadata rather than hard-coding a single question id. Any
 * answered question whose selected choice carries a write path targeting
 * `defaults.*` lands as a seeded override; newest ratification wins.
 * A future Track C+D catalogue addition that names its own write path
 * flows through this seam without any wiring change here.
 *
 * The catalogue is injectable for tests via the second argument; in
 * production, callers use the default `CATALOGUE_V1` import.
 *
 * @param {object|null} manifest
 * @param {Readonly<import('../preflight/design-shapes.js').DesignShapeQuestion[]>} [catalogue]
 * @returns {object} dot-path -> value overrides (relative to `defaults`)
 */
export function preflightSeamOverrides(manifest, catalogue = CATALOGUE_V1) {
  const overrides = {};
  const questionsById = new Map();
  for (const q of Array.isArray(catalogue) ? catalogue : []) {
    if (q?.id) questionsById.set(q.id, q);
  }
  const records = Array.isArray(manifest?.preFlightConfig) ? manifest.preFlightConfig : [];
  // Walk newest-first so a later ratification wins over an earlier one.
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const rec = records[i];
    const answers = Array.isArray(rec?.designShapeAnswers) ? rec.designShapeAnswers : [];
    for (const answer of answers) {
      const question = questionsById.get(answer?.questionId);
      if (!question) continue;
      const choice = Array.isArray(question.choices)
        ? question.choices.find((c) => c?.value === answer?.answer)
        : null;
      if (!choice) continue;
      const writePath = typeof choice.uiBaselineWritePath === 'string' ? choice.uiBaselineWritePath : null;
      if (!writePath) continue;
      // Strip the `defaults.` prefix (the write path is authored against
      // the uiBaseline record; the seam applies against the defaults
      // subtree, so the prefix is dropped here).
      const key = writePath.startsWith('defaults.') ? writePath.slice('defaults.'.length) : writePath;
      if (overrides[key] === undefined) {
        overrides[key] = choice.uiBaselineWriteValue;
      }
    }
  }
  return overrides;
}

/**
 * Persist a composed `uiBaseline` record. When a previous baseline
 * exists and `options.reset` is true, the previous record is appended
 * to `uiBaselineHistory[]` (spec §12 O-4).
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('@stravica-ai/rcf-lite-core/store/walker.js').TreeModel} args.tree
 * @param {object} args.record
 * @param {object} [args.options]
 * @returns {Promise<{ record: object } | import('@stravica-ai/rcf-lite-core/errors').RcfError>}
 */
export async function writeUiBaselineRecord({
  projectRoot, tree, record, options = {},
}) {
  const manifest = tree.manifest ?? {};
  const nextManifest = { ...manifest };
  const priorBaseline = nextManifest.uiBaseline ?? null;

  if (priorBaseline && options.reset) {
    const history = Array.isArray(nextManifest.uiBaselineHistory) ? nextManifest.uiBaselineHistory : [];
    nextManifest.uiBaselineHistory = [...history, priorBaseline];
  }
  nextManifest.uiBaseline = record;

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
      message: `ui-baseline: manifest write failed: ${err.message}`,
      filePath: relPath,
      stack: err.stack,
    });
  }
  return { record };
}

/**
 * Append an opt-out entry to an existing `uiBaseline` record. Refuses
 * when no baseline exists (the operator must init first) or the field
 * path is not a known baseline field.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('@stravica-ai/rcf-lite-core/store/walker.js').TreeModel} args.tree
 * @param {string} args.field   dot-path into defaults (or `defaults.<...>`; both accepted)
 * @param {string} args.reason  operator's plain-text ruling
 * @param {(path: string) => boolean} [args.isKnownField]
 * @param {Date} [args.now]
 * @returns {Promise<{ record: object } | import('@stravica-ai/rcf-lite-core/errors').RcfError>}
 */
export async function writeUiBaselineOptOut({
  projectRoot, tree, field, reason, isKnownField, now = new Date(),
}) {
  const manifest = tree.manifest ?? {};
  const priorBaseline = manifest.uiBaseline;
  if (!priorBaseline) {
    return rcfError({
      kind: 'usage',
      message: 'ui-baseline opt-out: no uiBaseline record exists yet; run \'rcf ui-baseline init\' first.',
    });
  }
  const normalisedField = String(field).startsWith('defaults.') ? String(field).slice('defaults.'.length) : String(field);
  if (typeof isKnownField === 'function' && !isKnownField(normalisedField)) {
    return rcfError({
      kind: 'usage',
      message: `ui-baseline opt-out: unknown baseline field '${normalisedField}' (see 'rcf ui-baseline show' for the field list).`,
    });
  }
  const isoNow = now.toISOString();
  const nextManifest = { ...manifest };
  const nextRecord = { ...priorBaseline };
  const existing = Array.isArray(nextRecord.operatorOptOuts) ? nextRecord.operatorOptOuts : [];
  nextRecord.operatorOptOuts = [
    ...existing.filter((o) => o.field !== normalisedField),
    { field: normalisedField, reason, operatorAckAt: isoNow },
  ];
  nextManifest.uiBaseline = nextRecord;

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
      message: `ui-baseline opt-out: manifest write failed: ${err.message}`,
      filePath: relPath,
      stack: err.stack,
    });
  }
  return { record: nextRecord };
}

/**
 * True when a value in the baseline's `defaults` disagrees with a
 * value on a FBS's `designStage`. Used by the design-mark-complete gate.
 * Returns null on agreement or when no opinion is expressible; returns
 * `{ path, baselineValue, designValue }` on disagreement.
 *
 * @param {object|null} baseline
 * @param {object|null} designStage
 * @param {string} path  dot-path relative to `defaults` (e.g. `themeMode`)
 * @param {string} designStagePath  dot-path relative to `designStage` (e.g. `themeAndA11y.themeMode`)
 * @returns {{ path: string, baselineValue: *, designValue: * }|null}
 */
export function baselineDesignDisagreement(baseline, designStage, path, designStagePath) {
  if (!baseline || !designStage) return null;
  const baselineValue = deepGet(baseline.defaults ?? {}, path);
  const designValue = deepGet(designStage, designStagePath);
  if (baselineValue === undefined || designValue === undefined) return null;
  const optOuts = Array.isArray(baseline.operatorOptOuts) ? baseline.operatorOptOuts : [];
  if (optOuts.some((o) => o.field === path)) return null;
  if (baselineValue === designValue) return null;
  return { path, baselineValue, designValue };
}

export { deepSet, deepGet };

// Baseline-AC catalog - single source of truth for the five REQ-shape
// baseline sets defined in Track C+D §5.2 of the
// elicitation-and-playbook-hardening-0.7.0 spec.
//
// Consumed by `packages/build/src/req-baseline/` (Track C+D injection
// mechanism, spec §5.3): the build package reads a shape's baseline set
// here, then writes each entry into a US as an AC with
// `provenance.authoredBy: baseline` and `provenance.baselineKey` set to
// the catalog entry's `baselineKey`.
//
// Data-side loading: each set is stored as a JSON file under `./data/`,
// with entries in canonical spec order. The canonical AC text is the
// primary load-bearing record; `given`, `when`, `then` are mechanical
// decompositions of the canonical sentence for build's convenience, and
// `notes` captures any trailing commentary the spec attached to the entry
// (kept verbatim; not part of the AC proper).
//
// The catalog is FROZEN at module load - consumers cannot mutate the
// shared source.

import webUiSet from './data/web-ui.json' with { type: 'json' };
import httpApiSet from './data/http-api.json' with { type: 'json' };
import authSet from './data/auth.json' with { type: 'json' };
import persistenceSet from './data/persistence.json' with { type: 'json' };
import notificationsSet from './data/notifications.json' with { type: 'json' };

/**
 * @typedef {'webUi'|'httpApi'|'auth'|'persistence'|'notifications'} BaselineShape
 */

/**
 * @typedef {object} BaselineCatalogEntry
 * @property {string} baselineKey        e.g. `webUi.sharedNav`; unique across shapes
 * @property {string} canonicalText      the verbatim spec §5.2 sentence, load-bearing
 * @property {string} given              mechanical extract from canonicalText
 * @property {string} when               mechanical extract from canonicalText
 * @property {string} then               mechanical extract from canonicalText
 * @property {string|null} notes         verbatim trailing commentary from the spec, or null
 * @property {boolean} testable          always true; every catalog AC is testable
 */

/**
 * @typedef {object} BaselineCatalogSet
 * @property {BaselineShape} sourceReqShape
 * @property {string} specSource
 * @property {BaselineCatalogEntry[]} entries
 */

function freezeSet(set) {
  return Object.freeze({
    sourceReqShape: set.sourceReqShape,
    specSource: set.specSource,
    entries: Object.freeze(set.entries.map((entry) => Object.freeze({ ...entry }))),
  });
}

/**
 * The full catalog, one set per REQ shape.
 *
 * @type {Readonly<Record<BaselineShape, BaselineCatalogSet>>}
 */
export const BASELINE_CATALOG_V1 = Object.freeze({
  webUi: freezeSet(webUiSet),
  httpApi: freezeSet(httpApiSet),
  auth: freezeSet(authSet),
  persistence: freezeSet(persistenceSet),
  notifications: freezeSet(notificationsSet),
});

/**
 * Canonical shape ordering (matches spec §4.2). Consumers that iterate the
 * catalog use this so display order stays stable.
 */
export const BASELINE_SHAPE_KEYS = Object.freeze(
  ['webUi', 'httpApi', 'auth', 'persistence', 'notifications'],
);

/**
 * Return the baseline set for a shape, or null if the shape carries no
 * baseline entries. `none` is a legitimate REQ shape with no injections
 * (spec §4.2); calling `getBaselineSet('none')` returns null.
 *
 * @param {string} shape
 * @returns {BaselineCatalogSet|null}
 */
export function getBaselineSet(shape) {
  return BASELINE_CATALOG_V1[shape] ?? null;
}

/**
 * Look up a single catalog entry by its `baselineKey`. Returns null if the
 * key is unknown. Rarely used directly; consumers usually iterate a whole
 * set. Kept exported so tests and audit tooling can spot-check a specific
 * key without walking every set.
 *
 * @param {string} baselineKey
 * @returns {BaselineCatalogEntry|null}
 */
export function getBaselineEntry(baselineKey) {
  for (const key of BASELINE_SHAPE_KEYS) {
    const set = BASELINE_CATALOG_V1[key];
    for (const entry of set.entries) {
      if (entry.baselineKey === baselineKey) return entry;
    }
  }
  return null;
}

/**
 * Iterate every catalog entry across every shape, in canonical order.
 * Useful for audit passes (e.g. lint every canonical AC text for banned
 * patterns) and for tests.
 *
 * @returns {Generator<{ shape: BaselineShape, entry: BaselineCatalogEntry }, void, undefined>}
 */
export function* iterateBaselineEntries() {
  for (const shape of BASELINE_SHAPE_KEYS) {
    const set = BASELINE_CATALOG_V1[shape];
    for (const entry of set.entries) yield { shape, entry };
  }
}

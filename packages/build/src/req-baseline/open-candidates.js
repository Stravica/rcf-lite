// Open-sweep candidate tracker (spec §5.3 moment 4, §5.4 gate).
//
// The moment-4 posture: a non-interactive `rcf create us` under a
// classified REQ surfaces baseline keys that are neither present as
// ACs nor covered by an opt-out. This module answers "which USes have
// baselineKeys that are still OPEN?" without ever writing to disk.
//
// There is NO persisted sweep queue: `@stravica-ai/rcf-schemas`
// user-story.schema.json is `additionalProperties: false` and carries
// no `baselineSweepQueue` property, so writing one would fail schema
// validation. Openness is DERIVED from three facts read live per call:
// the parent REQ's `shapeClassification`, the US's own AC keys, and
// the manifest's `baselineAcOptOuts[]`. Spec §18 2026-07-31 fold
// ratifies the derivation as normative (replaces the earlier
// "auto-enqueue" wording).

import { getBaselineSet, getBaselineEntry, BASELINE_SHAPE_KEYS } from '@stravica-ai/rcf-lite-core/baseline-catalog';
import { optOutMap } from './opt-out.js';

/**
 * @typedef {object} OpenCandidate
 * @property {string} usId
 * @property {string} reqId
 * @property {string} baselineKey
 * @property {string} reqShape
 * @property {string} canonicalText
 */

/**
 * Enumerate open sweep candidates across the tree.
 *
 * A candidate is open when:
 *   - the parent REQ carries a `shapeClassification` with a non-empty
 *     shape list (excluding `none`);
 *   - a baseline key from any of those shapes is not present as an AC
 *     on the US (neither authoredBy: baseline nor operatorEdited with
 *     the same key);
 *   - no baselineAcOptOuts entry covers the key (req-scoped for this
 *     REQ, or project-scoped).
 *
 * Openness is derived per call from these three signals; there is no
 * persisted queue by ruling (spec §18 2026-07-31 fold; schema fence at
 * user-story additionalProperties:false).
 *
 * Note the caller may pass reqId to narrow to one REQ.
 *
 * @param {import('@stravica-ai/rcf-lite-core/store/walker.js').TreeModel} tree
 * @param {object} [opts]
 * @param {string|null} [opts.reqId]
 * @returns {Array<{ usId: string, reqId: string, baselineKeys: string[] }>}
 */
export function listOpenCandidates(tree, opts = {}) {
  const filterReq = opts.reqId ?? null;
  const results = [];
  for (const [id, kind] of tree.kindById) {
    if (kind !== 'userStory') continue;
    const us = tree.byId.get(id);
    if (!us) continue;
    if (filterReq && us.reqId !== filterReq) continue;
    const open = openCandidatesForUs(tree, us);
    if (open.length > 0) {
      results.push({ usId: id, reqId: us.reqId, baselineKeys: open.map((c) => c.baselineKey) });
    }
  }
  results.sort((a, b) => a.usId.localeCompare(b.usId));
  return results;
}

/**
 * Enumerate open candidates for one loaded US.
 *
 * @param {import('@stravica-ai/rcf-lite-core/store/walker.js').TreeModel} tree
 * @param {object} usDoc
 * @returns {OpenCandidate[]}
 */
export function openCandidatesForUs(tree, usDoc) {
  const reqDoc = tree?.byId?.get(usDoc?.reqId);
  const shapes = shapesOfReq(reqDoc);
  if (shapes.length === 0) return [];

  const acKeys = new Set();
  for (const ac of usDoc.acceptanceCriteria ?? []) {
    if (ac?.provenance?.baselineKey) acKeys.add(ac.provenance.baselineKey);
  }

  const optedOut = optOutMap(tree?.manifest ?? null, usDoc.reqId);

  const proposeAll = new Set();
  for (const shape of shapes) {
    const set = getBaselineSet(shape);
    if (!set) continue;
    for (const entry of set.entries) proposeAll.add(entry.baselineKey);
  }

  const results = [];
  for (const key of proposeAll) {
    if (acKeys.has(key)) continue;
    if (optedOut.has(key)) continue;
    const entry = getBaselineEntry(key);
    if (!entry) continue;
    // shape derived from entry's set (spec order: webUi > httpApi > auth
    // > persistence > notifications).
    const reqShape = shapeOfEntry(key);
    results.push({
      usId: usDoc.usId,
      reqId: usDoc.reqId,
      baselineKey: key,
      reqShape,
      canonicalText: entry.canonicalText,
    });
  }
  // Stable order by shape then by canonical order within the set.
  results.sort((a, b) => a.baselineKey.localeCompare(b.baselineKey));
  return results;
}

/**
 * True when the US has one or more open sweep candidates.
 *
 * @param {import('@stravica-ai/rcf-lite-core/store/walker.js').TreeModel} tree
 * @param {object} usDoc
 * @returns {boolean}
 */
export function usHasOpenCandidates(tree, usDoc) {
  return openCandidatesForUs(tree, usDoc).length > 0;
}

function shapesOfReq(reqDoc) {
  const shapes = reqDoc?.shapeClassification?.shapes;
  if (!Array.isArray(shapes)) return [];
  return shapes.filter((s) => s !== 'none');
}

function shapeOfEntry(baselineKey) {
  for (const shape of BASELINE_SHAPE_KEYS) {
    const set = getBaselineSet(shape);
    if (!set) continue;
    for (const entry of set.entries) {
      if (entry.baselineKey === baselineKey) return shape;
    }
  }
  return 'unknown';
}

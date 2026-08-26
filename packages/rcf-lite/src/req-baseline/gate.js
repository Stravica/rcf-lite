// Stage-1 refusal gate (spec §5.4).
//
// `rcf build --next` refuses to enter Build for any FBS binding an AC
// on a US that still has open baseline sweep candidates. The refusal
// message follows the canonical shape in spec §5.4.
//
// The gate itself is a pure function against the tree; the CLI layer
// calls it after selecting the next actionable FBS (see build.js).

import { openCandidatesForUs } from './open-candidates.js';

/**
 * @typedef {object} Stage1Refusal
 * @property {string} fbsId
 * @property {string} usId
 * @property {Array<{ baselineKey: string, canonicalText: string, reqShape: string }>} openCandidates
 * @property {string} reqId
 * @property {string} message   pre-formatted refusal, spec §5.4 shape
 */

/**
 * Inspect an FBS for a refusal condition. Walks the FBS's bound ACs to
 * their owning USes; any US with open baseline candidates fails the
 * gate. Returns null when the FBS is clear.
 *
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @param {string} fbsId
 * @returns {Stage1Refusal|null}
 */
export function fbsRefusalForOpenSweep(tree, fbsId) {
  const fbs = tree?.byId?.get(fbsId);
  if (!fbs) return null;
  const acIds = Array.isArray(fbs.acIds) ? fbs.acIds : [];
  const seenUsIds = new Set();
  for (const acId of acIds) {
    // AC ids are inline on the parent US; `walkTree` records the
    // AC-to-US mapping under `parentByChild` for exactly this lookup
    // (the `usByAcId` map on the render-side tree model is derived
    // from the same source).
    const usId = tree.parentByChild?.get(acId);
    if (!usId || seenUsIds.has(usId)) continue;
    seenUsIds.add(usId);
    const us = tree.byId.get(usId);
    if (!us) continue;
    const open = openCandidatesForUs(tree, us);
    if (open.length === 0) continue;
    return {
      fbsId,
      usId,
      reqId: us.reqId,
      openCandidates: open,
      message: formatStage1RefusalMessage({ fbsId, usId, reqId: us.reqId, openCandidates: open }),
    };
  }
  return null;
}

/**
 * Format the spec §5.4 refusal line for an operator.
 *
 * @param {object} args
 * @param {string} args.fbsId
 * @param {string} args.usId
 * @param {string} args.reqId
 * @param {Array<{ baselineKey: string, canonicalText: string }>} args.openCandidates
 * @returns {string}
 */
export function formatStage1RefusalMessage({ fbsId, usId, reqId, openCandidates }) {
  const lines = [];
  lines.push(`refused build: ${fbsId} binds ACs on ${usId}, but ${usId} has ${openCandidates.length} open baseline`);
  lines.push(`        candidate${openCandidates.length === 1 ? '' : 's'} awaiting a decision:`);
  for (const c of openCandidates) {
    const short = shortDescription(c.canonicalText);
    lines.push(`          ${c.baselineKey}: ${short}`);
  }
  lines.push(`        Resolve: rcf discover req-baseline sweep --req ${reqId}`);
  return lines.join('\n');
}

function shortDescription(text) {
  // Trim to a leading "given ... then <clause>" summary; cap at 100
  // chars with an ellipsis. Never rewrites the sentence.
  const trimmed = typeof text === 'string' ? text : '';
  if (trimmed.length <= 100) return trimmed;
  return `${trimmed.slice(0, 97)}...`;
}

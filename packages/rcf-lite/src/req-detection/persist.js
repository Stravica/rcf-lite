// Persist a REQ-shape classification onto a REQ document (Track C+D §4.4).
//
// Reads the REQ from the in-memory tree, computes classification via
// classifyReq (folding parent PRD context when the PRD is loaded), merges
// per mergeClassificationOntoReq (which respects operator overrides and
// refuses to overwrite a real verdict with content-pending), and writes
// the merged shapeClassification block back via updateDocument.
//
// Never fails the calling verb: a classification write error is warned
// on stderr but returns success (the write we care about is the REQ's
// own body write; classification is provenance layered on top).

import { updateDocument } from '#core/store';
import { classifyReq, mergeClassificationOntoReq } from './classifier.js';

/**
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('#core/store/walker.js').TreeModel} args.tree
 * @param {string} args.reqId              the id of the REQ to classify
 * @param {Date} [args.now]
 * @returns {Promise<{ ok: true, block: object, changed: boolean } | { ok: false, message: string }>}
 */
export async function classifyAndPersistReq({ projectRoot, tree, reqId, now = new Date() }) {
  const reqDoc = tree?.byId?.get(reqId);
  if (!reqDoc || reqDoc.reqId !== reqId) {
    return { ok: false, message: `req-classify: ${reqId} not found in tree` };
  }
  const prdId = reqDoc.prdId;
  const parentPrd = prdId ? tree.byId.get(prdId) : null;

  const block = classifyReq(reqDoc, { parentPrd: parentPrd ?? undefined, now });
  const merged = mergeClassificationOntoReq(reqDoc, block);

  // Nothing to write when the merge decided to keep the existing block.
  if (merged === reqDoc) return { ok: true, block: reqDoc.shapeClassification, changed: false };

  const nextBlock = merged.shapeClassification;
  // Write back through the store's updateDocument path so validation
  // fires and updatedAt bumps.
  const result = await updateDocument({
    projectRoot,
    tree,
    id: reqId,
    patch: { shapeClassification: nextBlock },
    sets: [],
    options: {},
    walkErrors: [],
  });
  if (result && result.kind && typeof result.message === 'string') {
    // RcfError shape
    return { ok: false, message: `req-classify: ${result.message}` };
  }
  return { ok: true, block: nextBlock, changed: true };
}

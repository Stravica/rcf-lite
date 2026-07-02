// Normalise a walked tree into the structure the renderers consume. Post-3.7
// the load-bearing relationship maps (`parentByChild`, `childrenByParent`,
// `fbsByAcId`, `dependentsByFbsId`, `tsByAcId`, `tcsByAcId`, `usByTacId`) are
// computed by the walker itself; the tree-model layers view-specific
// convenience maps on top (storiesByReqId as REQ-doc list, usByAcId as
// AC->US pointer, acIdsByUsId as US->AC[] list, errorsById as error index).
//
// The tree-model is also where broken references are recorded as a Set of
// ids the renderer marks with the "broken" class in the diagram and the
// "broken" banner in the page.

/**
 * @typedef {object} BuiltTreeModel
 * @property {object|null} manifest
 * @property {object|null} prd
 * @property {object|null} tad
 * @property {object|null} bs
 * @property {object[]} requirements
 * @property {object[]} userStories
 * @property {object[]} tacs
 * @property {object[]} adrs
 * @property {object[]} fbsItems
 * @property {object[]} testSuites
 * @property {Map<string, object>} byId
 * @property {Map<string, string>} rawById
 * @property {Set<string>} brokenIds
 * @property {Map<string, string>} parentByChild
 * @property {Map<string, string[]>} childrenByParent
 * @property {Map<string, string[]>} dependentsByFbsId
 * @property {Map<string, string[]>} tsByAcId
 * @property {Map<string, Array<{ tsId: string, tcId: string }>>} tcsByAcId
 * @property {Map<string, string[]>} usByTacId
 * @property {Map<string, object[]>} storiesByReqId
 * @property {Map<string, object[]>} fbsByAcId
 * @property {Map<string, string[]>} acIdsByUsId
 * @property {Map<string, object>} usByAcId
 * @property {Map<string, import('../errors/index.js').RcfError[]>} errorsById
 * @property {import('../errors/index.js').RcfError[]} errors
 */

const emptyMap = () => new Map();

/**
 * Build the render-ready tree model from a walker result plus the error
 * list.
 *
 * @param {object} args
 * @param {object} args.tree - the walker's returned tree
 * @param {import('../errors/index.js').RcfError[]} args.errors - the walker's error list
 * @returns {BuiltTreeModel}
 */
export function buildTreeModel({ tree, errors }) {
  // storiesByReqId: keyed on REQ id, values are US doc arrays (renderers want
  // the whole US doc, not just the id, to render titles + drilldowns).
  const storiesByReqId = new Map();
  for (const us of tree.userStories) {
    if (!us?.reqId) continue;
    const list = storiesByReqId.get(us.reqId) ?? [];
    list.push(us);
    storiesByReqId.set(us.reqId, list);
  }
  for (const [reqId, list] of storiesByReqId.entries()) {
    storiesByReqId.set(reqId, list.sort((a, b) => (a.usId ?? '').localeCompare(b.usId ?? '')));
  }

  const acIdsByUsId = new Map();
  const usByAcId = new Map();
  for (const us of tree.userStories) {
    const acIds = [];
    for (const ac of us.acceptanceCriteria ?? []) {
      acIds.push(ac.id);
      usByAcId.set(ac.id, us);
    }
    acIdsByUsId.set(us.usId, acIds);
  }

  // fbsByAcId: renderers want the whole FBS doc so they can print id + title.
  // The walker's `fbsByAcId` is id-list only; the view layer's is object-list.
  const fbsByAcId = new Map();
  for (const f of tree.fbsItems) {
    for (const acId of f.acIds ?? []) {
      const list = fbsByAcId.get(acId) ?? [];
      list.push(f);
      fbsByAcId.set(acId, list);
    }
  }
  for (const [acId, list] of fbsByAcId.entries()) {
    fbsByAcId.set(acId, list.sort((a, b) => (a.fbsId ?? '').localeCompare(b.fbsId ?? '')));
  }

  const errorsById = new Map();
  for (const err of errors) {
    if (!err.documentId) continue;
    const list = errorsById.get(err.documentId) ?? [];
    list.push(err);
    errorsById.set(err.documentId, list);
  }

  return {
    manifest: tree.manifest,
    prd: tree.prd,
    tad: tree.tad,
    bs: tree.bs,
    requirements: tree.requirements,
    userStories: tree.userStories,
    tacs: tree.tacs,
    adrs: tree.adrs,
    fbsItems: tree.fbsItems,
    testSuites: tree.testSuites,
    byId: tree.byId,
    rawById: tree.rawById,
    brokenIds: tree.brokenIds,
    parentByChild: tree.parentByChild ?? emptyMap(),
    childrenByParent: tree.childrenByParent ?? emptyMap(),
    dependentsByFbsId: tree.dependentsByFbsId ?? emptyMap(),
    tsByAcId: tree.tsByAcId ?? emptyMap(),
    tcsByAcId: tree.tcsByAcId ?? emptyMap(),
    usByTacId: tree.usByTacId ?? emptyMap(),
    storiesByReqId,
    fbsByAcId,
    acIdsByUsId,
    usByAcId,
    errorsById,
    errors,
  };
}

/**
 * Return the list of every document id present in the tree (excluding the
 * manifest), in a stable order suitable for diagram emission.
 *
 * @param {BuiltTreeModel} model
 * @returns {string[]}
 */
export function listAllDocumentIds(model) {
  const ids = [];
  if (model.prd?.prdId) ids.push(model.prd.prdId);
  for (const r of model.requirements) if (r.reqId) ids.push(r.reqId);
  for (const u of model.userStories) if (u.usId) ids.push(u.usId);
  if (model.tad?.tadId) ids.push(model.tad.tadId);
  for (const t of model.tacs) if (t.tacId) ids.push(t.tacId);
  for (const a of model.adrs) if (a.adrId) ids.push(a.adrId);
  if (model.bs?.bsId) ids.push(model.bs.bsId);
  for (const f of model.fbsItems) if (f.fbsId) ids.push(f.fbsId);
  return ids;
}

// Tree walker (Phase 3.7 D7). Load-then-invert algorithm: read every
// on-disk document, schema-validate it, then invert child-borne parent
// references (`prdId`, `tadId`, `bsId`, `reqId`, `usId`) into computed
// parent-keyed maps. Zero directory-listing based discovery of tree
// topology -- topology is derived exclusively from parent-id fields
// on children. Directory enumeration lives in `loader.js`
// (`listSubdirJsonFiles`) and is used only to bring files into memory.
//
// The child-owned edge is the source of truth; the parent never carries a
// children list. Broken parent references and broken cross-links surface
// as structured `brokenReference` errors naming the exact file + field.
//
// Returns `{ tree, errors }`. The tree carries the doc arrays, `byId` /
// `rawById` / `brokenIds` (as before) plus the computed relationship maps
// consumers rely on: `parentByChild`, `childrenByParent`, `fbsByAcId`,
// `dependentsByFbsId`, `tsByAcId`, `tcsByAcId`, `usByTacId`.

import { rcfError } from '../errors/index.js';
import { listSubdirJsonFiles, loadDocument, loadRootDocument, pathForId, subdirFor } from './loader.js';
import { validateDocument } from './validator.js';

/**
 * @typedef {object} TreeModel
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
 * @property {Map<string, string[]>} fbsByAcId
 * @property {Map<string, string[]>} dependentsByFbsId
 * @property {Map<string, string[]>} tsByAcId
 * @property {Map<string, Array<{ tsId: string, tcId: string }>>} tcsByAcId
 * @property {Map<string, string[]>} usByTacId
 */

/**
 * @typedef {object} WalkResult
 * @property {TreeModel} tree
 * @property {import('../errors/index.js').RcfError[]} errors
 */

// Phase 10 (X2 CodeNode bridge): 'codeNode' appended. The load-then-invert
// engine treats it exactly like any other child kind - extending the graph
// into code is additive, not a rewrite (PoC-proven, poc/codenode-bridge).
const CHILD_KINDS = ['req', 'userStory', 'tac', 'adr', 'fbs', 'testSuite', 'codeNode'];

const ID_FIELD_BY_KIND = {
  prd: 'prdId',
  tad: 'tadId',
  buildSequence: 'bsId',
  req: 'reqId',
  userStory: 'usId',
  tac: 'tacId',
  adr: 'adrId',
  fbs: 'fbsId',
  // Test Suite uses the plain `id` field (see 0.2.0 test-suite schema).
  testSuite: 'id',
  // Phase 10: Code Node.
  codeNode: 'cnId',
};

function idOfDoc(doc, kind) {
  const field = ID_FIELD_BY_KIND[kind];
  if (!field) return null;
  const value = doc?.[field];
  return typeof value === 'string' ? value : null;
}

function newTree() {
  return {
    manifest: null,
    prd: null,
    tad: null,
    bs: null,
    requirements: [],
    userStories: [],
    tacs: [],
    adrs: [],
    fbsItems: [],
    testSuites: [],
    // Phase 10 (X2 CodeNode bridge): Code Nodes.
    codeNodes: [],
    byId: new Map(),
    rawById: new Map(),
    kindById: new Map(),
    brokenIds: new Set(),
    // B5: schema-invalid (but parseable) documents, keyed by id. These
    // are EXCLUDED from byId / the doc arrays / the inversion maps, but
    // stay addressable so the write verbs can repair or delete them
    // (post-write validation semantics; the TS-003 wedge).
    invalidDocs: new Map(),
    parentByChild: new Map(),
    childrenByParent: new Map(),
    fbsByAcId: new Map(),
    dependentsByFbsId: new Map(),
    tsByAcId: new Map(),
    tcsByAcId: new Map(),
    usByTacId: new Map(),
    // Phase 10: cnByAcId (AC -> CNs implementing it); dependentsByCnId
    // (CN -> CNs that declare it in dependencies[]). Mirrors
    // fbsByAcId / dependentsByFbsId for the code layer.
    cnByAcId: new Map(),
    dependentsByCnId: new Map(),
  };
}

function pushToMap(map, key, value) {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function sortById(list, field) {
  return [...list].sort((a, b) => (a[field] ?? '').localeCompare(b[field] ?? ''));
}

function recordDoc(tree, id, doc, raw, kind) {
  if (id) {
    tree.byId.set(id, doc);
    tree.rawById.set(id, raw);
    tree.kindById.set(id, kind);
  }
  switch (kind) {
    case 'req': tree.requirements.push(doc); break;
    case 'userStory': tree.userStories.push(doc); break;
    case 'tac': tree.tacs.push(doc); break;
    case 'adr': tree.adrs.push(doc); break;
    case 'fbs': tree.fbsItems.push(doc); break;
    case 'testSuite': tree.testSuites.push(doc); break;
    // Phase 10: Code Node.
    case 'codeNode': tree.codeNodes.push(doc); break;
    default: break;
  }
}

async function loadRoot(kind, { projectRoot, tree, errors }) {
  const result = await loadRootDocument({ projectRoot, kind });
  if ('kind' in result && result.kind !== kind) {
    // Keep the error payload clean for downstream consumers; the parsed
    // body (present on validation errors) lands in tree.invalidDocs.
    const { doc: invalidDoc, raw: invalidRaw, ...cleanError } = result;
    void invalidRaw;
    errors.push(cleanError);
    if (result.kind === 'validation' && invalidDoc && typeof invalidDoc === 'object') {
      const invalidId = idOfDoc(invalidDoc, kind);
      if (invalidId) {
        tree.invalidDocs.set(invalidId, { kind, doc: invalidDoc });
        tree.brokenIds.add(invalidId);
      }
    }
    return null;
  }
  const id = idOfDoc(result.doc, kind);
  recordDoc(tree, id, result.doc, result.raw, kind);
  switch (kind) {
    case 'prd': tree.prd = result.doc; break;
    case 'tad': tree.tad = result.doc; break;
    case 'buildSequence': tree.bs = result.doc; break;
    default: break;
  }
  return result.doc;
}

async function loadChildKind(kind, { projectRoot, tree, errors }) {
  const subdir = subdirFor(kind);
  if (!subdir) return;
  const listing = await listSubdirJsonFiles({ projectRoot, subdir });
  if ('error' in listing) {
    errors.push(listing.error);
    return;
  }
  for (const entry of listing.files) {
    const stem = entry.replace(/\.json$/, '');
    const id = stem.toUpperCase();
    const loaded = await loadDocument({ projectRoot, id });
    if ('kind' in loaded && loaded.kind !== kind) {
      const { doc: invalidDoc, raw: invalidRaw, ...cleanError } = loaded;
      void invalidRaw;
      errors.push(cleanError);
      tree.brokenIds.add(id);
      // B5: schema-invalid docs stay addressable for repair / delete.
      if (loaded.kind === 'validation' && invalidDoc && typeof invalidDoc === 'object') {
        tree.invalidDocs.set(id, { kind, doc: invalidDoc });
      }
      continue;
    }
    recordDoc(tree, id, loaded.doc, loaded.raw, kind);
  }
}

/**
 * Walk the tree starting from the manifest. Loads every document, validates
 * against its schema, then inverts child-borne parent references into the
 * computed relationship maps.
 *
 * @param {object} args
 * @param {string} args.projectRoot - absolute path to project root
 * @returns {Promise<WalkResult>}
 */
export async function walkTree({ projectRoot }) {
  const tree = newTree();
  /** @type {import('../errors/index.js').RcfError[]} */
  const errors = [];

  // Manifest first.
  const manifest = await loadRootDocument({ projectRoot, kind: 'manifest' });
  if ('kind' in manifest && manifest.kind === 'missingFile') {
    errors.push(manifest);
    return { tree, errors };
  }
  if ('kind' in manifest && manifest.kind !== 'manifest') {
    errors.push(manifest);
    return { tree, errors };
  }
  tree.manifest = manifest.doc;

  // Root docs (PRD, TAD, BS). Each is optional: a failure surfaces as a
  // structured error but the walk continues over what loaded.
  await loadRoot('prd', { projectRoot, tree, errors });
  await loadRoot('tad', { projectRoot, tree, errors });
  await loadRoot('buildSequence', { projectRoot, tree, errors });

  // Child kinds. `listSubdirJsonFiles` returns the sorted `*.json` filenames
  // (or an empty list for a missing subdir); load each via `loadDocument`,
  // which schema-validates in the same pass. No parent-list enumeration.
  for (const kind of CHILD_KINDS) {
    await loadChildKind(kind, { projectRoot, tree, errors });
  }

  // Sort lists deterministically. The testSuite id field is `id`, all
  // others use their kind-specific field.
  tree.requirements = sortById(tree.requirements, 'reqId');
  tree.userStories = sortById(tree.userStories, 'usId');
  tree.tacs = sortById(tree.tacs, 'tacId');
  tree.adrs = sortById(tree.adrs, 'adrId');
  tree.fbsItems = sortById(tree.fbsItems, 'fbsId');
  tree.testSuites = sortById(tree.testSuites, 'id');
  tree.codeNodes = sortById(tree.codeNodes, 'cnId'); // Phase 10

  // Referential integrity + graph inversion.
  invertGraph(tree);
  collectBrokenReferences(tree, errors);

  return { tree, errors };
}

/**
 * Invert child-borne parent references and cross-links into the computed
 * relationship maps. Only records edges whose parent id resolves to a
 * loaded document of the expected kind -- broken parent/cross-link ids
 * are logged as errors by `collectBrokenReferences`.
 *
 * @param {TreeModel} tree
 */
function invertGraph(tree) {
  const isKind = (id, kind) => tree.kindById.get(id) === kind;
  const linkParent = (childId, parentId) => {
    if (!childId || !parentId) return;
    tree.parentByChild.set(childId, parentId);
    pushToMap(tree.childrenByParent, parentId, childId);
  };

  // REQ.prdId -> PRD.
  for (const req of tree.requirements) {
    if (isKind(req.prdId, 'prd')) linkParent(req.reqId, req.prdId);
  }
  // US.reqId -> REQ. (US also has prdId but the load-bearing parent-child
  // edge in the REQ chain is US -> REQ; PRD -> US is transitive.)
  for (const us of tree.userStories) {
    if (isKind(us.reqId, 'req')) linkParent(us.usId, us.reqId);
    for (const tacId of us.tacIds ?? []) {
      if (isKind(tacId, 'tac')) pushToMap(tree.usByTacId, tacId, us.usId);
    }
  }
  // TAC.tadId -> TAD.
  for (const tac of tree.tacs) {
    if (isKind(tac.tadId, 'tad')) linkParent(tac.tacId, tac.tadId);
  }
  // ADR.tadId -> TAD.
  for (const adr of tree.adrs) {
    if (isKind(adr.tadId, 'tad')) linkParent(adr.adrId, adr.tadId);
  }
  // FBS.bsId -> BS.
  // FBS cross-links: FBS.acIds -> AC (fbsByAcId), FBS.dependsOnFbsIds -> FBS
  //   (dependentsByFbsId is the inversion: keyed on the dependency's fbsId).
  const acIds = collectAllAcIds(tree);
  for (const fbs of tree.fbsItems) {
    if (isKind(fbs.bsId, 'buildSequence')) linkParent(fbs.fbsId, fbs.bsId);
    for (const acId of fbs.acIds ?? []) {
      if (acIds.has(acId)) pushToMap(tree.fbsByAcId, acId, fbs.fbsId);
    }
    for (const depId of fbs.dependsOnFbsIds ?? []) {
      if (isKind(depId, 'fbs')) pushToMap(tree.dependentsByFbsId, depId, fbs.fbsId);
    }
  }
  // TS.usId -> US (parent-child); TS.acIds -> AC (cross-link).
  for (const ts of tree.testSuites) {
    if (isKind(ts.usId, 'userStory')) linkParent(ts.id, ts.usId);
    for (const acId of ts.acIds ?? []) {
      if (acIds.has(acId)) pushToMap(tree.tsByAcId, acId, ts.id);
    }
    for (const tc of ts.testCases ?? []) {
      if (tc?.acId && acIds.has(tc.acId)) {
        pushToMap(tree.tcsByAcId, tc.acId, { tsId: ts.id, tcId: tc.id });
      }
    }
  }

  // Populate parentByChild for inline AC / TC ids so CRUD verbs
  // (Phase 4) can resolve an inline id to its owning US / TS via the
  // same map that resolves standalone child docs. `childrenByParent` is
  // deliberately NOT extended: it still names authored child docs only.
  for (const us of tree.userStories) {
    for (const ac of us.acceptanceCriteria ?? []) {
      if (ac?.id) tree.parentByChild.set(ac.id, us.usId);
    }
  }
  for (const ts of tree.testSuites) {
    for (const tc of ts.testCases ?? []) {
      if (tc?.id) tree.parentByChild.set(tc.id, ts.id);
    }
  }

  // Phase 10 (X2 CodeNode bridge): invert Code Node edges.
  //   CN.implementsAcIds -> cnByAcId (keyed on AC, value = implementing CN)
  //   CN.dependencies     -> dependentsByCnId (keyed on the dependency CN,
  //                          value = the CN that declares the dependency)
  for (const cn of tree.codeNodes) {
    for (const acId of cn.implementsAcIds ?? []) {
      if (acIds.has(acId)) pushToMap(tree.cnByAcId, acId, cn.cnId);
    }
    for (const depId of cn.dependencies ?? []) {
      if (isKind(depId, 'codeNode')) pushToMap(tree.dependentsByCnId, depId, cn.cnId);
    }
  }

  // Sort children lists deterministically.
  for (const [k, list] of tree.childrenByParent) {
    tree.childrenByParent.set(k, [...list].sort());
  }
  for (const map of [tree.fbsByAcId, tree.dependentsByFbsId, tree.tsByAcId, tree.usByTacId, tree.cnByAcId, tree.dependentsByCnId]) {
    for (const [k, list] of map) map.set(k, [...list].sort());
  }
}

// ---------------------------------------------------------------------------
// B5: post-write tree-state simulation
// ---------------------------------------------------------------------------

const ROOT_REL_BY_KIND = {
  prd: 'prd.json',
  tad: 'tad.json',
  buildSequence: 'build-sequence.json',
};

function relPathForEntry(kind, id) {
  const rootRel = ROOT_REL_BY_KIND[kind];
  if (rootRel) return `rcf/${rootRel}`;
  const sub = subdirFor(kind);
  return `rcf/${sub}/${id.toLowerCase()}.json`;
}

/**
 * Compute the error set the walker WOULD report if the given upserts /
 * deletes were applied to the tree - without touching disk. This is the
 * core of the B5 post-write validation semantics: write verbs no longer
 * refuse because the current tree is invalid; they refuse only when the
 * operation would introduce breakage that was not already present.
 *
 * Schema validation and referential integrity are recomputed in memory
 * with exactly the walker's own logic. Load-level errors that cannot be
 * recomputed without disk (parseFailure / missingFile / ioFailure) are
 * carried forward from `preErrors`, minus any attributable to a file
 * this operation touches (e.g. deleting a parse-broken file removes its
 * parseFailure).
 *
 * @param {object} args
 * @param {TreeModel} args.tree - the pre-write tree (walkTree output)
 * @param {import('../errors/index.js').RcfError[]} [args.preErrors]
 * @param {Array<{ kind: string, id: string, doc: object }>} [args.upserts]
 * @param {string[]} [args.deletes] - document ids removed by the operation
 * @returns {import('../errors/index.js').RcfError[]} post-write error set
 */
export function simulateWriteErrors({ tree, preErrors = [], upserts = [], deletes = [] }) {
  /** @type {Map<string, { kind: string, doc: object }>} */
  const entries = new Map();
  for (const [id, doc] of tree.byId) {
    const kind = tree.kindById.get(id);
    if (!kind) continue;
    entries.set(id, { kind, doc });
  }
  for (const [id, invalid] of tree.invalidDocs ?? []) {
    if (!entries.has(id)) entries.set(id, { kind: invalid.kind, doc: invalid.doc });
  }

  const touchedPaths = new Set();
  for (const up of upserts) {
    entries.set(up.id, { kind: up.kind, doc: up.doc });
    touchedPaths.add(relPathForEntry(up.kind, up.id));
  }
  for (const id of deletes) {
    const existing = entries.get(id);
    if (existing) {
      touchedPaths.add(relPathForEntry(existing.kind, id));
      entries.delete(id);
    } else {
      // Not loadable at all (e.g. parse-broken file being unlinked):
      // resolve its conventional path so carried-forward load errors drop.
      const resolved = pathForId(id);
      if (resolved) touchedPaths.add(`rcf/${resolved.relPath}`);
    }
  }

  // Rebuild the tree model in memory, mirroring walkTree: schema-validate
  // every entry, keep valid ones, then invert and integrity-check.
  const post = newTree();
  post.manifest = tree.manifest;
  /** @type {import('../errors/index.js').RcfError[]} */
  const errors = [];
  for (const [id, entry] of entries) {
    const filePath = relPathForEntry(entry.kind, id);
    const validation = validateDocument({ doc: entry.doc, kind: entry.kind, filePath });
    if (validation) {
      errors.push({ ...validation, documentId: id });
      post.brokenIds.add(id);
      continue;
    }
    recordDoc(post, id, entry.doc, tree.rawById.get(id) ?? '', entry.kind);
    if (entry.kind === 'prd') post.prd = entry.doc;
    else if (entry.kind === 'tad') post.tad = entry.doc;
    else if (entry.kind === 'buildSequence') post.bs = entry.doc;
  }
  post.requirements = sortById(post.requirements, 'reqId');
  post.userStories = sortById(post.userStories, 'usId');
  post.tacs = sortById(post.tacs, 'tacId');
  post.adrs = sortById(post.adrs, 'adrId');
  post.fbsItems = sortById(post.fbsItems, 'fbsId');
  post.testSuites = sortById(post.testSuites, 'id');
  post.codeNodes = sortById(post.codeNodes, 'cnId'); // Phase 10
  invertGraph(post);
  collectBrokenReferences(post, errors);

  for (const err of preErrors) {
    if (err.kind === 'parseFailure' || err.kind === 'missingFile' || err.kind === 'ioFailure') {
      if (err.filePath && touchedPaths.has(err.filePath)) continue;
      errors.push(err);
    }
  }
  return errors;
}

/**
 * The errors present post-write that were not present pre-write.
 * Identity is the full structured tuple; message text is included so two
 * distinct breakages on the same document do not collapse.
 *
 * @param {import('../errors/index.js').RcfError[]} preErrors
 * @param {import('../errors/index.js').RcfError[]} postErrors
 * @returns {import('../errors/index.js').RcfError[]}
 */
export function netNewErrors(preErrors, postErrors) {
  const keyOf = (e) => JSON.stringify([e.kind, e.documentId ?? null, e.filePath ?? null, e.field ?? null, e.rule ?? null, e.message]);
  const pre = new Set(preErrors.map(keyOf));
  return postErrors.filter((e) => !pre.has(keyOf(e)));
}

// Kind lookups use `tree.kindById` (populated at load time). This helper is
// retained for the small number of call sites that pass a doc without a
// resolved id, but the load-time map is authoritative.

function collectAllAcIds(tree) {
  const acIds = new Set();
  for (const us of tree.userStories) {
    for (const ac of us.acceptanceCriteria ?? []) acIds.add(ac.id);
  }
  return acIds;
}

/**
 * Referential integrity pass. Every parent field and cross-link id must
 * resolve to a loaded doc of the expected kind. Broken links become
 * `brokenReference` errors naming the exact file + field. Inline AC / TC
 * id patterns are checked against their parent's numbering per D7 step 5.
 *
 * @param {TreeModel} tree
 * @param {import('../errors/index.js').RcfError[]} errors
 */
function collectBrokenReferences(tree, errors) {
  const acIds = collectAllAcIds(tree);

  const check = ({ docId, docKind, fromField, targetId, expectedKind, filePath, message }) => {
    if (!targetId) return;
    const targetKind = tree.kindById.get(targetId);
    if (targetKind !== expectedKind) {
      errors.push(rcfError({
        kind: 'brokenReference',
        message,
        documentId: docId,
        filePath,
        field: fromField,
        rule: `resolveTo:${expectedKind}`,
      }));
      tree.brokenIds.add(targetId);
    }
    void docKind;
  };

  for (const req of tree.requirements) {
    check({
      docId: req.reqId,
      docKind: 'req',
      fromField: 'prdId',
      targetId: req.prdId,
      expectedKind: 'prd',
      filePath: `rcf/requirements/${(req.reqId ?? '').toLowerCase()}.json`,
      message: `REQ ${req.reqId} references unknown PRD ${req.prdId}`,
    });
  }
  for (const us of tree.userStories) {
    check({
      docId: us.usId,
      docKind: 'userStory',
      fromField: 'reqId',
      targetId: us.reqId,
      expectedKind: 'req',
      filePath: `rcf/user-stories/${(us.usId ?? '').toLowerCase()}.json`,
      message: `US ${us.usId} references unknown REQ ${us.reqId}`,
    });
    for (const [i, tacId] of (us.tacIds ?? []).entries()) {
      check({
        docId: us.usId,
        docKind: 'userStory',
        fromField: `tacIds[${i}]`,
        targetId: tacId,
        expectedKind: 'tac',
        filePath: `rcf/user-stories/${(us.usId ?? '').toLowerCase()}.json`,
        message: `US ${us.usId} references unknown TAC ${tacId}`,
      });
    }
    // Inline AC id pattern check.
    const usSuffix = us.usId?.match(/^US-(\d{3,})$/)?.[1];
    if (usSuffix) {
      for (const ac of us.acceptanceCriteria ?? []) {
        const m = String(ac.id ?? '').match(/^AC-(\d{3,})(?:-\d+)?$/);
        if (m && m[1] !== usSuffix) {
          errors.push(rcfError({
            kind: 'brokenReference',
            message: `Inline AC ${ac.id} under US ${us.usId} has a mismatched numeric prefix`,
            documentId: us.usId,
            filePath: `rcf/user-stories/${us.usId.toLowerCase()}.json`,
            field: `acceptanceCriteria.id:${ac.id}`,
            rule: 'idPrefixMatchesParent',
          }));
        }
      }
    }
  }
  for (const tac of tree.tacs) {
    check({
      docId: tac.tacId,
      docKind: 'tac',
      fromField: 'tadId',
      targetId: tac.tadId,
      expectedKind: 'tad',
      filePath: `rcf/tacs/${(tac.tacId ?? '').toLowerCase()}.json`,
      message: `TAC ${tac.tacId} references unknown TAD ${tac.tadId}`,
    });
  }
  for (const adr of tree.adrs) {
    check({
      docId: adr.adrId,
      docKind: 'adr',
      fromField: 'tadId',
      targetId: adr.tadId,
      expectedKind: 'tad',
      filePath: `rcf/adrs/${(adr.adrId ?? '').toLowerCase()}.json`,
      message: `ADR ${adr.adrId} references unknown TAD ${adr.tadId}`,
    });
  }

  // FBS parent + cross-link + dependency checks. `buildOrder` uniqueness
  // per bsId is enforced structurally: duplicate buildOrder values inside
  // one BS are a validation error (spec §D6).
  const buildOrderCounts = new Map();
  for (const fbs of tree.fbsItems) {
    check({
      docId: fbs.fbsId,
      docKind: 'fbs',
      fromField: 'bsId',
      targetId: fbs.bsId,
      expectedKind: 'buildSequence',
      filePath: `rcf/fbs/${(fbs.fbsId ?? '').toLowerCase()}.json`,
      message: `FBS ${fbs.fbsId} references unknown BS ${fbs.bsId}`,
    });
    for (const [i, acId] of (fbs.acIds ?? []).entries()) {
      if (!acIds.has(acId)) {
        errors.push(rcfError({
          kind: 'brokenReference',
          message: `FBS ${fbs.fbsId} references unknown acceptance criterion ${acId}`,
          documentId: fbs.fbsId,
          filePath: `rcf/fbs/${(fbs.fbsId ?? '').toLowerCase()}.json`,
          field: `acIds[${i}]`,
          rule: 'resolveTo:ac',
        }));
        tree.brokenIds.add(acId);
      }
    }
    for (const [i, depId] of (fbs.dependsOnFbsIds ?? []).entries()) {
      check({
        docId: fbs.fbsId,
        docKind: 'fbs',
        fromField: `dependsOnFbsIds[${i}]`,
        targetId: depId,
        expectedKind: 'fbs',
        filePath: `rcf/fbs/${(fbs.fbsId ?? '').toLowerCase()}.json`,
        message: `FBS ${fbs.fbsId} depends on unknown FBS ${depId}`,
      });
    }
    const ctx = fbs.contextRequirements ?? {};
    for (const [i, tacId] of (ctx.tacIds ?? []).entries()) {
      check({
        docId: fbs.fbsId,
        docKind: 'fbs',
        fromField: `contextRequirements.tacIds[${i}]`,
        targetId: tacId,
        expectedKind: 'tac',
        filePath: `rcf/fbs/${(fbs.fbsId ?? '').toLowerCase()}.json`,
        message: `FBS ${fbs.fbsId} references unknown TAC ${tacId}`,
      });
    }
    for (const [i, adrId] of (ctx.adrIds ?? []).entries()) {
      check({
        docId: fbs.fbsId,
        docKind: 'fbs',
        fromField: `contextRequirements.adrIds[${i}]`,
        targetId: adrId,
        expectedKind: 'adr',
        filePath: `rcf/fbs/${(fbs.fbsId ?? '').toLowerCase()}.json`,
        message: `FBS ${fbs.fbsId} references unknown ADR ${adrId}`,
      });
    }
    if (fbs.bsId && typeof fbs.buildOrder === 'number') {
      const key = `${fbs.bsId}::${fbs.buildOrder}`;
      pushToMap(buildOrderCounts, key, fbs.fbsId);
    }
  }
  for (const [key, ids] of buildOrderCounts) {
    if (ids.length <= 1) continue;
    const [bsId, order] = key.split('::');
    for (const fbsId of ids) {
      errors.push(rcfError({
        kind: 'brokenReference',
        message: `Duplicate buildOrder ${order} within ${bsId} on FBS ${fbsId}`,
        documentId: fbsId,
        filePath: `rcf/fbs/${fbsId.toLowerCase()}.json`,
        field: 'buildOrder',
        rule: 'uniqueBuildOrderPerBs',
      }));
    }
  }

  // Test Suite parent + cross-link checks.
  for (const ts of tree.testSuites) {
    check({
      docId: ts.id,
      docKind: 'testSuite',
      fromField: 'usId',
      targetId: ts.usId,
      expectedKind: 'userStory',
      filePath: `rcf/test-suites/${(ts.id ?? '').toLowerCase()}.json`,
      message: `TS ${ts.id} references unknown US ${ts.usId}`,
    });
    for (const [i, acId] of (ts.acIds ?? []).entries()) {
      if (!acIds.has(acId)) {
        errors.push(rcfError({
          kind: 'brokenReference',
          message: `TS ${ts.id} references unknown acceptance criterion ${acId}`,
          documentId: ts.id,
          filePath: `rcf/test-suites/${(ts.id ?? '').toLowerCase()}.json`,
          field: `acIds[${i}]`,
          rule: 'resolveTo:ac',
        }));
        tree.brokenIds.add(acId);
      }
    }
    // Inline TC id pattern check: `TC-<TS-suffix>-<slug>`.
    const tsSuffix = ts.id?.match(/^TS-(\d{3})$/)?.[1];
    if (tsSuffix) {
      for (const tc of ts.testCases ?? []) {
        const m = String(tc.id ?? '').match(/^TC-(\d{3})-[a-z0-9-]+$/);
        if (m && m[1] !== tsSuffix) {
          errors.push(rcfError({
            kind: 'brokenReference',
            message: `Inline TC ${tc.id} under TS ${ts.id} has a mismatched numeric prefix`,
            documentId: ts.id,
            filePath: `rcf/test-suites/${ts.id.toLowerCase()}.json`,
            field: `testCases.id:${tc.id}`,
            rule: 'idPrefixMatchesParent',
          }));
        }
      }
    }
  }

  // Phase 10 (X2 CodeNode bridge): Code Node cross-link integrity.
  //   implementsAcIds -> AC (must resolve to a known acceptance criterion)
  //   dependencies    -> CN (must resolve to a known code node)
  for (const cn of tree.codeNodes) {
    for (const [i, acId] of (cn.implementsAcIds ?? []).entries()) {
      if (!acIds.has(acId)) {
        errors.push(rcfError({
          kind: 'brokenReference',
          message: `CN ${cn.cnId} references unknown acceptance criterion ${acId}`,
          documentId: cn.cnId,
          filePath: `rcf/code-nodes/${(cn.cnId ?? '').toLowerCase()}.json`,
          field: `implementsAcIds[${i}]`,
          rule: 'resolveTo:ac',
        }));
        tree.brokenIds.add(acId);
      }
    }
    for (const [i, depId] of (cn.dependencies ?? []).entries()) {
      check({
        docId: cn.cnId,
        docKind: 'codeNode',
        fromField: `dependencies[${i}]`,
        targetId: depId,
        expectedKind: 'codeNode',
        filePath: `rcf/code-nodes/${(cn.cnId ?? '').toLowerCase()}.json`,
        message: `CN ${cn.cnId} depends on unknown code node ${depId}`,
      });
    }
  }
}

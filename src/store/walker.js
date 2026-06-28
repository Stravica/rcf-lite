// Tree walker. Starts at rcf/manifest.json, loads the three roots (PRD,
// TAD, BS), then walks each parent's id list to load every child. Collects
// errors rather than throwing; the walk completes even if some documents
// fail to load.
//
// Returns a populated tree (with whatever loaded successfully) and a list
// of structured errors describing the rest. The view layer consumes this
// structure directly.

import { rcfError } from '../errors/index.js';
import { loadDocument, loadRootDocument } from './loader.js';

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
 */

/**
 * @typedef {object} WalkResult
 * @property {TreeModel} tree
 * @property {import('../errors/index.js').RcfError[]} errors
 */

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
    byId: new Map(),
    rawById: new Map(),
    brokenIds: new Set(),
  };
}

function recordRoot(tree, slot, loaded) {
  tree[slot] = loaded.doc;
  const idField = {
    prd: 'prdId',
    tad: 'tadId',
    bs: 'bsId',
  }[slot];
  if (idField && loaded.doc?.[idField]) {
    tree.byId.set(loaded.doc[idField], loaded.doc);
    tree.rawById.set(loaded.doc[idField], loaded.raw);
  }
}

function sortById(list, field) {
  return [...list].sort((a, b) => (a[field] ?? '').localeCompare(b[field] ?? ''));
}

/**
 * Walk the tree starting from the manifest.
 *
 * @param {object} args
 * @param {string} args.projectRoot - absolute path to project root
 * @returns {Promise<WalkResult>}
 */
export async function walkTree({ projectRoot }) {
  const tree = newTree();
  /** @type {import('../errors/index.js').RcfError[]} */
  const errors = [];

  // Manifest
  const manifest = await loadRootDocument({ projectRoot, kind: 'manifest' });
  if ('kind' in manifest && manifest.kind === 'missingFile') {
    // No manifest means no project; the walker returns just this error.
    errors.push(manifest);
    return { tree, errors };
  }
  if ('kind' in manifest && manifest.kind !== 'manifest') {
    errors.push(manifest);
    return { tree, errors };
  }
  tree.manifest = manifest.doc;
  // Root references from manifest
  const manifestDoc = manifest.doc;

  // PRD
  const prd = await loadRootDocument({ projectRoot, kind: 'prd' });
  if ('kind' in prd && prd.kind !== 'prd') {
    errors.push(prd);
  } else {
    recordRoot(tree, 'prd', prd);
  }

  // TAD
  const tad = await loadRootDocument({ projectRoot, kind: 'tad' });
  if ('kind' in tad && tad.kind !== 'tad') {
    errors.push(tad);
  } else {
    recordRoot(tree, 'tad', tad);
  }

  // BS
  const bs = await loadRootDocument({ projectRoot, kind: 'buildSequence' });
  if ('kind' in bs && bs.kind !== 'buildSequence') {
    errors.push(bs);
  } else {
    recordRoot(tree, 'bs', bs);
  }

  // Requirements (from PRD.requirementIds)
  if (tree.prd && Array.isArray(tree.prd.requirementIds)) {
    for (const id of tree.prd.requirementIds) {
      const loaded = await loadDocument({ projectRoot, id });
      if ('kind' in loaded && loaded.kind !== 'req') {
        errors.push(loaded);
        tree.brokenIds.add(id);
        continue;
      }
      tree.requirements.push(loaded.doc);
      tree.byId.set(id, loaded.doc);
      tree.rawById.set(id, loaded.raw);
    }
  }

  // User stories (every US that claims a known REQ; we discover by
  // attempting load against the spec's stable naming convention from
  // walking the requirements arm. The schema does not enumerate USs in
  // REQ documents, so we discover USs via the FBS / build-sequence arm
  // is not appropriate either. The Phase 2 convention is that the PRD
  // names the REQs and the USs live under us-NNN.json keyed by the REQ
  // number. To remain schema-faithful, we instead derive USs by scanning
  // the on-disk user-stories directory; this keeps the walker honest to
  // the JSON contract rather than to a naming guess.
  await loadDirectoryDocuments(projectRoot, 'user-stories', 'userStory', tree, errors);

  // TACs (from TAD.componentIds)
  if (tree.tad && Array.isArray(tree.tad.componentIds)) {
    for (const id of tree.tad.componentIds) {
      const loaded = await loadDocument({ projectRoot, id });
      if ('kind' in loaded && loaded.kind !== 'tac') {
        errors.push(loaded);
        tree.brokenIds.add(id);
        continue;
      }
      tree.tacs.push(loaded.doc);
      tree.byId.set(id, loaded.doc);
      tree.rawById.set(id, loaded.raw);
    }
  }

  // ADRs (from TAD.architecturalDecisionIds)
  if (tree.tad && Array.isArray(tree.tad.architecturalDecisionIds)) {
    for (const id of tree.tad.architecturalDecisionIds) {
      const loaded = await loadDocument({ projectRoot, id });
      if ('kind' in loaded && loaded.kind !== 'adr') {
        errors.push(loaded);
        tree.brokenIds.add(id);
        continue;
      }
      tree.adrs.push(loaded.doc);
      tree.byId.set(id, loaded.doc);
      tree.rawById.set(id, loaded.raw);
    }
  }

  // FBS (from BS.fbs[].fbsId)
  if (tree.bs && Array.isArray(tree.bs.fbs)) {
    for (const slot of tree.bs.fbs) {
      const id = slot.fbsId;
      const loaded = await loadDocument({ projectRoot, id });
      if ('kind' in loaded && loaded.kind !== 'fbs') {
        errors.push(loaded);
        tree.brokenIds.add(id);
        continue;
      }
      tree.fbsItems.push(loaded.doc);
      tree.byId.set(id, loaded.doc);
      tree.rawById.set(id, loaded.raw);
    }
  }

  // Test suites: optional and discovered from disk if present.
  await loadDirectoryDocuments(projectRoot, 'test-suites', 'testSuite', tree, errors);

  // Sort lists deterministically.
  tree.requirements = sortById(tree.requirements, 'reqId');
  tree.userStories = sortById(tree.userStories, 'usId');
  tree.tacs = sortById(tree.tacs, 'tacId');
  tree.adrs = sortById(tree.adrs, 'adrId');
  tree.fbsItems = sortById(tree.fbsItems, 'fbsId');
  tree.testSuites = sortById(tree.testSuites, 'tsId');

  // After loading, check for broken references between documents.
  collectBrokenReferences(tree, errors);

  return { tree, errors };
}

const ID_FIELD_BY_KIND = {
  userStory: 'usId',
  testSuite: 'tsId',
};

/**
 * Discover and load every JSON document in a subdirectory under rcf/.
 * Used for USs and TSs, where the parent's id list does not enumerate
 * children.
 *
 * @param {string} projectRoot
 * @param {string} subdir
 * @param {string} kind
 * @param {TreeModel} tree
 * @param {import('../errors/index.js').RcfError[]} errors
 */
async function loadDirectoryDocuments(projectRoot, subdir, kind, tree, errors) {
  const { readdir } = await import('node:fs/promises');
  const { join } = await import('node:path');
  let entries;
  try {
    entries = await readdir(join(projectRoot, 'rcf', subdir));
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return;
    errors.push(rcfError({
      kind: 'ioFailure',
      message: `Failed to read directory: ${/** @type {Error} */ (err).message}`,
      filePath: `rcf/${subdir}`,
    }));
    return;
  }
  const jsonFiles = entries.filter((e) => e.endsWith('.json')).sort();
  for (const entry of jsonFiles) {
    const id = entry.replace(/\.json$/, '').toUpperCase();
    const loaded = await loadDocument({ projectRoot, id });
    if ('kind' in loaded && loaded.kind !== kind) {
      errors.push(loaded);
      tree.brokenIds.add(id);
      continue;
    }
    const idField = ID_FIELD_BY_KIND[kind];
    if (kind === 'userStory') tree.userStories.push(loaded.doc);
    else if (kind === 'testSuite') tree.testSuites.push(loaded.doc);
    if (idField && loaded.doc[idField]) {
      tree.byId.set(loaded.doc[idField], loaded.doc);
      tree.rawById.set(loaded.doc[idField], loaded.raw);
    }
  }
}

/**
 * Scan parent documents for references to ids that have no loaded child.
 * Each broken reference becomes one structured `missingFile` error.
 *
 * @param {TreeModel} tree
 * @param {import('../errors/index.js').RcfError[]} errors
 */
function collectBrokenReferences(tree, errors) {
  const ids = tree.byId;
  // PRD requirementIds
  if (tree.prd?.requirementIds) {
    for (const id of tree.prd.requirementIds) {
      if (!ids.has(id) && !errorAlreadyFor(errors, id)) {
        errors.push(rcfError({
          kind: 'missingFile',
          message: `PRD references ${id} but no document file was found`,
          documentId: id,
          filePath: `rcf/requirements/${id.toLowerCase()}.json`,
        }));
        tree.brokenIds.add(id);
      }
    }
  }
  // US referenced via REQ has no enumeration. Skip.
  // TAD componentIds, architecturalDecisionIds
  if (tree.tad?.componentIds) {
    for (const id of tree.tad.componentIds) {
      if (!ids.has(id) && !errorAlreadyFor(errors, id)) {
        errors.push(rcfError({
          kind: 'missingFile',
          message: `TAD references ${id} but no document file was found`,
          documentId: id,
          filePath: `rcf/tacs/${id.toLowerCase()}.json`,
        }));
        tree.brokenIds.add(id);
      }
    }
  }
  if (tree.tad?.architecturalDecisionIds) {
    for (const id of tree.tad.architecturalDecisionIds) {
      if (!ids.has(id) && !errorAlreadyFor(errors, id)) {
        errors.push(rcfError({
          kind: 'missingFile',
          message: `TAD references ${id} but no document file was found`,
          documentId: id,
          filePath: `rcf/adrs/${id.toLowerCase()}.json`,
        }));
        tree.brokenIds.add(id);
      }
    }
  }
  // BS fbs[].fbsId
  if (tree.bs?.fbs) {
    for (const slot of tree.bs.fbs) {
      if (!ids.has(slot.fbsId) && !errorAlreadyFor(errors, slot.fbsId)) {
        errors.push(rcfError({
          kind: 'missingFile',
          message: `Build sequence references ${slot.fbsId} but no document file was found`,
          documentId: slot.fbsId,
          filePath: `rcf/fbs/${slot.fbsId.toLowerCase()}.json`,
        }));
        tree.brokenIds.add(slot.fbsId);
      }
    }
  }
  // US reqId
  for (const us of tree.userStories) {
    if (us.reqId && !ids.has(us.reqId)) {
      errors.push(rcfError({
        kind: 'missingFile',
        message: `User story ${us.usId} references unknown requirement ${us.reqId}`,
        documentId: us.reqId,
        filePath: `rcf/requirements/${us.reqId.toLowerCase()}.json`,
      }));
      tree.brokenIds.add(us.reqId);
    }
  }
  // FBS acIds, dependencies, contextRequirements
  const allAcIds = new Set();
  for (const us of tree.userStories) {
    for (const ac of us.acceptanceCriteria ?? []) allAcIds.add(ac.id);
  }
  for (const f of tree.fbsItems) {
    for (const acId of f.acIds ?? []) {
      if (!allAcIds.has(acId)) {
        errors.push(rcfError({
          kind: 'missingFile',
          message: `FBS ${f.fbsId} references unknown acceptance criterion ${acId}`,
          documentId: acId,
        }));
        tree.brokenIds.add(acId);
      }
    }
    for (const dep of f.dependencies ?? []) {
      if (!ids.has(dep) && !errorAlreadyFor(errors, dep)) {
        errors.push(rcfError({
          kind: 'missingFile',
          message: `FBS ${f.fbsId} depends on unknown FBS ${dep}`,
          documentId: dep,
          filePath: `rcf/fbs/${dep.toLowerCase()}.json`,
        }));
        tree.brokenIds.add(dep);
      }
    }
    const ctx = f.contextRequirements ?? {};
    for (const tacId of ctx.tacIds ?? []) {
      if (!ids.has(tacId) && !errorAlreadyFor(errors, tacId)) {
        errors.push(rcfError({
          kind: 'missingFile',
          message: `FBS ${f.fbsId} references unknown TAC ${tacId}`,
          documentId: tacId,
          filePath: `rcf/tacs/${tacId.toLowerCase()}.json`,
        }));
        tree.brokenIds.add(tacId);
      }
    }
    for (const adrId of ctx.adrIds ?? []) {
      if (!ids.has(adrId) && !errorAlreadyFor(errors, adrId)) {
        errors.push(rcfError({
          kind: 'missingFile',
          message: `FBS ${f.fbsId} references unknown ADR ${adrId}`,
          documentId: adrId,
          filePath: `rcf/adrs/${adrId.toLowerCase()}.json`,
        }));
        tree.brokenIds.add(adrId);
      }
    }
  }
}

function errorAlreadyFor(errors, id) {
  return errors.some((e) => e.documentId === id);
}

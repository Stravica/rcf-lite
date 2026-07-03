// Persistence module for CRUD verbs. Wraps every disk write with
// schema validation + referential-integrity checks so no verb ever
// leaves the tree in a schema-broken or referentially-broken state.
//
// Four public functions per spec Phase 4 §D11:
//   nextIdForKind(tree, kind, opts)          -> string
//   createDocument({...})                    -> { id, filePath } | RcfError
//   updateDocument({...})                    -> { id, filePath } | RcfError
//   deleteDocument({...})                    -> { deleted, mutated } | RcfError
//
// No internal `updateParentLinkage()` helper: parents do not carry
// children lists (Phase 3.7 §D2). Create paths write exactly one file
// (or mutate one file for inline AC/TC kinds). Delete paths delete
// 1..N files and mutate 0..N cross-link-carrying files, never touching
// parents.

import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { rcfError } from '../errors/index.js';
import { pathForId, subdirFor } from './loader.js';
import { validateDocument } from './validator.js';

/**
 * @typedef {import('./walker.js').TreeModel} TreeModel
 * @typedef {import('../errors/index.js').RcfError} RcfError
 */

// Mapping between CLI-facing kind aliases and the canonical validator kind.
const KIND_ALIASES = {
  req: 'req',
  us: 'userStory',
  userStory: 'userStory',
  ac: 'ac',
  tac: 'tac',
  adr: 'adr',
  fbs: 'fbs',
  ts: 'testSuite',
  testSuite: 'testSuite',
  tc: 'tc',
};

function canonicalKind(kind) {
  return KIND_ALIASES[kind] ?? kind;
}

/**
 * Compute the next free id for a given kind. Never reuses freed ids:
 * `max+1` reads the current `tree.byId`; a deletion does not lower
 * `max`, so a fresh allocation always exceeds the historical high-water
 * mark for that kind (Phase 4 §D10 amendment).
 *
 * @param {TreeModel} tree
 * @param {string} kind - one of req | us | ac | tac | adr | fbs | ts | tc
 * @param {object} [opts]
 * @param {string} [opts.parentId] - required for us / ac / tc
 * @param {string} [opts.slug]     - required for tc
 * @returns {string}
 */
export function nextIdForKind(tree, kind, opts = {}) {
  const k = canonicalKind(kind);
  switch (k) {
    case 'req':
      return nextFlatId('REQ', tree.requirements.map((d) => d.reqId));
    case 'tac':
      return nextFlatId('TAC', tree.tacs.map((d) => d.tacId));
    case 'adr':
      return nextFlatId('ADR', tree.adrs.map((d) => d.adrId));
    case 'fbs':
      return nextFlatId('FBS', tree.fbsItems.map((d) => d.fbsId));
    case 'testSuite':
      return nextFlatId('TS', tree.testSuites.map((d) => d.id));
    case 'userStory': {
      const reqId = opts.parentId;
      const match = /^REQ-(\d+)$/.exec(reqId ?? '');
      if (!match) {
        throw new TypeError('nextIdForKind us requires opts.parentId matching REQ-XXX');
      }
      const groupDigit = String(Number(match[1]));
      const usIds = tree.userStories
        .filter((us) => us.reqId === reqId)
        .map((us) => us.usId);
      let maxLocal = 0;
      for (const usId of usIds) {
        const mm = /^US-(\d+)$/.exec(usId);
        if (!mm) continue;
        const num = Number(mm[1]);
        const local = num - Number(groupDigit) * 100;
        if (local > maxLocal) maxLocal = local;
      }
      const nextLocal = maxLocal + 1;
      return `US-${groupDigit}${String(nextLocal).padStart(2, '0')}`;
    }
    case 'ac': {
      const usId = opts.parentId;
      const us = tree.byId.get(usId ?? '');
      if (!us || tree.kindById.get(usId) !== 'userStory') {
        throw new TypeError('nextIdForKind ac requires opts.parentId=US-XXX (existing)');
      }
      const mUs = /^US-(\d+)$/.exec(usId);
      if (!mUs) throw new TypeError('nextIdForKind ac: unrecognised US id');
      const usSuffix = mUs[1];
      let maxLocal = 0;
      const re = new RegExp(`^AC-${usSuffix}-(\\d+)$`);
      for (const ac of us.acceptanceCriteria ?? []) {
        const mm = re.exec(ac.id ?? '');
        if (mm) {
          const n = Number(mm[1]);
          if (n > maxLocal) maxLocal = n;
        }
      }
      return `AC-${usSuffix}-${maxLocal + 1}`;
    }
    case 'tc': {
      const tsId = opts.parentId;
      const slug = opts.slug;
      const ts = tree.byId.get(tsId ?? '');
      if (!ts || tree.kindById.get(tsId) !== 'testSuite') {
        throw new TypeError('nextIdForKind tc requires opts.parentId=TS-XXX (existing)');
      }
      if (typeof slug !== 'string' || slug.length === 0) {
        throw new TypeError('nextIdForKind tc requires opts.slug');
      }
      const mTs = /^TS-(\d{3})$/.exec(tsId);
      if (!mTs) throw new TypeError('nextIdForKind tc: unrecognised TS id');
      return `TC-${mTs[1]}-${slug}`;
    }
    default:
      throw new TypeError(`nextIdForKind: unsupported kind ${kind}`);
  }
}

function nextFlatId(prefix, ids) {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const id of ids) {
    const m = re.exec(id ?? '');
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

/**
 * Parent id field name required on each child kind.
 */
const PARENT_FIELD_FOR = {
  req: 'prdId',
  userStory: 'reqId',
  tac: 'tadId',
  adr: 'tadId',
  fbs: 'bsId',
  testSuite: 'usId',
};

const EXPECTED_PARENT_KIND_FOR = {
  req: 'prd',
  userStory: 'req',
  tac: 'tad',
  adr: 'tad',
  fbs: 'buildSequence',
  testSuite: 'userStory',
};

/**
 * @returns {string} ISO timestamp for createdAt/updatedAt fields.
 */
function nowIso() {
  return new Date().toISOString();
}

/**
 * Write a JSON file atomically (write to .tmp, rename). Ensures the
 * parent directory exists.
 * @param {string} absPath
 * @param {object} body
 */
async function writeJsonAtomic(absPath, body) {
  await mkdir(dirname(absPath), { recursive: true });
  const tmp = `${absPath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(body, null, 2)}\n`, 'utf8');
  try {
    await rename(tmp, absPath);
  } catch (err) {
    try { await unlink(tmp); } catch { /* ignore */ }
    throw err;
  }
}

function pathForKindFile(projectRoot, kind, id) {
  const sub = subdirFor(kind);
  if (!sub) throw new TypeError(`pathForKindFile: not a child kind: ${kind}`);
  return join(projectRoot, 'rcf', sub, `${id.toLowerCase()}.json`);
}

function pathForRootDoc(projectRoot, kind) {
  switch (kind) {
    case 'manifest': return join(projectRoot, 'rcf', 'manifest.json');
    case 'prd': return join(projectRoot, 'rcf', 'prd.json');
    case 'tad': return join(projectRoot, 'rcf', 'tad.json');
    case 'buildSequence': return join(projectRoot, 'rcf', 'build-sequence.json');
    default: throw new TypeError(`pathForRootDoc: not a root kind: ${kind}`);
  }
}

/**
 * Create a new document. Returns `{ id, filePath }` on success or an
 * RcfError. Handles the inline kinds `ac` (mutates parent US) and `tc`
 * (mutates parent TS). For root-child kinds writes exactly one file.
 *
 * `body` supplies the caller-provided fields; parent linkage +
 * timestamps + `--from-file` merging happen inside this function so
 * every path routes through a single validation pass.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {TreeModel} args.tree
 * @param {string} args.kind - CLI-facing kind alias (req / us / ac / ...)
 * @param {object} args.body - caller-supplied fields
 * @param {object} [args.options]
 * @param {string} [args.options.id]          - override auto-id
 * @param {string} [args.options.parentId]    - required for all child kinds
 * @param {number} [args.options.buildOrder]  - for fbs
 * @param {string} [args.options.slug]        - for tc
 * @param {boolean}[args.options.dryRun]
 * @returns {Promise<{ id: string, filePath: string, body: object } | RcfError>}
 */
export async function createDocument({ projectRoot, tree, kind, body, options = {} }) {
  const canonical = canonicalKind(kind);
  const parentId = options.parentId;
  const parentField = PARENT_FIELD_FOR[canonical];
  const expectedParentKind = EXPECTED_PARENT_KIND_FOR[canonical];

  // Inline kinds route through mutateInline().
  if (canonical === 'ac') {
    return await createInlineAc({ projectRoot, tree, options, body });
  }
  if (canonical === 'tc') {
    return await createInlineTc({ projectRoot, tree, options, body });
  }

  if (!parentField) {
    return rcfError({
      kind: 'usage',
      message: `createDocument: unsupported kind ${kind}`,
    });
  }
  if (typeof parentId !== 'string' || parentId.length === 0) {
    return rcfError({
      kind: 'usage',
      message: `create ${kind}: --parent is required`,
    });
  }
  // Referential-integrity pre-check.
  const parentDoc = tree.byId.get(parentId);
  const parentKind = tree.kindById.get(parentId);
  if (!parentDoc || parentKind !== expectedParentKind) {
    return rcfError({
      kind: 'brokenReference',
      message: `create ${kind}: parent ${parentId} not found or not a ${expectedParentKind}`,
      documentId: parentId,
      field: parentField,
      rule: `resolveTo:${expectedParentKind}`,
    });
  }

  // Allocate id (or take the override).
  let id = options.id;
  if (id) {
    if (tree.byId.has(id)) {
      return rcfError({
        kind: 'usage',
        message: `create ${kind}: id ${id} is already taken`,
        documentId: id,
      });
    }
  } else {
    try {
      id = nextIdForKind(tree, canonical, { parentId });
    } catch (err) {
      return rcfError({ kind: 'usage', message: err.message });
    }
  }

  // FBS-only sibling collision pre-check on buildOrder (§D6 step 4).
  if (canonical === 'fbs') {
    const siblings = childrenOfParent(tree, parentId, 'fbs');
    let providedOrder = options.buildOrder;
    if (providedOrder === undefined) {
      let maxOrder = 0;
      for (const sib of siblings) {
        if (typeof sib.buildOrder === 'number' && sib.buildOrder > maxOrder) {
          maxOrder = sib.buildOrder;
        }
      }
      providedOrder = maxOrder + 1;
    } else if (Number.isInteger(providedOrder)) {
      const collision = siblings.find((sib) => sib.buildOrder === providedOrder);
      if (collision) {
        return rcfError({
          kind: 'usage',
          message: `create fbs: --build-order ${providedOrder} collides with ${collision.fbsId} (existing buildOrder=${collision.buildOrder}) under ${parentId}`,
          documentId: collision.fbsId,
          field: 'buildOrder',
        });
      }
    }
    options = { ...options, buildOrder: providedOrder };
  }

  // Assemble body with parent linkage + defaults + timestamps.
  const finalBody = assembleBody({ tree, canonical, id, parentId, body, options });

  // Validate assembled body.
  const relPath = relativePathForChild(canonical, id);
  const validation = validateDocument({
    doc: finalBody,
    kind: canonical,
    filePath: relPath,
  });
  if (validation) return { ...validation, documentId: id };

  // Cross-link ACs must resolve to existing ACs for fbs / ts.
  if (canonical === 'fbs' || canonical === 'testSuite') {
    const allAcIds = collectAllAcIds(tree);
    for (const acId of finalBody.acIds ?? []) {
      if (!allAcIds.has(acId)) {
        return rcfError({
          kind: 'brokenReference',
          message: `create ${kind}: acId ${acId} does not resolve to a known AC`,
          documentId: acId,
          field: 'acIds',
          rule: 'resolveTo:ac',
        });
      }
    }
  }
  if (canonical === 'fbs') {
    for (const depId of finalBody.dependsOnFbsIds ?? []) {
      if (tree.kindById.get(depId) !== 'fbs') {
        return rcfError({
          kind: 'brokenReference',
          message: `create fbs: dependsOnFbsIds entry ${depId} is not an existing FBS`,
          documentId: depId,
          field: 'dependsOnFbsIds',
          rule: 'resolveTo:fbs',
        });
      }
    }
  }

  const absPath = pathForKindFile(projectRoot, canonical, id);
  if (options.dryRun) {
    return { id, filePath: relPath, body: finalBody, dryRun: true };
  }
  try {
    await writeJsonAtomic(absPath, finalBody);
  } catch (err) {
    return rcfError({
      kind: 'ioFailure',
      message: `create ${kind}: write failed: ${err.message}`,
      filePath: relPath,
    });
  }
  return { id, filePath: relPath, body: finalBody };
}

function relativePathForChild(canonical, id) {
  const sub = subdirFor(canonical);
  if (!sub) throw new TypeError(`relativePathForChild: bad kind ${canonical}`);
  return `rcf/${sub}/${id.toLowerCase()}.json`;
}

function childrenOfParent(tree, parentId, expectedKind) {
  const ids = tree.childrenByParent.get(parentId) ?? [];
  const out = [];
  for (const id of ids) {
    if (tree.kindById.get(id) === expectedKind) out.push(tree.byId.get(id));
  }
  return out;
}

function collectAllAcIds(tree) {
  const set = new Set();
  for (const us of tree.userStories) {
    for (const ac of us.acceptanceCriteria ?? []) {
      if (ac?.id) set.add(ac.id);
    }
  }
  return set;
}

function assembleBody({ tree, canonical, id, parentId, body, options }) {
  const now = nowIso();
  const prdId = tree.prd?.prdId ?? 'PRD-001';
  const base = { ...(body ?? {}) };
  const withTimestamps = {
    createdAt: now,
    updatedAt: now,
    ...base,
  };
  // Force id, parent linkage, and prdId on every child that needs them.
  switch (canonical) {
    case 'req':
      return {
        ...withTimestamps,
        reqId: id,
        prdId: parentId,
        description: base.description ?? base.title ?? 'TODO: describe the requirement',
        category: base.category ?? 'functional',
        domain: base.domain ?? 'todo',
        priority: base.priority ?? 'must',
        version: base.version ?? '0.1.0',
        status: base.status ?? 'draft',
      };
    case 'userStory':
      return {
        ...withTimestamps,
        usId: id,
        prdId,
        reqId: parentId,
        version: base.version ?? '0.1.0',
        status: base.status ?? 'draft',
        asA: base.asA ?? 'TODO: name the user',
        iWant: base.iWant ?? 'TODO: state the want',
        soThat: base.soThat ?? 'TODO: state the value',
        acceptanceCriteria: base.acceptanceCriteria ?? [{
          id: `AC-${id.slice(3)}-1`,
          description: 'TODO: first acceptance criterion',
          testable: true,
        }],
      };
    case 'tac':
      return {
        ...withTimestamps,
        tacId: id,
        prdId,
        tadId: parentId,
        version: base.version ?? '0.1.0',
        status: base.status ?? 'draft',
        purpose: base.purpose ?? base.title ?? 'TODO: state the purpose',
        responsibilities: base.responsibilities ?? ['TODO: list at least one responsibility'],
        name: base.name ?? base.title ?? 'TODO: name this component',
      };
    case 'adr':
      return {
        ...withTimestamps,
        adrId: id,
        prdId,
        tadId: parentId,
        version: base.version ?? '0.1.0',
        status: base.status ?? 'proposed',
        context: base.context ?? 'TODO: describe the context',
        decision: base.decision ?? 'TODO: describe the decision',
        consequences: base.consequences ?? 'TODO: describe the consequences',
      };
    case 'fbs': {
      const buildOrder = typeof options.buildOrder === 'number' ? options.buildOrder : 1;
      return {
        ...withTimestamps,
        fbsId: id,
        prdId,
        bsId: parentId,
        buildOrder,
        executionStatus: base.executionStatus ?? 'notStarted',
        summary: base.summary ?? base.title ?? 'TODO: describe the build session',
        acIds: base.acIds ?? [],
        dependsOnFbsIds: base.dependsOnFbsIds ?? [],
      };
    }
    case 'testSuite': {
      // Parent US -> prdId inherited from tree root; testSuite schema doesn't
      // require prdId, so we omit it unless caller supplied.
      const out = {
        ...withTimestamps,
        id,
        usId: parentId,
        title: base.title ?? 'TODO: name this test suite',
        purpose: base.purpose ?? 'TODO: state the purpose',
        testLevel: base.testLevel ?? 'unit',
        acIds: base.acIds ?? [],
        testCases: base.testCases ?? [],
        status: base.status ?? 'draft',
      };
      // testSuite schema forbids additional properties - drop any prdId hint.
      delete out.prdId;
      return out;
    }
    default:
      throw new TypeError(`assembleBody: bad kind ${canonical}`);
  }
}

/**
 * Create an inline AC under a parent US.
 */
async function createInlineAc({ projectRoot, tree, options, body }) {
  const parentUsId = options.parentId;
  if (typeof parentUsId !== 'string' || parentUsId.length === 0) {
    return rcfError({ kind: 'usage', message: 'create ac: --parent US-XXX is required' });
  }
  const us = tree.byId.get(parentUsId);
  if (!us || tree.kindById.get(parentUsId) !== 'userStory') {
    return rcfError({
      kind: 'brokenReference',
      message: `create ac: parent ${parentUsId} is not an existing US`,
      documentId: parentUsId,
      field: 'parent',
    });
  }
  let acId = options.id;
  if (acId) {
    const existing = (us.acceptanceCriteria ?? []).some((ac) => ac.id === acId);
    if (existing) {
      return rcfError({ kind: 'usage', message: `create ac: id ${acId} already exists on ${parentUsId}`, documentId: acId });
    }
  } else {
    try {
      acId = nextIdForKind(tree, 'ac', { parentId: parentUsId });
    } catch (err) {
      return rcfError({ kind: 'usage', message: err.message });
    }
  }
  const acEntry = {
    id: acId,
    description: body?.description ?? 'TODO: describe the acceptance criterion',
    testable: body?.testable ?? true,
    ...(body?.given !== undefined ? { given: body.given } : {}),
    ...(body?.when !== undefined ? { when: body.when } : {}),
    ...(body?.then !== undefined ? { then: body.then } : {}),
  };
  const nextUs = {
    ...us,
    acceptanceCriteria: [...(us.acceptanceCriteria ?? []), acEntry],
    updatedAt: nowIso(),
  };
  const relPath = `rcf/user-stories/${parentUsId.toLowerCase()}.json`;
  const validation = validateDocument({ doc: nextUs, kind: 'userStory', filePath: relPath });
  if (validation) return { ...validation, documentId: parentUsId };
  if (options.dryRun) {
    return { id: acId, filePath: relPath, parentId: parentUsId, dryRun: true, body: acEntry };
  }
  try {
    await writeJsonAtomic(pathForKindFile(projectRoot, 'userStory', parentUsId), nextUs);
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `create ac: write failed: ${err.message}`, filePath: relPath });
  }
  return { id: acId, filePath: relPath, parentId: parentUsId, body: acEntry };
}

/**
 * Create an inline TC under a parent TS.
 */
async function createInlineTc({ projectRoot, tree, options, body }) {
  const parentTsId = options.parentId;
  if (typeof parentTsId !== 'string' || parentTsId.length === 0) {
    return rcfError({ kind: 'usage', message: 'create tc: --parent TS-XXX is required' });
  }
  const ts = tree.byId.get(parentTsId);
  if (!ts || tree.kindById.get(parentTsId) !== 'testSuite') {
    return rcfError({
      kind: 'brokenReference',
      message: `create tc: parent ${parentTsId} is not an existing TS`,
      documentId: parentTsId,
      field: 'parent',
    });
  }
  const acId = body?.acId ?? options.acId;
  if (typeof acId !== 'string' || acId.length === 0) {
    return rcfError({ kind: 'usage', message: 'create tc: --ac AC-XXX is required' });
  }
  const allAcIds = collectAllAcIds(tree);
  if (!allAcIds.has(acId)) {
    return rcfError({
      kind: 'brokenReference',
      message: `create tc: acId ${acId} does not resolve to a known AC`,
      documentId: acId,
      field: 'acId',
    });
  }
  const description = body?.description;
  if (typeof description !== 'string' || description.length === 0) {
    return rcfError({ kind: 'usage', message: 'create tc: --description is required' });
  }
  const slug = options.slug ?? deriveSlug(description);
  const tsSuffix = /^TS-(\d{3})$/.exec(parentTsId)?.[1];
  if (!tsSuffix) {
    return rcfError({ kind: 'usage', message: `create tc: parent ${parentTsId} has an unrecognised id shape` });
  }
  const tcId = options.id ?? `TC-${tsSuffix}-${slug}`;
  // Slug collision fails explicitly (§D10 OQ-P4-R-1).
  const existing = (ts.testCases ?? []).find((tc) => tc.id === tcId);
  if (existing) {
    return rcfError({
      kind: 'usage',
      message: `create tc: slug collision on ${tcId}, supply --slug explicitly`,
      documentId: tcId,
    });
  }
  const tcEntry = {
    id: tcId,
    acId,
    description,
    status: body?.status ?? 'pending',
    ...(options.testPointer !== undefined ? { testPointer: options.testPointer } : {}),
  };
  const nextTs = {
    ...ts,
    testCases: [...(ts.testCases ?? []), tcEntry],
    updatedAt: nowIso(),
  };
  const relPath = `rcf/test-suites/${parentTsId.toLowerCase()}.json`;
  const validation = validateDocument({ doc: nextTs, kind: 'testSuite', filePath: relPath });
  if (validation) return { ...validation, documentId: parentTsId };
  if (options.dryRun) {
    return { id: tcId, filePath: relPath, parentId: parentTsId, dryRun: true, body: tcEntry };
  }
  try {
    await writeJsonAtomic(pathForKindFile(projectRoot, 'testSuite', parentTsId), nextTs);
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `create tc: write failed: ${err.message}`, filePath: relPath });
  }
  return { id: tcId, filePath: relPath, parentId: parentTsId, body: tcEntry };
}

/**
 * Derive a slug from a description string. Lowercase, alphanumerics
 * plus hyphens, first 40 chars max, single hyphen runs.
 * @param {string} description
 */
export function deriveSlug(description) {
  const slug = String(description)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  return slug.length > 0 ? slug : 'tc';
}

/**
 * Apply a set of dot-path assignments and/or a body merge to an
 * existing document. Refuses to touch `id`, `createdAt`, or
 * `schemaVersion`. Returns `{ id, filePath }` or an RcfError.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {TreeModel} args.tree
 * @param {string} args.id - target document id (supports inline AC / TC ids)
 * @param {object} [args.patch] - deep-merge target (from --from-file)
 * @param {Array<{ path: string, value: unknown }>} [args.sets] - dot-path assignments
 * @param {object} [args.options]
 * @param {boolean} [args.options.dryRun]
 * @returns {Promise<{ id: string, filePath: string, body: object } | RcfError>}
 */
export async function updateDocument({ projectRoot, tree, id, patch, sets = [], options = {} }) {
  // Inline id resolution.
  const inline = resolveInlineId(id);
  if (inline) {
    return await updateInline({
      projectRoot, tree, inline, id, patch, sets, options,
    });
  }
  // Root or child document.
  const resolved = pathForId(id);
  if (!resolved) {
    return rcfError({ kind: 'usage', message: `update: unrecognised id ${id}`, documentId: id });
  }
  const kind = resolved.kind;
  const rootKinds = new Set(['prd', 'tad', 'buildSequence']);
  let doc;
  if (rootKinds.has(kind)) {
    doc = tree.byId.get(id) ?? tree[rootKindTreeKey(kind)];
  } else if (kind === 'manifest') {
    doc = tree.manifest;
  } else {
    doc = tree.byId.get(id);
  }
  if (!doc) {
    return rcfError({ kind: 'usage', message: `update: id ${id} not found`, documentId: id });
  }

  // Build patched body: start from doc, apply --from-file deep merge,
  // then apply each --set dot-path assignment.
  let next = deepClone(doc);
  if (patch && typeof patch === 'object') {
    next = deepMergeReplaceArrays(next, patch);
  }
  for (const { path, value } of sets) {
    const err = applyDotPath(next, path, value);
    if (err) return rcfError({ kind: 'usage', message: err, documentId: id });
  }
  // Refuse to update immutable fields.
  const immutableTouched = ['id', 'createdAt', 'schemaVersion'].filter((f) => {
    // Fields at top level only.
    return (patch && Object.prototype.hasOwnProperty.call(patch, f))
      || sets.some((s) => s.path === f);
  });
  if (immutableTouched.length > 0) {
    return rcfError({
      kind: 'usage',
      message: `update: refusing to modify immutable field(s): ${immutableTouched.join(', ')}`,
      documentId: id,
    });
  }
  next.updatedAt = nowIso();
  const relPath = kind === 'manifest'
    ? 'rcf/manifest.json'
    : rootKinds.has(kind)
      ? `rcf/${resolved.relPath}`
      : `rcf/${resolved.relPath}`;
  const validation = validateDocument({ doc: next, kind, filePath: relPath });
  if (validation) return { ...validation, documentId: id };

  // Cross-link resolution for update-time reference-integrity:
  // if the caller touched acIds / tacIds / dependsOnFbsIds, verify each
  // referenced id is loaded.
  const refCheck = checkCrossLinks(tree, kind, next, id);
  if (refCheck) return refCheck;

  const absPath = kind === 'manifest'
    ? pathForRootDoc(projectRoot, 'manifest')
    : rootKinds.has(kind)
      ? pathForRootDoc(projectRoot, kind)
      : pathForKindFile(projectRoot, kind, id);
  if (options.dryRun) {
    return { id, filePath: relPath, body: next, dryRun: true };
  }
  try {
    await writeJsonAtomic(absPath, next);
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `update: write failed: ${err.message}`, filePath: relPath });
  }
  return { id, filePath: relPath, body: next };
}

function rootKindTreeKey(kind) {
  if (kind === 'prd') return 'prd';
  if (kind === 'tad') return 'tad';
  if (kind === 'buildSequence') return 'bs';
  return kind;
}

function checkCrossLinks(tree, kind, doc, docId) {
  const allAcIds = collectAllAcIds(tree);
  if (kind === 'fbs') {
    for (const acId of doc.acIds ?? []) {
      if (!allAcIds.has(acId)) {
        return rcfError({
          kind: 'brokenReference', message: `update: acId ${acId} does not resolve to a known AC`,
          documentId: docId, field: 'acIds', rule: 'resolveTo:ac',
        });
      }
    }
    for (const depId of doc.dependsOnFbsIds ?? []) {
      if (tree.kindById.get(depId) !== 'fbs' || depId === docId) {
        return rcfError({
          kind: 'brokenReference', message: `update: dependsOnFbsIds entry ${depId} is invalid`,
          documentId: docId, field: 'dependsOnFbsIds', rule: 'resolveTo:fbs',
        });
      }
    }
  }
  if (kind === 'testSuite') {
    for (const acId of doc.acIds ?? []) {
      if (!allAcIds.has(acId)) {
        return rcfError({
          kind: 'brokenReference', message: `update: acId ${acId} does not resolve to a known AC`,
          documentId: docId, field: 'acIds', rule: 'resolveTo:ac',
        });
      }
    }
  }
  if (kind === 'userStory') {
    for (const tacId of doc.tacIds ?? []) {
      if (tree.kindById.get(tacId) !== 'tac') {
        return rcfError({
          kind: 'brokenReference', message: `update: tacId ${tacId} does not resolve to a known TAC`,
          documentId: docId, field: 'tacIds', rule: 'resolveTo:tac',
        });
      }
    }
  }
  return null;
}

function resolveInlineId(id) {
  if (typeof id !== 'string') return null;
  if (/^AC-\d+(-\d+)?$/.test(id)) return { kind: 'ac' };
  if (/^TC-\d{3}-[a-z0-9-]+$/.test(id)) return { kind: 'tc' };
  return null;
}

/**
 * Update an inline AC or TC by mutating its parent document.
 */
async function updateInline({ projectRoot, tree, inline, id, patch, sets, options }) {
  const parentId = tree.parentByChild.get(id);
  if (!parentId) {
    return rcfError({ kind: 'usage', message: `update: inline id ${id} has no resolvable parent`, documentId: id });
  }
  if (inline.kind === 'ac' && tree.kindById.get(parentId) !== 'userStory') {
    return rcfError({ kind: 'usage', message: `update: inline ${id} parent ${parentId} is not a US`, documentId: id });
  }
  if (inline.kind === 'tc' && tree.kindById.get(parentId) !== 'testSuite') {
    return rcfError({ kind: 'usage', message: `update: inline ${id} parent ${parentId} is not a TS`, documentId: id });
  }
  const parent = tree.byId.get(parentId);
  const arrayField = inline.kind === 'ac' ? 'acceptanceCriteria' : 'testCases';
  const entries = parent[arrayField] ?? [];
  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) {
    return rcfError({ kind: 'usage', message: `update: inline ${id} not found under ${parentId}`, documentId: id });
  }
  let entry = deepClone(entries[idx]);
  if (patch && typeof patch === 'object') {
    entry = deepMergeReplaceArrays(entry, patch);
  }
  for (const { path, value } of sets) {
    const err = applyDotPath(entry, path, value);
    if (err) return rcfError({ kind: 'usage', message: err, documentId: id });
  }
  if (Object.prototype.hasOwnProperty.call(entry, 'id') && entry.id !== id) {
    return rcfError({ kind: 'usage', message: 'update: refusing to modify immutable field(s): id', documentId: id });
  }
  const nextParent = { ...parent, [arrayField]: [...entries.slice(0, idx), entry, ...entries.slice(idx + 1)], updatedAt: nowIso() };
  const kind = inline.kind === 'ac' ? 'userStory' : 'testSuite';
  const relPath = `rcf/${subdirFor(kind)}/${parentId.toLowerCase()}.json`;
  const validation = validateDocument({ doc: nextParent, kind, filePath: relPath });
  if (validation) return { ...validation, documentId: parentId };
  if (options.dryRun) {
    return { id, filePath: relPath, parentId, body: entry, dryRun: true };
  }
  try {
    await writeJsonAtomic(pathForKindFile(projectRoot, kind, parentId), nextParent);
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `update: write failed: ${err.message}`, filePath: relPath });
  }
  return { id, filePath: relPath, parentId, body: entry };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete a document. Refuses by default when the doc has dependents;
 * `options.cascade` opts in. `options.dryRun` prints the plan without
 * touching disk. Returns:
 *   { deleted: string[], mutated: Array<{ id, filePath }>, plan: string[] }
 * or an RcfError. Exit-code 4 refusals are surfaced as `usage` errors
 * with a `rule` field the CLI maps to exit 4 (`dependents` /
 * `wouldOrphan`).
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {TreeModel} args.tree
 * @param {string} args.id
 * @param {object} [args.options]
 * @param {boolean}[args.options.cascade]
 * @param {boolean}[args.options.dryRun]
 * @returns {Promise<{ deleted: string[], mutated: Array<{ id: string, filePath: string }>, plan: string[] } | RcfError>}
 */
export async function deleteDocument({ projectRoot, tree, id, options = {} }) {
  const inline = resolveInlineId(id);
  if (inline) {
    return await deleteInline({ projectRoot, tree, inline, id, options });
  }
  const resolved = pathForId(id);
  if (!resolved) {
    return rcfError({ kind: 'usage', message: `delete: unrecognised id ${id}`, documentId: id });
  }
  const kind = resolved.kind;
  const rootKinds = new Set(['prd', 'tad', 'buildSequence', 'manifest']);
  if (rootKinds.has(kind)) {
    return rcfError({
      kind: 'usage',
      message: `delete: root singleton ${id} cannot be deleted via rcf delete`,
      documentId: id,
    });
  }
  const doc = tree.byId.get(id);
  if (!doc) {
    return rcfError({ kind: 'usage', message: `delete: id ${id} not found`, documentId: id });
  }

  const cascade = Boolean(options.cascade);

  switch (kind) {
    case 'req': return await deleteReq({ projectRoot, tree, id, cascade, options });
    case 'userStory': return await deleteUs({ projectRoot, tree, id, cascade, options });
    case 'tac': return await deleteTac({ projectRoot, tree, id, cascade, options });
    case 'adr': return await deleteAdr({ projectRoot, tree, id, options });
    case 'fbs': return await deleteFbs({ projectRoot, tree, id, cascade, options });
    case 'testSuite': return await deleteTs({ projectRoot, tree, id, options });
    default:
      return rcfError({ kind: 'usage', message: `delete: unsupported kind ${kind}`, documentId: id });
  }
}

async function deleteReq({ projectRoot, tree, id, cascade, options }) {
  // Discover: child US ids via childrenByParent.
  const childUsIds = (tree.childrenByParent.get(id) ?? []).filter((cid) => tree.kindById.get(cid) === 'userStory');
  // Discover: TS ids under each child US.
  const tsIds = [];
  const collectedAcIds = new Set();
  for (const usId of childUsIds) {
    const us = tree.byId.get(usId);
    for (const ac of us.acceptanceCriteria ?? []) collectedAcIds.add(ac.id);
    for (const cid of tree.childrenByParent.get(usId) ?? []) {
      if (tree.kindById.get(cid) === 'testSuite') tsIds.push(cid);
    }
  }
  const dependents = childUsIds.length + tsIds.length + collectedAcIds.size;
  if (!cascade && dependents > 0) {
    return refuseWithDependents(id, {
      childUs: childUsIds,
      childTs: tsIds,
      collectedAcs: [...collectedAcIds],
    });
  }
  return await executeCascade({
    projectRoot,
    tree,
    toDelete: [id, ...childUsIds, ...tsIds],
    collectedAcIds,
    options,
  });
}

async function deleteUs({ projectRoot, tree, id, cascade, options }) {
  const us = tree.byId.get(id);
  const collectedAcIds = new Set((us.acceptanceCriteria ?? []).map((ac) => ac.id));
  const childTsIds = (tree.childrenByParent.get(id) ?? []).filter((cid) => tree.kindById.get(cid) === 'testSuite');
  const dependents = childTsIds.length + collectedAcIds.size;
  if (!cascade && dependents > 0) {
    return refuseWithDependents(id, { childTs: childTsIds, collectedAcs: [...collectedAcIds] });
  }
  return await executeCascade({
    projectRoot,
    tree,
    toDelete: [id, ...childTsIds],
    collectedAcIds,
    options,
  });
}

async function deleteTac({ projectRoot, tree, id, cascade, options }) {
  const dependents = (tree.usByTacId.get(id) ?? []).slice();
  if (!cascade && dependents.length > 0) {
    return refuseWithDependents(id, { usDependents: dependents });
  }
  const mutated = [];
  if (cascade) {
    for (const usId of dependents) {
      const us = tree.byId.get(usId);
      const next = { ...us, tacIds: (us.tacIds ?? []).filter((t) => t !== id), updatedAt: nowIso() };
      if (next.tacIds.length === 0) delete next.tacIds; // schema allows omission (minItems:0 with optional presence)
      const relPath = `rcf/user-stories/${usId.toLowerCase()}.json`;
      const validation = validateDocument({ doc: next, kind: 'userStory', filePath: relPath });
      if (validation) return { ...validation, documentId: usId };
      if (!options.dryRun) await writeJsonAtomic(pathForKindFile(projectRoot, 'userStory', usId), next);
      mutated.push({ id: usId, filePath: relPath });
    }
  }
  // Delete the TAC file.
  const tacRel = `rcf/tacs/${id.toLowerCase()}.json`;
  if (!options.dryRun) {
    try { await unlink(pathForKindFile(projectRoot, 'tac', id)); } catch (err) {
      return rcfError({ kind: 'ioFailure', message: `delete: unlink failed: ${err.message}`, filePath: tacRel });
    }
  }
  return { deleted: [id], mutated, plan: buildPlanLines([id], mutated) };
}

async function deleteAdr({ projectRoot, tree, id, options }) {
  const adrRel = `rcf/adrs/${id.toLowerCase()}.json`;
  if (!options.dryRun) {
    try { await unlink(pathForKindFile(projectRoot, 'adr', id)); } catch (err) {
      return rcfError({ kind: 'ioFailure', message: `delete: unlink failed: ${err.message}`, filePath: adrRel });
    }
  }
  return { deleted: [id], mutated: [], plan: [`delete ${adrRel}`] };
}

async function deleteFbs({ projectRoot, tree, id, cascade, options }) {
  const dependents = (tree.dependentsByFbsId.get(id) ?? []).slice();
  if (!cascade && dependents.length > 0) {
    return refuseWithDependents(id, { fbsDependents: dependents });
  }
  const mutated = [];
  if (cascade) {
    for (const depFbsId of dependents) {
      const dep = tree.byId.get(depFbsId);
      const next = {
        ...dep,
        dependsOnFbsIds: (dep.dependsOnFbsIds ?? []).filter((d) => d !== id),
        updatedAt: nowIso(),
      };
      const relPath = `rcf/fbs/${depFbsId.toLowerCase()}.json`;
      const validation = validateDocument({ doc: next, kind: 'fbs', filePath: relPath });
      if (validation) return { ...validation, documentId: depFbsId };
      if (!options.dryRun) await writeJsonAtomic(pathForKindFile(projectRoot, 'fbs', depFbsId), next);
      mutated.push({ id: depFbsId, filePath: relPath });
    }
  }
  const fbsRel = `rcf/fbs/${id.toLowerCase()}.json`;
  if (!options.dryRun) {
    try { await unlink(pathForKindFile(projectRoot, 'fbs', id)); } catch (err) {
      return rcfError({ kind: 'ioFailure', message: `delete: unlink failed: ${err.message}`, filePath: fbsRel });
    }
  }
  return { deleted: [id], mutated, plan: buildPlanLines([id], mutated) };
}

async function deleteTs({ projectRoot, tree, id, options }) {
  const tsRel = `rcf/test-suites/${id.toLowerCase()}.json`;
  if (!options.dryRun) {
    try { await unlink(pathForKindFile(projectRoot, 'testSuite', id)); } catch (err) {
      return rcfError({ kind: 'ioFailure', message: `delete: unlink failed: ${err.message}`, filePath: tsRel });
    }
  }
  return { deleted: [id], mutated: [], plan: [`delete ${tsRel}`] };
}

/**
 * Delete an inline AC / TC entry. Refuses with exit 4 if the AC has
 * cross-link dependents; --cascade opts in and mutates FBS/TS acIds
 * accordingly (with an orphan-refuse pre-plan check per §D9).
 */
async function deleteInline({ projectRoot, tree, inline, id, options }) {
  const parentId = tree.parentByChild.get(id);
  if (!parentId) {
    return rcfError({ kind: 'usage', message: `delete: inline ${id} has no resolvable parent`, documentId: id });
  }
  if (inline.kind === 'ac' && tree.kindById.get(parentId) !== 'userStory') {
    return rcfError({ kind: 'usage', message: `delete: parent ${parentId} for ${id} is not a US`, documentId: id });
  }
  if (inline.kind === 'tc' && tree.kindById.get(parentId) !== 'testSuite') {
    return rcfError({ kind: 'usage', message: `delete: parent ${parentId} for ${id} is not a TS`, documentId: id });
  }
  const parent = tree.byId.get(parentId);
  const arrayField = inline.kind === 'ac' ? 'acceptanceCriteria' : 'testCases';
  const entries = parent[arrayField] ?? [];
  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) {
    return rcfError({ kind: 'usage', message: `delete: inline ${id} not found under ${parentId}`, documentId: id });
  }
  if (inline.kind === 'tc') {
    // No cross-refs to worry about (§D9 TC clause). Just drop the entry.
    const nextEntries = [...entries.slice(0, idx), ...entries.slice(idx + 1)];
    return await writeInlineParent({
      projectRoot, tree, parent, parentId, arrayField, nextEntries, options,
    });
  }
  // AC path: check cross-refs and orphan-refuse.
  const dependentFbs = tree.fbsByAcId.get(id) ?? [];
  const dependentTs = tree.tsByAcId.get(id) ?? [];
  const hasDeps = dependentFbs.length + dependentTs.length > 0;
  if (!options.cascade && hasDeps) {
    return refuseWithDependents(id, { fbsAcDependents: dependentFbs, tsAcDependents: dependentTs });
  }
  // Would the parent US drop below minItems:1 on acceptanceCriteria?
  const nextEntries = [...entries.slice(0, idx), ...entries.slice(idx + 1)];
  if (nextEntries.length === 0) {
    return rcfError({
      kind: 'usage',
      message: `delete: would leave US ${parentId} with no acceptance criteria`,
      documentId: parentId,
      rule: 'wouldOrphan',
    });
  }
  // Cascade path: simulate FBS/TS acIds mutations, orphan-refuse.
  const mutated = [];
  if (options.cascade) {
    const orphanCheck = checkAcOrphans(tree, [id]);
    if (orphanCheck) return orphanCheck;
    for (const fbsId of dependentFbs) {
      const fbs = tree.byId.get(fbsId);
      const nextAcIds = (fbs.acIds ?? []).filter((a) => a !== id);
      const next = { ...fbs, acIds: nextAcIds, updatedAt: nowIso() };
      const relPath = `rcf/fbs/${fbsId.toLowerCase()}.json`;
      const validation = validateDocument({ doc: next, kind: 'fbs', filePath: relPath });
      if (validation) return { ...validation, documentId: fbsId };
      if (!options.dryRun) await writeJsonAtomic(pathForKindFile(projectRoot, 'fbs', fbsId), next);
      mutated.push({ id: fbsId, filePath: relPath });
    }
    for (const tsId of dependentTs) {
      const ts = tree.byId.get(tsId);
      const nextAcIds = (ts.acIds ?? []).filter((a) => a !== id);
      const next = { ...ts, acIds: nextAcIds, updatedAt: nowIso() };
      const relPath = `rcf/test-suites/${tsId.toLowerCase()}.json`;
      const validation = validateDocument({ doc: next, kind: 'testSuite', filePath: relPath });
      if (validation) return { ...validation, documentId: tsId };
      if (!options.dryRun) await writeJsonAtomic(pathForKindFile(projectRoot, 'testSuite', tsId), next);
      mutated.push({ id: tsId, filePath: relPath });
    }
  }
  return await writeInlineParent({
    projectRoot, tree, parent, parentId, arrayField, nextEntries, options, precomputedMutated: mutated, deletedInlineIds: [id],
  });
}

async function writeInlineParent({
  projectRoot, tree, parent, parentId, arrayField, nextEntries, options,
  precomputedMutated = [], deletedInlineIds = [],
}) {
  const parentKind = tree.kindById.get(parentId);
  const next = { ...parent, [arrayField]: nextEntries, updatedAt: nowIso() };
  const relPath = `rcf/${subdirFor(parentKind)}/${parentId.toLowerCase()}.json`;
  const validation = validateDocument({ doc: next, kind: parentKind, filePath: relPath });
  if (validation) return { ...validation, documentId: parentId };
  if (!options.dryRun) {
    try {
      await writeJsonAtomic(pathForKindFile(projectRoot, parentKind, parentId), next);
    } catch (err) {
      return rcfError({ kind: 'ioFailure', message: `delete: write failed: ${err.message}`, filePath: relPath });
    }
  }
  const mutated = [...precomputedMutated, { id: parentId, filePath: relPath }];
  const plan = [
    ...precomputedMutated.map((m) => `mutate ${m.filePath}`),
    `mutate ${relPath} (drop inline entries)`,
  ];
  return { deleted: [...deletedInlineIds], mutated, plan };
}

/**
 * Execute a cascade delete plan (REQ/US cascade). Runs the orphan-refuse
 * pre-plan check first; simulates every FBS/TS `acIds` mutation and
 * refuses the whole cascade if any surviving FBS/TS would fall below
 * minItems:1.
 */
async function executeCascade({ projectRoot, tree, toDelete, collectedAcIds, options }) {
  const deletingSet = new Set(toDelete);
  const orphanCheck = checkAcOrphans(tree, [...collectedAcIds], deletingSet);
  if (orphanCheck) return orphanCheck;

  const mutated = [];
  // For each surviving FBS that references any collected AC, mutate acIds.
  const affectedFbs = new Map();
  const affectedTs = new Map();
  for (const acId of collectedAcIds) {
    for (const fbsId of tree.fbsByAcId.get(acId) ?? []) {
      if (deletingSet.has(fbsId)) continue;
      const fbs = affectedFbs.get(fbsId) ?? { ...tree.byId.get(fbsId) };
      fbs.acIds = (fbs.acIds ?? []).filter((a) => a !== acId);
      affectedFbs.set(fbsId, fbs);
    }
    for (const tsId of tree.tsByAcId.get(acId) ?? []) {
      if (deletingSet.has(tsId)) continue;
      const ts = affectedTs.get(tsId) ?? { ...tree.byId.get(tsId) };
      ts.acIds = (ts.acIds ?? []).filter((a) => a !== acId);
      affectedTs.set(tsId, ts);
    }
  }
  for (const [fbsId, fbs] of affectedFbs) {
    fbs.updatedAt = nowIso();
    const relPath = `rcf/fbs/${fbsId.toLowerCase()}.json`;
    const validation = validateDocument({ doc: fbs, kind: 'fbs', filePath: relPath });
    if (validation) return { ...validation, documentId: fbsId };
    if (!options.dryRun) await writeJsonAtomic(pathForKindFile(projectRoot, 'fbs', fbsId), fbs);
    mutated.push({ id: fbsId, filePath: relPath });
  }
  for (const [tsId, ts] of affectedTs) {
    ts.updatedAt = nowIso();
    const relPath = `rcf/test-suites/${tsId.toLowerCase()}.json`;
    const validation = validateDocument({ doc: ts, kind: 'testSuite', filePath: relPath });
    if (validation) return { ...validation, documentId: tsId };
    if (!options.dryRun) await writeJsonAtomic(pathForKindFile(projectRoot, 'testSuite', tsId), ts);
    mutated.push({ id: tsId, filePath: relPath });
  }
  // Then unlink every file in the toDelete list (leaves first: reverse order).
  const deleted = [];
  for (const delId of [...toDelete].reverse()) {
    const kind = tree.kindById.get(delId);
    if (!kind) continue;
    const relPath = relativePathForChild(kind, delId);
    if (!options.dryRun) {
      try { await unlink(pathForKindFile(projectRoot, kind, delId)); } catch (err) {
        if (err.code !== 'ENOENT') {
          return rcfError({ kind: 'ioFailure', message: `delete: unlink failed: ${err.message}`, filePath: relPath });
        }
      }
    }
    deleted.push(delId);
  }
  return { deleted, mutated, plan: buildPlanLines(deleted, mutated) };
}

/**
 * Check if deleting the given AC ids would leave any surviving FBS/TS
 * with an empty `acIds[]` (schema mandates `minItems: 1`). Optionally
 * skips FBS/TS in `deletingSet` because those are being removed anyway.
 * Returns an RcfError on refusal or null.
 */
function checkAcOrphans(tree, acIds, deletingSet = new Set()) {
  const deletingAcSet = new Set(acIds);
  const orphans = [];
  for (const [acId, fbsList] of tree.fbsByAcId) {
    if (!deletingAcSet.has(acId)) continue;
    for (const fbsId of fbsList) {
      if (deletingSet.has(fbsId)) continue;
      const fbs = tree.byId.get(fbsId);
      const survivorAcIds = (fbs.acIds ?? []).filter((a) => !deletingAcSet.has(a));
      if (survivorAcIds.length === 0) {
        orphans.push({ id: fbsId, kind: 'fbs', drivers: (fbs.acIds ?? []).filter((a) => deletingAcSet.has(a)) });
      }
    }
  }
  for (const [acId, tsList] of tree.tsByAcId) {
    if (!deletingAcSet.has(acId)) continue;
    for (const tsId of tsList) {
      if (deletingSet.has(tsId)) continue;
      const ts = tree.byId.get(tsId);
      const survivorAcIds = (ts.acIds ?? []).filter((a) => !deletingAcSet.has(a));
      if (survivorAcIds.length === 0) {
        orphans.push({ id: tsId, kind: 'testSuite', drivers: (ts.acIds ?? []).filter((a) => deletingAcSet.has(a)) });
      }
    }
  }
  // Deduplicate by id.
  const dedup = new Map();
  for (const o of orphans) if (!dedup.has(o.id)) dedup.set(o.id, o);
  if (dedup.size === 0) return null;
  const lines = [...dedup.values()].map((o) => `${o.id} (${o.kind}) would be orphaned by deletion of ${o.drivers.join(', ')}`);
  return rcfError({
    kind: 'usage',
    message: `delete: cascade would orphan downstream ac lists: ${lines.join('; ')}`,
    rule: 'wouldOrphan',
  });
}

function refuseWithDependents(id, dependents) {
  const parts = [];
  for (const [key, list] of Object.entries(dependents)) {
    if (Array.isArray(list) && list.length > 0) parts.push(`${key}=${list.join(',')}`);
  }
  return rcfError({
    kind: 'usage',
    message: `delete: ${id} has dependents (${parts.join(' ')}); pass --cascade to opt in`,
    documentId: id,
    rule: 'dependents',
  });
}

function buildPlanLines(deleted, mutated) {
  return [
    ...mutated.map((m) => `mutate ${m.filePath}`),
    ...deleted.map((id) => `delete rcf/.../${id.toLowerCase()}.json`),
  ];
}

// ---------------------------------------------------------------------------
// Utilities: deep-merge and dot-path patch
// ---------------------------------------------------------------------------

function deepClone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => deepClone(v));
  const out = {};
  for (const k of Object.keys(value)) out[k] = deepClone(value[k]);
  return out;
}

function deepMergeReplaceArrays(target, source) {
  if (source === null || typeof source !== 'object' || Array.isArray(source)) {
    return deepClone(source);
  }
  const out = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {};
  for (const k of Object.keys(source)) {
    const sv = source[k];
    if (Array.isArray(sv)) {
      out[k] = deepClone(sv);
    } else if (sv && typeof sv === 'object') {
      out[k] = deepMergeReplaceArrays(out[k], sv);
    } else {
      out[k] = sv;
    }
  }
  return out;
}

/**
 * Apply `target.<dotPath> = value`. Supports `a.b.c` and `a.b[0].c`.
 * Returns null on success or a string describing the failure.
 */
function applyDotPath(target, path, value) {
  const parts = parseDotPath(path);
  if (!parts) return `bad path: ${path}`;
  let cur = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const seg = parts[i];
    if (seg.kind === 'index') {
      if (!Array.isArray(cur)) return `path ${path}: expected array at ${seg.value}`;
      if (cur[seg.value] === undefined) cur[seg.value] = {};
      cur = cur[seg.value];
    } else {
      if (cur[seg.value] === undefined || cur[seg.value] === null) cur[seg.value] = {};
      cur = cur[seg.value];
    }
  }
  const last = parts[parts.length - 1];
  if (last.kind === 'index') {
    if (!Array.isArray(cur)) return `path ${path}: expected array at ${last.value}`;
    cur[last.value] = value;
  } else {
    cur[last.value] = value;
  }
  return null;
}

function parseDotPath(path) {
  if (typeof path !== 'string' || path.length === 0) return null;
  const parts = [];
  const segments = path.split('.');
  for (const seg of segments) {
    const re = /^([^\[\]]+)((?:\[\d+\])*)$/;
    const m = re.exec(seg);
    if (!m) return null;
    parts.push({ kind: 'prop', value: m[1] });
    const bracketed = m[2];
    if (bracketed) {
      const indices = bracketed.match(/\d+/g) ?? [];
      for (const n of indices) parts.push({ kind: 'index', value: Number(n) });
    }
  }
  return parts;
}

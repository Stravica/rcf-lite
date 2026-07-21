// Persistence module for CRUD verbs. Wraps every disk write with
// schema validation + referential-integrity checks, gated on the
// POST-WRITE tree state (B5 amendment, E2E matrix 2026-07-06-003): a
// verb never INTRODUCES schema or reference breakage, but pre-existing
// breakage does not wedge the tree - repairing or deleting a broken doc
// is always possible in-tool.
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

import { mkdir, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { rcfError } from '../errors/index.js';
import { pathForId, subdirFor } from './loader.js';
import { validateDocument } from './validator.js';
import { netNewErrors, simulateWriteErrors } from './walker.js';

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
  // Phase 10 (X2 CodeNode bridge): Code Node.
  cn: 'codeNode',
  codeNode: 'codeNode',
};

function canonicalKind(kind) {
  return KIND_ALIASES[kind] ?? kind;
}

// ---------------------------------------------------------------------------
// B5: post-write validation gate
// ---------------------------------------------------------------------------
//
// Write verbs validate the POST-WRITE tree state, not the pre-existing
// state (operator-approved amendment to the Phase-4 refusal semantics,
// E2E matrix 2026-07-06-003 finding B5). A tree that is already broken
// no longer wedges every write: repairing a broken doc is allowed,
// deleting the offending doc is allowed. What stays refused is any
// operation that would introduce NET-NEW breakage - on a valid tree or
// a broken one.

/**
 * Run the operation's change-set through the walker's in-memory
 * simulation and refuse if any error appears post-write that was not
 * present pre-write.
 *
 * @param {object} args
 * @param {TreeModel} args.tree
 * @param {RcfError[]} [args.walkErrors] - pre-write walk errors
 * @param {Array<{ kind: string, id: string, doc: object }>} [args.upserts]
 * @param {string[]} [args.deletes]
 * @param {string} args.verb - for the refusal message
 * @returns {RcfError | null}
 */
function postWriteGate({ tree, walkErrors = [], upserts = [], deletes = [], verb }) {
  const postErrors = simulateWriteErrors({ tree, preErrors: walkErrors, upserts, deletes });
  const netNew = netNewErrors(walkErrors, postErrors);
  if (netNew.length === 0) return null;
  return rcfError({
    kind: 'validation',
    message: `${verb}: refused - the post-write tree would carry new breakage: ${netNew.map((e) => e.message).join('; ')}`,
    rule: 'postWriteValidation',
  });
}

/**
 * Ids of schema-invalid (unloadable) docs of a given canonical kind.
 * Considered occupied for id allocation so a repair-pending id is never
 * silently reallocated (and its file never overwritten).
 *
 * @param {TreeModel} tree
 * @param {string} kind - canonical kind
 * @returns {string[]}
 */
function invalidIdsOfKind(tree, kind) {
  const out = [];
  for (const [id, entry] of tree.invalidDocs ?? []) {
    if (entry.kind === kind) out.push(id);
  }
  return out;
}

async function fileExistsOnDisk(absPath) {
  try {
    await stat(absPath);
    return true;
  } catch {
    return false;
  }
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
  // B5: unloadable (schema-invalid) docs are absent from the doc arrays
  // but their ids are still occupied on disk - include them so an
  // allocation never collides with a repair-pending file.
  switch (k) {
    case 'req':
      return nextFlatId('REQ', [...tree.requirements.map((d) => d.reqId), ...invalidIdsOfKind(tree, 'req')]);
    case 'tac':
      return nextFlatId('TAC', [...tree.tacs.map((d) => d.tacId), ...invalidIdsOfKind(tree, 'tac')]);
    case 'adr':
      return nextFlatId('ADR', [...tree.adrs.map((d) => d.adrId), ...invalidIdsOfKind(tree, 'adr')]);
    case 'fbs':
      return nextFlatId('FBS', [...tree.fbsItems.map((d) => d.fbsId), ...invalidIdsOfKind(tree, 'fbs')]);
    case 'testSuite':
      return nextFlatId('TS', [...tree.testSuites.map((d) => d.id), ...invalidIdsOfKind(tree, 'testSuite')]);
    // Phase 10 (X2 CodeNode bridge): Code Node. Flat namespace like
    // REQ/TAC/ADR/FBS/TS - no parent required (D13).
    case 'codeNode':
      return nextFlatId('CN', [...(tree.codeNodes ?? []).map((d) => d.cnId), ...invalidIdsOfKind(tree, 'codeNode')]);
    case 'userStory': {
      const reqId = opts.parentId;
      const match = /^REQ-(\d+)$/.exec(reqId ?? '');
      if (!match) {
        throw new TypeError('nextIdForKind us requires opts.parentId matching REQ-XXX');
      }
      const groupDigit = String(Number(match[1]));
      const usIds = [
        ...tree.userStories
          .filter((us) => us.reqId === reqId)
          .map((us) => us.usId),
        // B5: count unloadable US ids that numerically belong to this
        // REQ's group so a repair-pending id is never reallocated.
        ...invalidIdsOfKind(tree, 'userStory').filter((invId) => {
          const mm = /^US-(\d+)$/.exec(invId);
          if (!mm) return false;
          const local = Number(mm[1]) - Number(groupDigit) * 100;
          return local >= 1 && local <= 99;
        }),
      ];
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
 * @param {RcfError[]} [args.walkErrors] - pre-write walk errors (B5 gate)
 * @returns {Promise<{ id: string, filePath: string, body: object } | RcfError>}
 */
export async function createDocument({ projectRoot, tree, kind, body, options = {}, walkErrors = [] }) {
  const canonical = canonicalKind(kind);
  const parentId = options.parentId;
  const parentField = PARENT_FIELD_FOR[canonical];
  const expectedParentKind = EXPECTED_PARENT_KIND_FOR[canonical];

  // Inline kinds route through mutateInline().
  if (canonical === 'ac') {
    return await createInlineAc({ projectRoot, tree, options, body, walkErrors });
  }
  if (canonical === 'tc') {
    return await createInlineTc({ projectRoot, tree, options, body, walkErrors });
  }
  // Phase 10 (X2 CodeNode bridge): CN has no parent field (D13) - its
  // identity is `path`, not a position in the PRD/REQ/US tree.
  if (canonical === 'codeNode') {
    return await createCn({ projectRoot, tree, options, body, walkErrors });
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
    // B5: an unloadable (schema-invalid) doc still occupies its id.
    if (tree.byId.has(id) || tree.invalidDocs?.has(id)) {
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
  // B5: never silently overwrite an on-disk file that failed to load
  // entirely (e.g. parse-broken) - such files are absent from both byId
  // and invalidDocs, so the id checks above cannot see them.
  if (await fileExistsOnDisk(absPath)) {
    return rcfError({
      kind: 'usage',
      message: `create ${kind}: ${relPath} already exists on disk but did not load; repair or delete it first`,
      documentId: id,
      filePath: relPath,
    });
  }
  const gateErr = postWriteGate({
    tree,
    walkErrors,
    upserts: [{ kind: canonical, id, doc: finalBody }],
    verb: `create ${kind}`,
  });
  if (gateErr) return { ...gateErr, documentId: id };
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
      stack: err.stack,
    });
  }
  return { id, filePath: relPath, body: finalBody };
}

/**
 * Create a Code Node (Phase 10, X2 CodeNode bridge, D13). CN has no
 * parent field - identity is `path`, optionally `#symbol`-suffixed
 * (D2). `implementsAcIds` MAY be empty (an orphan CN is legitimate,
 * D3); every non-empty entry must resolve to a known AC.
 * `dependencies` MAY be empty; every entry must resolve to an existing
 * CN and may not self-reference.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {TreeModel} args.tree
 * @param {object} args.options
 * @param {string} [args.options.id]
 * @param {boolean} [args.options.dryRun]
 * @param {object} args.body
 * @param {string} args.body.path - required
 * @param {string[]} [args.body.implementsAcIds]
 * @param {string[]} [args.body.dependencies]
 * @param {RcfError[]} [args.walkErrors]
 * @returns {Promise<{ id: string, filePath: string, body: object } | RcfError>}
 */
async function createCn({ projectRoot, tree, options, body, walkErrors = [] }) {
  const path = body?.path;
  if (typeof path !== 'string' || path.length === 0) {
    return rcfError({ kind: 'usage', message: 'create cn: --path is required' });
  }

  let id = options.id;
  if (id) {
    if (tree.byId.has(id) || tree.invalidDocs?.has(id)) {
      return rcfError({ kind: 'usage', message: `create cn: id ${id} is already taken`, documentId: id });
    }
  } else {
    id = nextIdForKind(tree, 'codeNode');
  }

  const implementsAcIds = body.implementsAcIds ?? [];
  const allAcIds = collectAllAcIds(tree);
  for (const acId of implementsAcIds) {
    if (!allAcIds.has(acId)) {
      return rcfError({
        kind: 'brokenReference',
        message: `create cn: implementsAcIds entry ${acId} does not resolve to a known AC`,
        documentId: acId,
        field: 'implementsAcIds',
        rule: 'resolveTo:ac',
      });
    }
  }

  const dependencies = body.dependencies ?? [];
  for (const depId of dependencies) {
    if (depId === id) {
      return rcfError({
        kind: 'usage',
        message: `create cn: dependencies entry ${depId} cannot be the node's own id`,
        documentId: id,
        field: 'dependencies',
      });
    }
    if (tree.kindById.get(depId) !== 'codeNode') {
      return rcfError({
        kind: 'brokenReference',
        message: `create cn: dependencies entry ${depId} does not resolve to a known code node`,
        documentId: depId,
        field: 'dependencies',
        rule: 'resolveTo:codeNode',
      });
    }
  }

  const now = nowIso();
  const finalBody = {
    cnId: id,
    path,
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    implementsAcIds,
    dependencies,
    version: body.version ?? '0.1.0',
    status: body.status ?? 'draft',
    createdAt: now,
    updatedAt: now,
  };

  const relPath = relativePathForChild('codeNode', id);
  const validation = validateDocument({ doc: finalBody, kind: 'codeNode', filePath: relPath });
  if (validation) return { ...validation, documentId: id };

  const absPath = pathForKindFile(projectRoot, 'codeNode', id);
  if (await fileExistsOnDisk(absPath)) {
    return rcfError({
      kind: 'usage',
      message: `create cn: ${relPath} already exists on disk but did not load; repair or delete it first`,
      documentId: id,
      filePath: relPath,
    });
  }
  const gateErr = postWriteGate({
    tree,
    walkErrors,
    upserts: [{ kind: 'codeNode', id, doc: finalBody }],
    verb: 'create cn',
  });
  if (gateErr) return { ...gateErr, documentId: id };
  if (options.dryRun) {
    return { id, filePath: relPath, body: finalBody, dryRun: true };
  }
  try {
    await writeJsonAtomic(absPath, finalBody);
  } catch (err) {
    return rcfError({
      kind: 'ioFailure',
      message: `create cn: write failed: ${err.message}`,
      filePath: relPath,
      stack: err.stack,
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
  // BUG-002/BUG-003 fix: `--title` is a CLI convenience seed. The writer's
  // job is to place it in the field the kind's schema wants — `title` for
  // req/us/adr/fbs/ts (schema-required) or `name` for tac (which lacks
  // `title` and forbids additional properties). Lift the seed out of the
  // base body so it never leaks via the spread below, then place it
  // explicitly per kind. This also stops the previous title→description /
  // title→summary / title→purpose cross-fallbacks that produced doc bodies
  // where two semantic fields carried the same value.
  const titleSeed = typeof base.title === 'string' ? base.title : undefined;
  delete base.title;
  // B1 fix (E2E matrix 2026-07-06-003): timestamps are writer-owned. The
  // `...base` spread below previously let a caller-supplied createdAt /
  // updatedAt (via --from-file or the MCP body object) override the
  // writer clock - a date-only "today" value serialised as midnight UTC
  // produced updatedAt EARLIER than the same doc's createdAt. Strip both
  // so create mirrors update, which already refuses createdAt and forces
  // updatedAt = nowIso().
  delete base.createdAt;
  delete base.updatedAt;
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
        title: titleSeed ?? 'TODO: name this requirement',
        description: base.description ?? 'TODO: describe this requirement.',
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
        title: titleSeed ?? 'TODO: name this user story',
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
        purpose: base.purpose ?? 'TODO: state the purpose',
        responsibilities: base.responsibilities ?? ['TODO: list at least one responsibility'],
        name: base.name ?? titleSeed ?? 'TODO: name this component',
      };
    case 'adr':
      return {
        ...withTimestamps,
        adrId: id,
        prdId,
        tadId: parentId,
        version: base.version ?? '0.1.0',
        status: base.status ?? 'proposed',
        title: titleSeed ?? 'TODO: name this ADR',
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
        title: titleSeed ?? 'TODO: name this build session',
        summary: base.summary ?? 'TODO: describe the build session',
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
        title: titleSeed ?? 'TODO: name this test suite',
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
async function createInlineAc({ projectRoot, tree, options, body, walkErrors = [] }) {
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
  const gateErr = postWriteGate({
    tree,
    walkErrors,
    upserts: [{ kind: 'userStory', id: parentUsId, doc: nextUs }],
    verb: 'create ac',
  });
  if (gateErr) return { ...gateErr, documentId: parentUsId };
  if (options.dryRun) {
    return { id: acId, filePath: relPath, parentId: parentUsId, dryRun: true, body: acEntry };
  }
  try {
    await writeJsonAtomic(pathForKindFile(projectRoot, 'userStory', parentUsId), nextUs);
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `create ac: write failed: ${err.message}`, filePath: relPath, stack: err.stack });
  }
  return { id: acId, filePath: relPath, parentId: parentUsId, body: acEntry };
}

/**
 * Create an inline TC under a parent TS.
 */
async function createInlineTc({ projectRoot, tree, options, body, walkErrors = [] }) {
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
  const gateErr = postWriteGate({
    tree,
    walkErrors,
    upserts: [{ kind: 'testSuite', id: parentTsId, doc: nextTs }],
    verb: 'create tc',
  });
  if (gateErr) return { ...gateErr, documentId: parentTsId };
  if (options.dryRun) {
    return { id: tcId, filePath: relPath, parentId: parentTsId, dryRun: true, body: tcEntry };
  }
  try {
    await writeJsonAtomic(pathForKindFile(projectRoot, 'testSuite', parentTsId), nextTs);
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `create tc: write failed: ${err.message}`, filePath: relPath, stack: err.stack });
  }
  return { id: tcId, filePath: relPath, parentId: parentTsId, body: tcEntry };
}

/**
 * Derive a slug from a description string. Lowercase, alphanumerics
 * plus hyphens, first 40 chars max, single hyphen runs. Truncation
 * lands on a word boundary: if the 40-char cut falls mid-word the
 * partial word is dropped (B2 fix, E2E matrix 2026-07-06-003 - ids
 * like "...-saved-whil" chopped mid-word). A single unbroken word
 * longer than the limit keeps its 40-char prefix (no boundary exists).
 * @param {string} description
 */
export function deriveSlug(description) {
  const full = String(description)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  let slug = full.slice(0, 40);
  if (full.length > 40 && full[40] !== '-') {
    // The cut landed inside a word - back off to the last hyphen.
    const boundary = slug.lastIndexOf('-');
    if (boundary > 0) slug = slug.slice(0, boundary);
  }
  slug = slug.replace(/-+$/g, '');
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
 * @param {RcfError[]} [args.walkErrors] - pre-write walk errors (B5 gate)
 * @returns {Promise<{ id: string, filePath: string, body: object } | RcfError>}
 */
export async function updateDocument({ projectRoot, tree, id, patch, sets = [], options = {}, walkErrors = [] }) {
  // Inline id resolution.
  const inline = resolveInlineId(id);
  if (inline) {
    return await updateInline({
      projectRoot, tree, inline, id, patch, sets, options, walkErrors,
    });
  }
  // Root or child document.
  const resolved = pathForId(id);
  if (!resolved) {
    return rcfError({ kind: 'usage', message: `update: unrecognised id ${id}`, documentId: id });
  }
  const kind = resolved.kind;
  const rootKinds = new Set(['prd', 'tad', 'buildSequence']);
  // B5: schema-invalid docs are absent from byId but stay addressable
  // via invalidDocs - updating one is exactly how a wedged tree gets
  // repaired (the post-write gate ensures the repair actually repairs).
  let doc;
  if (rootKinds.has(kind)) {
    doc = tree.byId.get(id) ?? tree[rootKindTreeKey(kind)] ?? tree.invalidDocs?.get(id)?.doc;
  } else if (kind === 'manifest') {
    doc = tree.manifest;
  } else {
    doc = tree.byId.get(id) ?? tree.invalidDocs?.get(id)?.doc;
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

  // B5 gate: the updated doc must not introduce net-new tree breakage
  // (e.g. dropping an AC that a surviving FBS / TS still references).
  if (kind !== 'manifest') {
    const gateErr = postWriteGate({
      tree,
      walkErrors,
      upserts: [{ kind, id, doc: next }],
      verb: 'update',
    });
    if (gateErr) return { ...gateErr, documentId: id };
  }

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
    return rcfError({ kind: 'ioFailure', message: `update: write failed: ${err.message}`, filePath: relPath, stack: err.stack });
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
  // Phase 10 (X2 CodeNode bridge): CN cross-link resolution on update.
  if (kind === 'codeNode') {
    for (const acId of doc.implementsAcIds ?? []) {
      if (!allAcIds.has(acId)) {
        return rcfError({
          kind: 'brokenReference', message: `update: implementsAcIds entry ${acId} does not resolve to a known AC`,
          documentId: docId, field: 'implementsAcIds', rule: 'resolveTo:ac',
        });
      }
    }
    for (const depId of doc.dependencies ?? []) {
      if (depId === docId || tree.kindById.get(depId) !== 'codeNode') {
        return rcfError({
          kind: 'brokenReference', message: `update: dependencies entry ${depId} is invalid`,
          documentId: docId, field: 'dependencies', rule: 'resolveTo:codeNode',
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
async function updateInline({ projectRoot, tree, inline, id, patch, sets, options, walkErrors = [] }) {
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
  const gateErr = postWriteGate({
    tree,
    walkErrors,
    upserts: [{ kind, id: parentId, doc: nextParent }],
    verb: 'update',
  });
  if (gateErr) return { ...gateErr, documentId: parentId };
  if (options.dryRun) {
    return { id, filePath: relPath, parentId, body: entry, dryRun: true };
  }
  try {
    await writeJsonAtomic(pathForKindFile(projectRoot, kind, parentId), nextParent);
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `update: write failed: ${err.message}`, filePath: relPath, stack: err.stack });
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
 * @param {RcfError[]} [args.walkErrors] - pre-write walk errors (B5 gate)
 * @returns {Promise<{ deleted: string[], mutated: Array<{ id: string, filePath: string }>, plan: string[] } | RcfError>}
 */
export async function deleteDocument({ projectRoot, tree, id, options = {}, walkErrors = [] }) {
  const inline = resolveInlineId(id);
  if (inline) {
    return await deleteInline({ projectRoot, tree, inline, id, options, walkErrors });
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
    // B5: the doc may exist on disk but have failed to load (schema-
    // invalid or parse-broken). Deleting it is the canonical escape from
    // a wedged tree; a delete is never blocked by validation errors
    // attributable solely to the doc being deleted. The post-write gate
    // still refuses if removing the file would introduce NET-NEW
    // breakage elsewhere.
    const invalid = tree.invalidDocs?.get(id);
    const absPath = pathForKindFile(projectRoot, kind, id);
    if (invalid || await fileExistsOnDisk(absPath)) {
      const gateErr = postWriteGate({ tree, walkErrors, deletes: [id], verb: 'delete' });
      if (gateErr) return gateErr;
      const relPath = relativePathForChild(kind, id);
      if (!options.dryRun) {
        try { await unlink(absPath); } catch (err) {
          return rcfError({ kind: 'ioFailure', message: `delete: unlink failed: ${err.message}`, filePath: relPath, stack: err.stack });
        }
      }
      return { deleted: [id], mutated: [], plan: [`delete ${relPath}`] };
    }
    return rcfError({ kind: 'usage', message: `delete: id ${id} not found`, documentId: id });
  }

  const cascade = Boolean(options.cascade);

  switch (kind) {
    case 'req': return await deleteReq({ projectRoot, tree, id, cascade, options, walkErrors });
    case 'userStory': return await deleteUs({ projectRoot, tree, id, cascade, options, walkErrors });
    case 'tac': return await deleteTac({ projectRoot, tree, id, cascade, options, walkErrors });
    case 'adr': return await deleteAdr({ projectRoot, tree, id, options, walkErrors });
    case 'fbs': return await deleteFbs({ projectRoot, tree, id, cascade, options, walkErrors });
    case 'testSuite': return await deleteTs({ projectRoot, tree, id, options, walkErrors });
    // Phase 10 (X2 CodeNode bridge, D13): refused while depended-on,
    // mirroring the FBS dependsOnFbsIds pattern.
    case 'codeNode': return await deleteCn({ projectRoot, tree, id, cascade, options, walkErrors });
    default:
      return rcfError({ kind: 'usage', message: `delete: unsupported kind ${kind}`, documentId: id });
  }
}

async function deleteReq({ projectRoot, tree, id, cascade, options, walkErrors = [] }) {
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
    walkErrors,
  });
}

async function deleteUs({ projectRoot, tree, id, cascade, options, walkErrors = [] }) {
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
    walkErrors,
  });
}

async function deleteTac({ projectRoot, tree, id, cascade, options, walkErrors = [] }) {
  const dependents = (tree.usByTacId.get(id) ?? []).slice();
  if (!cascade && dependents.length > 0) {
    return refuseWithDependents(id, { usDependents: dependents });
  }
  // Two-phase (B5): compute every mutation first, gate the whole
  // change-set on the post-write tree state, then flush.
  const pending = [];
  if (cascade) {
    for (const usId of dependents) {
      const us = tree.byId.get(usId);
      const next = { ...us, tacIds: (us.tacIds ?? []).filter((t) => t !== id), updatedAt: nowIso() };
      if (next.tacIds.length === 0) delete next.tacIds; // schema allows omission (minItems:0 with optional presence)
      const relPath = `rcf/user-stories/${usId.toLowerCase()}.json`;
      const validation = validateDocument({ doc: next, kind: 'userStory', filePath: relPath });
      if (validation) return { ...validation, documentId: usId };
      pending.push({ kind: 'userStory', id: usId, doc: next, relPath });
    }
  }
  const gateErr = postWriteGate({
    tree,
    walkErrors,
    upserts: pending.map((p) => ({ kind: p.kind, id: p.id, doc: p.doc })),
    deletes: [id],
    verb: 'delete',
  });
  if (gateErr) return gateErr;
  const mutated = [];
  for (const p of pending) {
    if (!options.dryRun) await writeJsonAtomic(pathForKindFile(projectRoot, p.kind, p.id), p.doc);
    mutated.push({ id: p.id, filePath: p.relPath });
  }
  // Delete the TAC file.
  const tacRel = `rcf/tacs/${id.toLowerCase()}.json`;
  if (!options.dryRun) {
    try { await unlink(pathForKindFile(projectRoot, 'tac', id)); } catch (err) {
      return rcfError({ kind: 'ioFailure', message: `delete: unlink failed: ${err.message}`, filePath: tacRel, stack: err.stack });
    }
  }
  return { deleted: [id], mutated, plan: buildPlanLines([id], mutated) };
}

async function deleteAdr({ projectRoot, tree, id, options, walkErrors = [] }) {
  const gateErr = postWriteGate({ tree, walkErrors, deletes: [id], verb: 'delete' });
  if (gateErr) return gateErr;
  const adrRel = `rcf/adrs/${id.toLowerCase()}.json`;
  if (!options.dryRun) {
    try { await unlink(pathForKindFile(projectRoot, 'adr', id)); } catch (err) {
      return rcfError({ kind: 'ioFailure', message: `delete: unlink failed: ${err.message}`, filePath: adrRel, stack: err.stack });
    }
  }
  return { deleted: [id], mutated: [], plan: [`delete ${adrRel}`] };
}

async function deleteFbs({ projectRoot, tree, id, cascade, options, walkErrors = [] }) {
  const dependents = (tree.dependentsByFbsId.get(id) ?? []).slice();
  if (!cascade && dependents.length > 0) {
    return refuseWithDependents(id, { fbsDependents: dependents });
  }
  const pending = [];
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
      pending.push({ kind: 'fbs', id: depFbsId, doc: next, relPath });
    }
  }
  const gateErr = postWriteGate({
    tree,
    walkErrors,
    upserts: pending.map((p) => ({ kind: p.kind, id: p.id, doc: p.doc })),
    deletes: [id],
    verb: 'delete',
  });
  if (gateErr) return gateErr;
  const mutated = [];
  for (const p of pending) {
    if (!options.dryRun) await writeJsonAtomic(pathForKindFile(projectRoot, p.kind, p.id), p.doc);
    mutated.push({ id: p.id, filePath: p.relPath });
  }
  const fbsRel = `rcf/fbs/${id.toLowerCase()}.json`;
  if (!options.dryRun) {
    try { await unlink(pathForKindFile(projectRoot, 'fbs', id)); } catch (err) {
      return rcfError({ kind: 'ioFailure', message: `delete: unlink failed: ${err.message}`, filePath: fbsRel, stack: err.stack });
    }
  }
  return { deleted: [id], mutated, plan: buildPlanLines([id], mutated) };
}

/**
 * Delete a Code Node (Phase 10, D13). Refused by default while another
 * CN depends on it (dependentsByCnId); --cascade drops the dependency
 * edge from every dependent CN's `dependencies[]` before removing the
 * file, mirroring `deleteFbs`.
 */
async function deleteCn({ projectRoot, tree, id, cascade, options, walkErrors = [] }) {
  const dependents = (tree.dependentsByCnId.get(id) ?? []).slice();
  if (!cascade && dependents.length > 0) {
    return refuseWithDependents(id, { cnDependents: dependents });
  }
  const pending = [];
  if (cascade) {
    for (const depCnId of dependents) {
      const dep = tree.byId.get(depCnId);
      const next = {
        ...dep,
        dependencies: (dep.dependencies ?? []).filter((d) => d !== id),
        updatedAt: nowIso(),
      };
      const relPath = `rcf/code-nodes/${depCnId.toLowerCase()}.json`;
      const validation = validateDocument({ doc: next, kind: 'codeNode', filePath: relPath });
      if (validation) return { ...validation, documentId: depCnId };
      pending.push({ kind: 'codeNode', id: depCnId, doc: next, relPath });
    }
  }
  const gateErr = postWriteGate({
    tree,
    walkErrors,
    upserts: pending.map((p) => ({ kind: p.kind, id: p.id, doc: p.doc })),
    deletes: [id],
    verb: 'delete',
  });
  if (gateErr) return gateErr;
  const mutated = [];
  for (const p of pending) {
    if (!options.dryRun) await writeJsonAtomic(pathForKindFile(projectRoot, p.kind, p.id), p.doc);
    mutated.push({ id: p.id, filePath: p.relPath });
  }
  const cnRel = `rcf/code-nodes/${id.toLowerCase()}.json`;
  if (!options.dryRun) {
    try { await unlink(pathForKindFile(projectRoot, 'codeNode', id)); } catch (err) {
      return rcfError({ kind: 'ioFailure', message: `delete: unlink failed: ${err.message}`, filePath: cnRel, stack: err.stack });
    }
  }
  return { deleted: [id], mutated, plan: buildPlanLines([id], mutated) };
}

async function deleteTs({ projectRoot, tree, id, options, walkErrors = [] }) {
  const gateErr = postWriteGate({ tree, walkErrors, deletes: [id], verb: 'delete' });
  if (gateErr) return gateErr;
  const tsRel = `rcf/test-suites/${id.toLowerCase()}.json`;
  if (!options.dryRun) {
    try { await unlink(pathForKindFile(projectRoot, 'testSuite', id)); } catch (err) {
      return rcfError({ kind: 'ioFailure', message: `delete: unlink failed: ${err.message}`, filePath: tsRel, stack: err.stack });
    }
  }
  return { deleted: [id], mutated: [], plan: [`delete ${tsRel}`] };
}

/**
 * Delete an inline AC / TC entry. Refuses with exit 4 if the AC has
 * cross-link dependents; --cascade opts in and mutates FBS/TS acIds
 * accordingly (with an orphan-refuse pre-plan check per §D9).
 */
async function deleteInline({ projectRoot, tree, inline, id, options, walkErrors = [] }) {
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
      projectRoot, tree, walkErrors, parent, parentId, arrayField, nextEntries, options, deletedInlineIds: [id],
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
  // Cascade path: compute FBS/TS acIds mutations (no writes yet - the
  // whole change-set is gated in writeInlineParent), orphan-refuse.
  const pending = [];
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
      pending.push({ kind: 'fbs', id: fbsId, doc: next, relPath });
    }
    for (const tsId of dependentTs) {
      const ts = tree.byId.get(tsId);
      const nextAcIds = (ts.acIds ?? []).filter((a) => a !== id);
      const next = { ...ts, acIds: nextAcIds, updatedAt: nowIso() };
      const relPath = `rcf/test-suites/${tsId.toLowerCase()}.json`;
      const validation = validateDocument({ doc: next, kind: 'testSuite', filePath: relPath });
      if (validation) return { ...validation, documentId: tsId };
      pending.push({ kind: 'testSuite', id: tsId, doc: next, relPath });
    }
  }
  return await writeInlineParent({
    projectRoot, tree, walkErrors, parent, parentId, arrayField, nextEntries, options, pendingMutations: pending, deletedInlineIds: [id],
  });
}

async function writeInlineParent({
  projectRoot, tree, walkErrors = [], parent, parentId, arrayField, nextEntries, options,
  pendingMutations = [], deletedInlineIds = [],
}) {
  const parentKind = tree.kindById.get(parentId);
  const next = { ...parent, [arrayField]: nextEntries, updatedAt: nowIso() };
  const relPath = `rcf/${subdirFor(parentKind)}/${parentId.toLowerCase()}.json`;
  const validation = validateDocument({ doc: next, kind: parentKind, filePath: relPath });
  if (validation) return { ...validation, documentId: parentId };
  // B5 gate over the whole change-set (cascade mutations + parent edit).
  const gateErr = postWriteGate({
    tree,
    walkErrors,
    upserts: [
      ...pendingMutations.map((m) => ({ kind: m.kind, id: m.id, doc: m.doc })),
      { kind: parentKind, id: parentId, doc: next },
    ],
    verb: 'delete',
  });
  if (gateErr) return gateErr;
  if (!options.dryRun) {
    try {
      for (const m of pendingMutations) {
        await writeJsonAtomic(pathForKindFile(projectRoot, m.kind, m.id), m.doc);
      }
      await writeJsonAtomic(pathForKindFile(projectRoot, parentKind, parentId), next);
    } catch (err) {
      return rcfError({ kind: 'ioFailure', message: `delete: write failed: ${err.message}`, filePath: relPath, stack: err.stack });
    }
  }
  const mutated = [
    ...pendingMutations.map((m) => ({ id: m.id, filePath: m.relPath })),
    { id: parentId, filePath: relPath },
  ];
  const plan = [
    ...pendingMutations.map((m) => `mutate ${m.relPath}`),
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
async function executeCascade({ projectRoot, tree, toDelete, collectedAcIds, options, walkErrors = [] }) {
  const deletingSet = new Set(toDelete);
  const orphanCheck = checkAcOrphans(tree, [...collectedAcIds], deletingSet);
  if (orphanCheck) return orphanCheck;

  // Two-phase (B5): compute every surviving-doc mutation, gate the whole
  // change-set on the post-write tree state, then flush writes + unlinks.
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
  const pending = [];
  for (const [fbsId, fbs] of affectedFbs) {
    fbs.updatedAt = nowIso();
    const relPath = `rcf/fbs/${fbsId.toLowerCase()}.json`;
    const validation = validateDocument({ doc: fbs, kind: 'fbs', filePath: relPath });
    if (validation) return { ...validation, documentId: fbsId };
    pending.push({ kind: 'fbs', id: fbsId, doc: fbs, relPath });
  }
  for (const [tsId, ts] of affectedTs) {
    ts.updatedAt = nowIso();
    const relPath = `rcf/test-suites/${tsId.toLowerCase()}.json`;
    const validation = validateDocument({ doc: ts, kind: 'testSuite', filePath: relPath });
    if (validation) return { ...validation, documentId: tsId };
    pending.push({ kind: 'testSuite', id: tsId, doc: ts, relPath });
  }
  const gateErr = postWriteGate({
    tree,
    walkErrors,
    upserts: pending.map((p) => ({ kind: p.kind, id: p.id, doc: p.doc })),
    deletes: toDelete,
    verb: 'delete',
  });
  if (gateErr) return gateErr;
  const mutated = [];
  for (const p of pending) {
    if (!options.dryRun) await writeJsonAtomic(pathForKindFile(projectRoot, p.kind, p.id), p.doc);
    mutated.push({ id: p.id, filePath: p.relPath });
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
          return rcfError({ kind: 'ioFailure', message: `delete: unlink failed: ${err.message}`, filePath: relPath, stack: err.stack });
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
    ...deleted.map((id) => {
      // BUG-006 fix: resolve the real kind-directory from the id prefix
      // instead of emitting the `rcf/.../` placeholder. `pathForId`
      // returns `{ kind, relPath }` where `relPath` already includes the
      // kind subdirectory (e.g. `requirements/req-002.json`); prepend
      // the `rcf/` root to line up with the other plan lines.
      const resolved = pathForId(id);
      const rel = resolved ? `rcf/${resolved.relPath}` : `rcf/${id.toLowerCase()}.json`;
      return `delete ${rel}`;
    }),
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

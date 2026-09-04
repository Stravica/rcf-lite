// Document loader. Resolves an id (or a manifest-relative path) under the
// project's rcf/ tree, reads the file, parses JSON, validates against the
// matching schema, and returns the document or a structured error.
//
// This is the only place that touches the filesystem on the read path; the
// walker, the validate command and the view layer all go through it.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { rcfError } from '../errors/index.js';
import { familyLocation, parseIdParts } from './ids.js';
import { validateDocument } from './validator.js';

/**
 * Map a document kind to the subdirectory under rcf/ it lives in. The root
 * documents (manifest, prd, tad, buildSequence) live at the rcf root and
 * return null.
 *
 * @param {string} kind
 * @returns {string|null}
 */
export function subdirFor(kind) {
  switch (kind) {
    case 'req': return 'requirements';
    case 'userStory': return 'user-stories';
    case 'tac': return 'tacs';
    case 'adr': return 'adrs';
    case 'fbs': return 'fbs';
    case 'testSuite': return 'test-suites';
    // Phase 10 (X2 CodeNode bridge): Code Node document type.
    case 'codeNode': return 'code-nodes';
    // rcf-schemas 0.6.0 EVAL doc type. One file per EVAL under rcf/evals/.
    // EVAL is optional in the chain; required only for ACs marked
    // determinism: nonDeterministic.
    case 'evalDoc': return 'evals';
    default: return null;
  }
}

const ROOT_FILENAMES = {
  manifest: 'manifest.json',
  prd: 'prd.json',
  tad: 'tad.json',
  buildSequence: 'build-sequence.json',
};

/**
 * Resolve an id like "REQ-002" (or a blueprint-namespaced id like
 * "spa-REQ-001" / "ADR-005-spa") to a path under rcf/.
 *
 * The id grammar lives in `./ids.js` (`parseIdParts` / `familyLocation`);
 * this function is the read-side application of it. Prefix-family ids
 * (REQ / US / PRD / BS / TAD / TS) may carry a leading slug namespace;
 * suffix-family ids (ADR / TAC / FBS / CN) may carry a trailing slug
 * namespace. Either way the filename on disk is the lower-cased id
 * (blueprint apply's `destPathFor` writes it that way; the CLI writer
 * matches).
 *
 * Returns null when the id matches no known family pattern OR when the
 * family has no top-level file (AC and TC live inline under their
 * parent US / TS).
 *
 * @param {string} id - canonical id, e.g. "REQ-002", "spa-REQ-001", "ADR-005-spa"
 * @returns {{ kind: string, relPath: string } | null}
 */
export function pathForId(id) {
  const parts = parseIdParts(id);
  if (!parts) return null;
  const loc = familyLocation(parts.family);
  if (!loc) return null;
  // Root families (PRD / TAD / BS) resolve to their single root file.
  if (loc.rootFile) return { kind: loc.kind, relPath: loc.rootFile };
  // Child families resolve to <subdir>/<lower(id)>.json. AC / TC have no
  // subdir entry and fall through to null via `!loc` above.
  if (!loc.subdir) return null;
  return { kind: loc.kind, relPath: `${loc.subdir}/${id.toLowerCase()}.json` };
}

/**
 * Path for a known root document.
 *
 * @param {keyof typeof ROOT_FILENAMES} kind
 * @returns {string}
 */
export function rootPathFor(kind) {
  const name = ROOT_FILENAMES[kind];
  if (!name) throw new TypeError(`Not a root kind: ${kind}`);
  return name;
}

/**
 * Read a file under the rcf root and parse JSON.
 *
 * @param {string} projectRoot - absolute path to project root
 * @param {string} relPath - path relative to <projectRoot>/rcf/
 * @returns {Promise<{ raw: string, doc: object } | import('../errors/index.js').RcfError>}
 */
async function readJson(projectRoot, relPath) {
  const filePath = join(projectRoot, 'rcf', relPath);
  let raw;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return rcfError({
        kind: 'missingFile',
        message: `File not found: rcf/${relPath}`,
        filePath: `rcf/${relPath}`,
      });
    }
    return rcfError({
      kind: 'ioFailure',
      message: `Failed to read file: ${/** @type {Error} */ (err).message}`,
      filePath: `rcf/${relPath}`,
    });
  }
  try {
    const doc = JSON.parse(raw);
    return { raw, doc };
  } catch (err) {
    return rcfError({
      kind: 'parseFailure',
      message: `JSON parse failed: ${/** @type {Error} */ (err).message}`,
      filePath: `rcf/${relPath}`,
    });
  }
}

/**
 * Load and validate one document by id.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} args.id
 * @returns {Promise<{ doc: object, raw: string, kind: string, filePath: string } | import('../errors/index.js').RcfError>}
 */
export async function loadDocument({ projectRoot, id }) {
  const resolved = pathForId(id);
  if (!resolved) {
    return rcfError({
      kind: 'usage',
      message: `Unrecognised document id: ${id}`,
      documentId: id,
    });
  }
  const result = await readJson(projectRoot, resolved.relPath);
  if ('kind' in result && 'message' in result) {
    const err = /** @type {import('../errors/index.js').RcfError} */ (result);
    return { ...err, documentId: id };
  }
  const { doc, raw } = result;
  const validationError = validateDocument({
    doc,
    kind: resolved.kind,
    filePath: `rcf/${resolved.relPath}`,
  });
  if (validationError) {
    // B5 (post-write validation): the parsed body rides along on the
    // error so the walker can keep schema-invalid documents addressable
    // (tree.invalidDocs) - a wedged doc must stay repairable/deletable.
    return { ...validationError, documentId: id, doc, raw };
  }
  return { doc, raw, kind: resolved.kind, filePath: `rcf/${resolved.relPath}` };
}

/**
 * Enumerate every `*.json` filename under `rcf/<subdir>/`, sorted. Not a
 * discovery mechanism for tree topology (topology comes from parent-id
 * fields); this is just the load-time enumeration required to bring every
 * on-disk file into memory. Callers derive the document id from the
 * filename stem by upper-casing the PREFIX segment only (0.8.0
 * slug-train, w-2026-07-28-012 landmine 1); slug tails stay verbatim
 * because rcf-schemas 0.4.3 admits lower-case kebab tails on FBS / CN /
 * ADR / TAC and a full-stem fold would silently detach the graph.
 *
 * Returns `{ files: string[] }` on success. Missing subdir returns
 * `{ files: [] }` (an empty children collection is a valid tree state).
 * IO failure returns `{ error: RcfError }`.
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {string} args.subdir - subdir under `rcf/`, e.g. `requirements`
 * @returns {Promise<{ files: string[] } | { error: import('../errors/index.js').RcfError }>}
 */
export async function listSubdirJsonFiles({ projectRoot, subdir }) {
  let entries;
  try {
    entries = await readdir(join(projectRoot, 'rcf', subdir));
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { files: [] };
    }
    return {
      error: rcfError({
        kind: 'ioFailure',
        message: `Failed to read directory: ${/** @type {Error} */ (err).message}`,
        filePath: `rcf/${subdir}`,
      }),
    };
  }
  const files = entries.filter((e) => e.endsWith('.json')).sort();
  return { files };
}

/**
 * Load and validate a root document (manifest / prd / tad / buildSequence).
 *
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {keyof typeof ROOT_FILENAMES} args.kind
 * @returns {Promise<{ doc: object, raw: string, kind: string, filePath: string } | import('../errors/index.js').RcfError>}
 */
export async function loadRootDocument({ projectRoot, kind }) {
  const relPath = rootPathFor(kind);
  const result = await readJson(projectRoot, relPath);
  if ('kind' in result && 'message' in result) {
    return /** @type {import('../errors/index.js').RcfError} */ (result);
  }
  const { doc, raw } = result;
  const validationError = validateDocument({
    doc,
    kind,
    filePath: `rcf/${relPath}`,
  });
  // B5: parsed body rides along on validation errors (see loadDocument).
  if (validationError) return { ...validationError, doc, raw };
  return { doc, raw, kind, filePath: `rcf/${relPath}` };
}

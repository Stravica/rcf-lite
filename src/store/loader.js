// Document loader. Resolves an id (or a manifest-relative path) under the
// project's rcf/ tree, reads the file, parses JSON, validates against the
// matching schema, and returns the document or a structured error.
//
// This is the only place that touches the filesystem on the read path; the
// walker, the validate command and the view layer all go through it.

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { rcfError } from '../errors/index.js';
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
 * Resolve an id like "REQ-002" to a path under rcf/.
 *
 * @param {string} id - canonical id, e.g. "REQ-002", "US-201", "FBS-003"
 * @returns {{ kind: string, relPath: string } | null} null if the id pattern is unknown
 */
export function pathForId(id) {
  if (typeof id !== 'string') return null;
  if (id.startsWith('REQ-')) return { kind: 'req', relPath: `requirements/${id.toLowerCase()}.json` };
  if (id.startsWith('US-')) return { kind: 'userStory', relPath: `user-stories/${id.toLowerCase()}.json` };
  if (id.startsWith('TAC-')) return { kind: 'tac', relPath: `tacs/${id.toLowerCase()}.json` };
  if (id.startsWith('ADR-')) return { kind: 'adr', relPath: `adrs/${id.toLowerCase()}.json` };
  if (id.startsWith('FBS-')) return { kind: 'fbs', relPath: `fbs/${id.toLowerCase()}.json` };
  if (id.startsWith('TS-')) return { kind: 'testSuite', relPath: `test-suites/${id.toLowerCase()}.json` };
  if (id === 'PRD-001' || id.startsWith('PRD-')) return { kind: 'prd', relPath: 'prd.json' };
  if (id === 'TAD-001' || id.startsWith('TAD-')) return { kind: 'tad', relPath: 'tad.json' };
  if (id === 'BS-001' || id.startsWith('BS-')) return { kind: 'buildSequence', relPath: 'build-sequence.json' };
  return null;
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
    return { ...validationError, documentId: id };
  }
  return { doc, raw, kind: resolved.kind, filePath: `rcf/${resolved.relPath}` };
}

/**
 * Enumerate every `*.json` filename under `rcf/<subdir>/`, sorted. Not a
 * discovery mechanism for tree topology (topology comes from parent-id
 * fields); this is just the load-time enumeration required to bring every
 * on-disk file into memory. Callers derive the document id from the
 * filename stem in upper case (per the layout convention).
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
  if (validationError) return validationError;
  return { doc, raw, kind, filePath: `rcf/${relPath}` };
}

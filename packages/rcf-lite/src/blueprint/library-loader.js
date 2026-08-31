// External-library manifest loader. Reads and validates `library.json` at
// a library root, then walks the declared blueprints[] entries to confirm
// each names a directory whose own `blueprint.json` validates against the
// phase-1 blueprint loader.
//
// See external-blueprint-libraries-spec-2026-08-31.md sections 3 and 3.1
// for the manifest shape and field contract.
//
// Phase 2b covers local-path libraries (a directory the operator already
// has on disk). Network fetchers (git, tarball) are a Phase 2c concern
// and are NOT implemented here; the loader is happy to work against any
// directory that carries a valid `library.json`.

import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { rcfError } from '../core/errors/index.js';
import { loadBlueprint } from './loader.js';

const KEBAB_SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const KNOWN_SUFFIX_BLOCK_KINDS = new Set(['adr', 'tac']);
const LIBRARY_VERSION_KNOWN = 1;

/**
 * @typedef {object} LibraryBandAc
 * @property {number} start
 * @property {number} end
 */

/**
 * @typedef {object} LibrarySuffixBlock
 * @property {'adr' | 'tac'} kind
 * @property {number} start
 * @property {number} end
 */

/**
 * @typedef {object} LibraryBands
 * @property {LibraryBandAc} ac
 * @property {LibrarySuffixBlock[]} [suffixBlocks]
 */

/**
 * @typedef {object} LibraryBlueprintEntry
 * @property {string} slug
 * @property {string} path
 */

/**
 * @typedef {object} LibraryPublisher
 * @property {string} id
 * @property {string} displayName
 * @property {string} [contact]
 */

/**
 * @typedef {object} LoadedLibrary
 * @property {number} libraryVersion
 * @property {string} libraryPrefix
 * @property {string} displayName
 * @property {LibraryPublisher} publisher
 * @property {string} libraryRef
 * @property {LibraryBands} bands
 * @property {LibraryBlueprintEntry[]} blueprints
 * @property {string} [notes]
 * @property {string} root              absolute path to the library root
 */

/**
 * Load and validate a library from a directory that carries a
 * `library.json` at its root plus a `blueprints/` subtree.
 *
 * @param {string} libraryRoot - absolute or relative path
 * @param {object} [opts]
 * @param {boolean} [opts.validateBlueprints=true] - when false, skips the
 *   per-blueprint validation walk. Add-time review-on-add sets this to
 *   true so the operator sees a real refusal on a broken shelf; a
 *   registry read at resolver-time can set false to keep the hot path
 *   cheap.
 * @returns {Promise<LoadedLibrary | import('../core/errors/index.js').RcfError>}
 */
export async function loadLibrary(libraryRoot, opts = {}) {
  const root = resolve(libraryRoot);
  const metaPath = join(root, 'library.json');
  try {
    await stat(metaPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return rcfError({
        kind: 'usage',
        message: `library: no library.json found at ${metaPath}`,
        filePath: metaPath,
      });
    }
    return rcfError({ kind: 'ioFailure', message: `library: ${err.message}`, filePath: metaPath });
  }
  let raw;
  try {
    raw = await readFile(metaPath, 'utf8');
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `library: read failed: ${err.message}`, filePath: metaPath });
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return rcfError({ kind: 'parseFailure', message: `library: JSON parse failed: ${err.message}`, filePath: metaPath });
  }
  const shapeError = validateManifestShape(doc, metaPath);
  if (shapeError) return shapeError;

  const loaded = {
    libraryVersion: doc.libraryVersion,
    libraryPrefix: doc.libraryPrefix,
    displayName: doc.displayName,
    publisher: {
      id: doc.publisher.id,
      displayName: doc.publisher.displayName,
      ...(typeof doc.publisher.contact === 'string' ? { contact: doc.publisher.contact } : {}),
    },
    libraryRef: doc.libraryRef,
    bands: normaliseBands(doc.bands),
    blueprints: doc.blueprints.map((b) => ({ slug: b.slug, path: b.path })),
    ...(typeof doc.notes === 'string' ? { notes: doc.notes } : {}),
    root,
  };

  if (opts.validateBlueprints !== false) {
    const walkErr = await validateDeclaredBlueprints(loaded);
    if (walkErr) return walkErr;
  }
  return loaded;
}

function validateManifestShape(doc, metaPath) {
  if (typeof doc !== 'object' || doc === null) {
    return rcfError({ kind: 'validation', message: 'library.json must be a JSON object', filePath: metaPath });
  }
  if (!Number.isInteger(doc.libraryVersion) || doc.libraryVersion < 1) {
    return rcfError({ kind: 'validation', message: `library.json: libraryVersion must be a positive integer, got ${JSON.stringify(doc.libraryVersion)}`, filePath: metaPath });
  }
  if (doc.libraryVersion > LIBRARY_VERSION_KNOWN) {
    return rcfError({
      kind: 'validation',
      message: `library.json: libraryVersion ${doc.libraryVersion} is newer than this CLI understands (max ${LIBRARY_VERSION_KNOWN}); upgrade rcf-lite.`,
      filePath: metaPath,
    });
  }
  if (typeof doc.libraryPrefix !== 'string' || !KEBAB_SLUG.test(doc.libraryPrefix)) {
    return rcfError({ kind: 'validation', message: `library.json: libraryPrefix '${doc.libraryPrefix}' is not a valid kebab slug`, filePath: metaPath });
  }
  if (typeof doc.displayName !== 'string' || doc.displayName.length === 0) {
    return rcfError({ kind: 'validation', message: 'library.json: displayName is required (non-empty string)', filePath: metaPath });
  }
  if (typeof doc.publisher !== 'object' || doc.publisher === null) {
    return rcfError({ kind: 'validation', message: 'library.json: publisher object is required', filePath: metaPath });
  }
  if (typeof doc.publisher.id !== 'string' || !KEBAB_SLUG.test(doc.publisher.id)) {
    return rcfError({ kind: 'validation', message: `library.json: publisher.id '${doc.publisher.id}' is not a valid short slug`, filePath: metaPath });
  }
  if (typeof doc.publisher.displayName !== 'string' || doc.publisher.displayName.length === 0) {
    return rcfError({ kind: 'validation', message: 'library.json: publisher.displayName is required', filePath: metaPath });
  }
  if (doc.publisher.contact !== undefined && typeof doc.publisher.contact !== 'string') {
    return rcfError({ kind: 'validation', message: 'library.json: publisher.contact must be a string when present', filePath: metaPath });
  }
  if (typeof doc.libraryRef !== 'string' || doc.libraryRef.length === 0) {
    return rcfError({ kind: 'validation', message: 'library.json: libraryRef is required (non-empty string)', filePath: metaPath });
  }
  const bandsError = validateBands(doc.bands, metaPath);
  if (bandsError) return bandsError;
  if (!Array.isArray(doc.blueprints) || doc.blueprints.length === 0) {
    return rcfError({ kind: 'validation', message: 'library.json: blueprints[] is required and must not be empty', filePath: metaPath });
  }
  const seenSlugs = new Set();
  for (const [i, entry] of doc.blueprints.entries()) {
    if (typeof entry !== 'object' || entry === null) {
      return rcfError({ kind: 'validation', message: `library.json: blueprints[${i}] must be an object`, filePath: metaPath });
    }
    if (typeof entry.slug !== 'string' || !KEBAB_SLUG.test(entry.slug)) {
      return rcfError({ kind: 'validation', message: `library.json: blueprints[${i}].slug '${entry.slug}' is not a valid kebab slug`, filePath: metaPath });
    }
    if (seenSlugs.has(entry.slug)) {
      return rcfError({ kind: 'validation', message: `library.json: blueprints[${i}].slug '${entry.slug}' is declared more than once`, filePath: metaPath });
    }
    seenSlugs.add(entry.slug);
    if (typeof entry.path !== 'string' || entry.path.length === 0) {
      return rcfError({ kind: 'validation', message: `library.json: blueprints[${i}].path is required (non-empty string)`, filePath: metaPath });
    }
    if (isAbsolute(entry.path)) {
      return rcfError({ kind: 'validation', message: `library.json: blueprints[${i}].path '${entry.path}' must be relative to the library root`, filePath: metaPath });
    }
    if (entry.path.split(/[\\/]/).some((s) => s === '..')) {
      return rcfError({ kind: 'validation', message: `library.json: blueprints[${i}].path '${entry.path}' contains a '..' segment (parent-directory traversal is refused)`, filePath: metaPath });
    }
  }
  if (doc.notes !== undefined && typeof doc.notes !== 'string') {
    return rcfError({ kind: 'validation', message: 'library.json: notes must be a string when present', filePath: metaPath });
  }
  return null;
}

function validateBands(bands, metaPath) {
  if (typeof bands !== 'object' || bands === null) {
    return rcfError({ kind: 'validation', message: 'library.json: bands object is required', filePath: metaPath });
  }
  if (typeof bands.ac !== 'object' || bands.ac === null) {
    return rcfError({ kind: 'validation', message: 'library.json: bands.ac object is required with { start, end }', filePath: metaPath });
  }
  const err = validateBandRange('bands.ac', bands.ac, metaPath);
  if (err) return err;
  if (bands.suffixBlocks !== undefined) {
    if (!Array.isArray(bands.suffixBlocks)) {
      return rcfError({ kind: 'validation', message: 'library.json: bands.suffixBlocks must be an array when present', filePath: metaPath });
    }
    for (const [i, block] of bands.suffixBlocks.entries()) {
      if (typeof block !== 'object' || block === null) {
        return rcfError({ kind: 'validation', message: `library.json: bands.suffixBlocks[${i}] must be an object`, filePath: metaPath });
      }
      if (typeof block.kind !== 'string' || !KNOWN_SUFFIX_BLOCK_KINDS.has(block.kind)) {
        return rcfError({ kind: 'validation', message: `library.json: bands.suffixBlocks[${i}].kind '${block.kind}' must be one of ${[...KNOWN_SUFFIX_BLOCK_KINDS].join(', ')}`, filePath: metaPath });
      }
      const subErr = validateBandRange(`bands.suffixBlocks[${i}]`, block, metaPath);
      if (subErr) return subErr;
    }
  }
  return null;
}

function validateBandRange(label, range, metaPath) {
  if (!Number.isInteger(range.start) || !Number.isInteger(range.end)) {
    return rcfError({ kind: 'validation', message: `library.json: ${label}.start and ${label}.end must be integers`, filePath: metaPath });
  }
  if (range.start < 1 || range.end > 99999) {
    return rcfError({ kind: 'validation', message: `library.json: ${label} out of allowed 1..99999 range (got ${range.start}..${range.end})`, filePath: metaPath });
  }
  if (range.start > range.end) {
    return rcfError({ kind: 'validation', message: `library.json: ${label}.start (${range.start}) must be <= ${label}.end (${range.end})`, filePath: metaPath });
  }
  return null;
}

function normaliseBands(bands) {
  const out = { ac: { start: bands.ac.start, end: bands.ac.end } };
  if (Array.isArray(bands.suffixBlocks)) {
    out.suffixBlocks = bands.suffixBlocks.map((b) => ({ kind: b.kind, start: b.start, end: b.end }));
  }
  return out;
}

async function validateDeclaredBlueprints(library) {
  for (const entry of library.blueprints) {
    const bpRoot = join(library.root, entry.path);
    const loaded = await loadBlueprint(bpRoot);
    if (loaded.kind) {
      return rcfError({
        kind: 'validation',
        message: `library.json: blueprint '${entry.slug}' at '${entry.path}' failed to load: ${loaded.message}`,
        filePath: bpRoot,
      });
    }
    if (loaded.slug !== entry.slug) {
      return rcfError({
        kind: 'validation',
        message: `library.json: blueprint '${entry.slug}' at '${entry.path}' declares its own slug '${loaded.slug}' on disk (library manifest and blueprint.json must agree)`,
        filePath: bpRoot,
      });
    }
  }
  return null;
}

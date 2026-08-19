// Blueprint loader. Phase 1 keeps the loader local: a blueprint source
// is a filesystem directory containing a `blueprint.json` metadata file
// plus a `contributions/` subdirectory. The metadata declares the
// blueprint's slug, version, and every contribution's { id, kind, path
// (relative to contributions/) }. ADR contributions may carry a
// `scope: 'global'` tag plus a `topic` string; these are the only
// contributions the conflict detector reasons about.
//
// The registry / git-ref resolver is a Phase 2 concern (SPA and REST
// blueprints ship as npm packages); this loader intentionally has no
// network path so tests are hermetic.

import { readFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { rcfError } from '../core/errors/index.js';

/**
 * @typedef {object} BlueprintContribution
 * @property {string} id           canonical id (bare or already namespaced)
 * @property {'prd'|'req'|'us'|'tad'|'tac'|'adr'|'bs'|'fbs'|'ts'|'cn'} kind
 * @property {string} path         relative to the blueprint's contributions/
 * @property {'global'} [scope]    ADR only; marks whole-project decisions
 * @property {string}   [topic]    ADR only when scope=global; conflict key
 */

/**
 * @typedef {object} LoadedBlueprint
 * @property {string} slug
 * @property {string} version
 * @property {string} source        source directory (absolute)
 * @property {BlueprintContribution[]} contributions
 */

/**
 * Load a blueprint's metadata from a directory containing blueprint.json.
 *
 * @param {string} source - path to the blueprint's root directory
 * @returns {Promise<LoadedBlueprint | import('../core/errors/index.js').RcfError>}
 */
export async function loadBlueprint(source) {
  const root = resolve(source);
  const metaPath = join(root, 'blueprint.json');
  try {
    await stat(metaPath);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return rcfError({
        kind: 'usage',
        message: `blueprint: no blueprint.json found at ${metaPath}`,
        filePath: metaPath,
      });
    }
    return rcfError({ kind: 'ioFailure', message: `blueprint: ${err.message}`, filePath: metaPath });
  }
  let raw;
  try {
    raw = await readFile(metaPath, 'utf8');
  } catch (err) {
    return rcfError({ kind: 'ioFailure', message: `blueprint: read failed: ${err.message}`, filePath: metaPath });
  }
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch (err) {
    return rcfError({ kind: 'parseFailure', message: `blueprint: JSON parse failed: ${err.message}`, filePath: metaPath });
  }
  const validation = validateMetadata(doc, metaPath);
  if (validation) return validation;
  return {
    slug: doc.slug,
    version: doc.version,
    source: root,
    contributions: Array.isArray(doc.contributions) ? doc.contributions : [],
  };
}

function validateMetadata(doc, metaPath) {
  if (typeof doc !== 'object' || doc === null) {
    return rcfError({ kind: 'validation', message: 'blueprint.json must be a JSON object', filePath: metaPath });
  }
  if (typeof doc.slug !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(doc.slug)) {
    return rcfError({ kind: 'validation', message: `blueprint.json: slug '${doc.slug}' is not a valid kebab slug`, filePath: metaPath });
  }
  if (typeof doc.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(doc.version)) {
    return rcfError({ kind: 'validation', message: `blueprint.json: version '${doc.version}' is not semver`, filePath: metaPath });
  }
  if (doc.contributions !== undefined && !Array.isArray(doc.contributions)) {
    return rcfError({ kind: 'validation', message: 'blueprint.json: contributions must be an array', filePath: metaPath });
  }
  for (const c of doc.contributions ?? []) {
    if (typeof c.id !== 'string' || typeof c.kind !== 'string' || typeof c.path !== 'string') {
      return rcfError({ kind: 'validation', message: 'blueprint.json: every contribution needs { id, kind, path }', filePath: metaPath });
    }
    if (c.scope !== undefined && c.scope !== 'global') {
      return rcfError({ kind: 'validation', message: `blueprint.json: contribution ${c.id} scope must be 'global' when present`, filePath: metaPath });
    }
    if (c.scope === 'global' && typeof c.topic !== 'string') {
      return rcfError({ kind: 'validation', message: `blueprint.json: scope=global contribution ${c.id} requires a topic`, filePath: metaPath });
    }
  }
  return null;
}

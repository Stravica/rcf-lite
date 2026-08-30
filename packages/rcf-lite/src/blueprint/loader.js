// Blueprint loader. Phase 1 keeps the loader local: a blueprint source
// is a filesystem directory containing a `blueprint.json` metadata file
// plus a `contributions/` subdirectory. The metadata declares the
// blueprint's slug, version, and every contribution's { id, kind, path
// (relative to contributions/) }. ADR contributions may carry a
// `scope: 'global'` tag plus a `topic` string; these are the only
// contributions the conflict detector reasons about.
//
// The registry / git-ref resolver is a Phase 2 concern (application-spa and application-api-rest
// blueprints ship as npm packages); this loader intentionally has no
// network path so tests are hermetic.

import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { rcfError } from '../core/errors/index.js';

// Contribution kinds a blueprint MAY carry. The RCF hierarchy is composed
// downward: a blueprint contributes REQuirements, UserStories, TACs and
// ADRs (plus their supporting FBS / TS / CN artefacts written by later
// phases). PRDs, TADs and the Build Sequence are project-level singletons
// -- one PRD per project, one TAD per project, one BS per project -- so
// no blueprint gets to own them. FBS is excluded by ratified principle
// (composition happens at the requirements layer, not the build layer).
const CONTRIBUTABLE_KINDS = new Set(['req', 'us', 'tac', 'adr', 'ts', 'cn']);
const ROOT_SINGLETON_KINDS = new Set(['prd', 'tad', 'bs']);
const EXCLUDED_KINDS = new Set(['fbs']);

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
 * @property {string} [category]    optional shelf-grouping tag; kebab slug.
 *                                  Read by `rcf define blueprint list` and by
 *                                  the docs blueprint shelf to group entries.
 *                                  The starter vocabulary (`application`,
 *                                  `security`, `email`, `deploy`, `delivery`,
 *                                  `persistence`, `observability`) lives in
 *                                  the authoring standard; the loader
 *                                  validates the shape (kebab slug), not the
 *                                  vocabulary, so a new category can be
 *                                  minted by adding it to the standard
 *                                  without a code change.
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
    ...(typeof doc.category === 'string' ? { category: doc.category } : {}),
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
  if (doc.category !== undefined) {
    // Category is optional; when present it must be a kebab slug (same
    // shape as blueprint slug). The loader validates SHAPE only: the
    // vocabulary (application, security, email, deploy, delivery,
    // persistence, observability-essentials, and future additions) is documented
    // in the authoring standard rather than pinned in code, so a new
    // category minted at standard-review time does not need a loader
    // change. The docs shelf and `rcf define blueprint list` render
    // whatever category strings appear on the applied blueprints.
    if (typeof doc.category !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(doc.category)) {
      return rcfError({ kind: 'validation', message: `blueprint.json: category '${doc.category}' is not a valid kebab slug`, filePath: metaPath });
    }
  }
  if (doc.contributions !== undefined && !Array.isArray(doc.contributions)) {
    return rcfError({ kind: 'validation', message: 'blueprint.json: contributions must be an array', filePath: metaPath });
  }
  for (const c of doc.contributions ?? []) {
    if (typeof c.id !== 'string' || typeof c.kind !== 'string' || typeof c.path !== 'string') {
      return rcfError({ kind: 'validation', message: 'blueprint.json: every contribution needs { id, kind, path }', filePath: metaPath });
    }
    // Kind gate. Blueprints compose downward from project singletons;
    // PRD / TAD / BS are per-project artefacts a blueprint never gets
    // to overwrite, and FBS is excluded by ratified principle
    // (composition sits at the requirements layer). This is enforced
    // pre-registry so a mis-authored blueprint fails at load time
    // rather than at the apply-time collision.
    if (ROOT_SINGLETON_KINDS.has(c.kind)) {
      return rcfError({
        kind: 'validation',
        message: `blueprint.json: contribution ${c.id} kind '${c.kind}' is a project singleton and cannot be blueprint-owned`,
        filePath: metaPath,
      });
    }
    if (EXCLUDED_KINDS.has(c.kind)) {
      return rcfError({
        kind: 'validation',
        message: `blueprint.json: contribution ${c.id} kind '${c.kind}' is excluded from blueprint composition by ratified principle (FBS lives at the project's build layer)`,
        filePath: metaPath,
      });
    }
    if (!CONTRIBUTABLE_KINDS.has(c.kind)) {
      return rcfError({
        kind: 'validation',
        message: `blueprint.json: contribution ${c.id} kind '${c.kind}' is not a recognised contributable kind (expected one of: ${[...CONTRIBUTABLE_KINDS].join(', ')})`,
        filePath: metaPath,
      });
    }
    // Path guard. Contribution paths are ALWAYS relative to the
    // blueprint's contributions/ directory. Reject absolute paths and
    // `..` traversal outright; a registry-fetched blueprint that
    // slipped through with an escaping path would land arbitrary
    // bytes wherever the resolved path pointed. Belt-and-braces
    // before Phase 2 fronts this loader with a registry.
    const pathError = validateContributionPath(c.path, c.id);
    if (pathError) return rcfError({ kind: 'validation', message: pathError, filePath: metaPath });
    if (c.scope !== undefined && c.scope !== 'global') {
      return rcfError({ kind: 'validation', message: `blueprint.json: contribution ${c.id} scope must be 'global' when present`, filePath: metaPath });
    }
    if (c.scope === 'global' && typeof c.topic !== 'string') {
      return rcfError({ kind: 'validation', message: `blueprint.json: scope=global contribution ${c.id} requires a topic`, filePath: metaPath });
    }
  }
  return null;
}

function validateContributionPath(p, id) {
  if (typeof p !== 'string' || p.length === 0) {
    return `blueprint.json: contribution ${id} path must be a non-empty string`;
  }
  if (isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p)) {
    return `blueprint.json: contribution ${id} path '${p}' must be relative (absolute paths are refused)`;
  }
  const segments = p.split(/[\\/]/);
  if (segments.some((s) => s === '..')) {
    return `blueprint.json: contribution ${id} path '${p}' contains a '..' segment (parent-directory traversal is refused)`;
  }
  return null;
}

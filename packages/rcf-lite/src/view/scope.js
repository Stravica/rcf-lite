// Deep-link scope resolution. Pure helpers shared by the server-side
// /scope.json endpoint, the CLI `audit view open` verb, and the
// live-client filter. Nothing here reads process.env, prints, or
// mutates state.
//
// Scope model (spec: w-2026-08-30-dave-020, Baz-ratified 2026-08-30):
//   * blueprint scope  -> the applied blueprint's namespaced
//     contribution ids, read from manifest.blueprints[].contributions[].
//     The applied record IS the truth (project-local), never the
//     shipping blueprint source (which may drift or vanish).
//   * node scope       -> a single document id (any kind in tree.byId),
//     resolved by the existing hash-router in the client script. Server
//     validates existence so a bad id refuses at the CLI seam rather
//     than opening a dead browser tab.
//   * customisation set -> the subset of contribution ids whose current
//     on-disk bytes differ from the shipping blueprint source's file.
//     Best-effort: any read failure (source missing, unreadable) treats
//     the file as "unknown" (excluded), which the renderer displays as
//     plain in-scope rather than as customised.

import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { loadBlueprint } from '../blueprint/loader.js';
import { resolveBlueprintSource } from '../blueprint/shelf-resolver.js';
import { isRcfError } from '../core/errors/index.js';

/**
 * Parse the recognised scope keys from a URL query string.
 *
 * @param {URLSearchParams} params
 * @returns {{ blueprint: string|null, node: string|null }}
 */
export function parseUrlScope(params) {
  const blueprint = normaliseString(params.get('blueprint'));
  const node = normaliseString(params.get('node'));
  return { blueprint, node };
}

function normaliseString(v) {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Resolve the applied blueprint record for a slug.
 *
 * @param {object|null} manifest
 * @param {string} slug
 * @returns {{ found: false } | { found: true, record: object, contributionIds: string[] }}
 */
export function contributionsForBlueprint(manifest, slug) {
  if (!manifest || !Array.isArray(manifest.blueprints)) return { found: false };
  const record = manifest.blueprints.find((b) => b?.slug === slug);
  if (!record) return { found: false };
  const contributionIds = Array.isArray(record.contributions)
    ? record.contributions.map((c) => c?.id).filter((id) => typeof id === 'string')
    : [];
  return { found: true, record, contributionIds };
}

/**
 * List every applied blueprint slug present in the manifest. Used by
 * the client to preflight scope requests without a round trip per view.
 *
 * @param {object|null} manifest
 * @returns {string[]}
 */
export function listAppliedSlugs(manifest) {
  if (!manifest || !Array.isArray(manifest.blueprints)) return [];
  return manifest.blueprints
    .map((b) => (typeof b?.slug === 'string' ? b.slug : null))
    .filter((s) => s !== null);
}

/**
 * Detect which of the applied blueprint's contribution files have been
 * modified on disk since apply. Compares current file bytes to the
 * shipping source file bytes. Source paths that no longer resolve are
 * treated as "unknown" (excluded from the result), so a deleted
 * shipping tree does not fake a full-tree customisation banner.
 *
 * @param {object} args
 * @param {string} args.projectRoot - absolute path to the project root
 * @param {object} args.record - applied blueprint record
 * @param {(abs: string) => Promise<string>} [args._readFile] - test seam
 * @returns {Promise<{ customisedIds: string[], missingSourceIds: string[] }>}
 */
export async function detectCustomisations({ projectRoot, record, _readFile, _loadBlueprint, _resolveSource }) {
  const readImpl = _readFile ?? ((abs) => readFile(abs, 'utf8'));
  const loadImpl = _loadBlueprint ?? loadBlueprint;
  const resolveImpl = _resolveSource ?? resolveBlueprintSource;
  const customisedIds = [];
  const missingSourceIds = [];
  if (!record || !Array.isArray(record.contributions)) {
    return { customisedIds, missingSourceIds };
  }
  const sourceAbs = await resolveSourceAbs(projectRoot, record.source, resolveImpl);
  const sourceIndex = await loadSourceContributionIndex({ sourceAbs, loadImpl });
  for (const c of record.contributions) {
    if (typeof c?.id !== 'string' || typeof c?.path !== 'string') continue;
    const projectAbs = resolve(projectRoot, c.path);
    let currentBytes = null;
    try {
      currentBytes = await readImpl(projectAbs);
    } catch {
      // No project-side file: not a customisation (nothing on disk).
      continue;
    }
    if (!sourceIndex) {
      missingSourceIds.push(c.id);
      continue;
    }
    // Cross-reference by CONTRIBUTION INDEX (position). The applied
    // record and the shipping blueprint list contributions in the same
    // order at apply time; the applied record's ids are namespaced
    // (stampId) but the position map is stable and does not rely on
    // any string derivation.
    const sourcePathRelative = sourceIndex.byAppliedId(c.id);
    if (!sourcePathRelative) {
      missingSourceIds.push(c.id);
      continue;
    }
    const sourceFileAbs = join(sourceAbs, 'contributions', sourcePathRelative);
    let sourceBytes = null;
    try {
      sourceBytes = await readImpl(sourceFileAbs);
    } catch {
      missingSourceIds.push(c.id);
      continue;
    }
    if (currentBytes !== sourceBytes) customisedIds.push(c.id);
  }
  return { customisedIds, missingSourceIds };
}

async function resolveSourceAbs(projectRoot, source, resolveImpl) {
  if (typeof source !== 'string' || source.length === 0) return null;
  if (isAbsolute(source)) return source;
  // Non-path sources - a library colon ref (`wsd:auth-oauth2`), an
  // `@stock/<slug>` sugar, or a bare shelf slug - need re-resolution
  // through the blueprint resolver against the project registry and the
  // packaged shelf. Without this, the applied-record's source is a
  // token the FS cannot open and every contribution renders as
  // missingSource in /scope.json (integration review d-2026-08-31-046).
  // A relative filesystem path still falls through to the pre-fix
  // resolve() below so an existing manifest carrying `./blueprint-foo`
  // keeps its behaviour.
  if (typeof projectRoot === 'string' && projectRoot.length > 0) {
    const resolved = await resolveImpl(source, { projectRoot }).catch(() => null);
    if (resolved && !isRcfError(resolved) && typeof resolved.resolved === 'string') {
      return resolved.resolved;
    }
  }
  // Fallback: treat as a relative filesystem path against projectRoot.
  // Matches pre-fix behaviour byte-for-byte; a missing directory
  // surfaces as `missingSource` via the loader below rather than here.
  return typeof projectRoot === 'string' && projectRoot.length > 0
    ? resolve(projectRoot, source)
    : null;
}

/**
 * Load the shipping blueprint's contribution list and build an
 * applied-id -> source-relative-path index. Falls back to id-based
 * lookup when positions don't align (a re-apply that added ids will
 * still resolve the shared prefix).
 */
async function loadSourceContributionIndex({ sourceAbs, loadImpl }) {
  if (!sourceAbs) return null;
  const loaded = await loadImpl(sourceAbs).catch(() => null);
  if (!loaded || loaded.kind) return null;
  const contributions = Array.isArray(loaded.contributions) ? loaded.contributions : [];
  // Two indexes: exact id match (works whenever the operator used the
  // default namespace, i.e. shipping id === applied id) and bare-id
  // suffix match (works when the applied id carries a namespace prefix
  // over a bare shipping id, e.g. `myproj-application-spa-REQ-001`
  // over shipping `application-spa-REQ-001`).
  const exact = new Map();
  for (const sc of contributions) {
    if (typeof sc?.id !== 'string' || typeof sc?.path !== 'string') continue;
    exact.set(sc.id, sc.path);
  }
  return {
    byAppliedId(appliedId) {
      if (exact.has(appliedId)) return exact.get(appliedId);
      // Namespace fall-back: strip the leading namespace segment and
      // retry. The applied stampId only prefixes; it never rewrites
      // the trailing bare id.
      const idx = appliedId.indexOf('-');
      if (idx > 0) {
        const tail = appliedId.slice(idx + 1);
        if (exact.has(tail)) return exact.get(tail);
      }
      return null;
    },
  };
}

/**
 * Best-effort node-id existence check against a tree model. Kept here
 * (not in tree-model.js) so the CLI can validate a --node argument
 * without pulling the full renderer pipeline in.
 *
 * @param {import('#core/store/walker.js').Tree} tree
 * @param {string} id
 * @returns {boolean}
 */
export function treeHasId(tree, id) {
  if (!tree || typeof id !== 'string' || id.length === 0) return false;
  if (tree.byId && typeof tree.byId.get === 'function') return tree.byId.has(id);
  return false;
}

/**
 * Fast async-friendly stat wrapper. Handy for tests that want to prove
 * the customisation check honours missing files without stubbing the
 * whole fs module.
 *
 * @param {string} abs
 * @returns {Promise<boolean>}
 */
export async function fileExists(abs) {
  try {
    const s = await stat(abs);
    return s.isFile();
  } catch {
    return false;
  }
}

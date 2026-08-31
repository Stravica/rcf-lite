// Blueprint list. Reads manifest.blueprints[] and returns rows in
// appliedAt order. Rows are already validated by the schema; this
// module is a projection.
//
// Category enrichment lives in `enrichRowsWithCategories`. The applied
// manifest record's shape is pinned by `@stravica-ai/rcf-schemas`
// (additionalProperties: false on appliedBlueprintRecord), so category
// is not persisted on apply. Instead each row's `source` path is
// re-loaded at list time to read the shipping blueprint's own
// `blueprint.json:category`. A source that no longer resolves surfaces
// as `category: null` so grouped rendering can place it under an
// uncategorised heading rather than swallow the row.

import { isAbsolute } from 'node:path';

import { isRcfError } from '../core/errors/index.js';
import { loadBlueprint } from './loader.js';
import { resolveBlueprintSource } from './shelf-resolver.js';

/**
 * @param {import('#core/store/walker.js').TreeModel} tree
 * @returns {Array<{ slug: string, version: string, appliedAt: string, source: string, namespace: string | null, contributionCount: number }>}
 */
export function listBlueprints(tree) {
  const list = tree.manifest?.blueprints ?? [];
  return [...list]
    .sort((a, b) => String(a.appliedAt).localeCompare(String(b.appliedAt)))
    .map((b) => ({
      slug: b.slug,
      version: b.version,
      appliedAt: b.appliedAt,
      source: b.source,
      namespace: b.namespace ?? null,
      contributionCount: Array.isArray(b.contributions) ? b.contributions.length : 0,
    }));
}

/**
 * Enrich list rows with a `category` field, read from each row's
 * shipping blueprint source. Best-effort: any load failure yields
 * `category: null` so the caller can render the row under an
 * uncategorised group rather than skip it.
 *
 * A row's `source` may be a non-path token in two ratified cases: an
 * external-library colon ref (`wsd:auth-oauth2`, spec §5.3) and, on
 * legacy manifests pre-#128, bare shelf sugar (`application-spa`).
 * Both re-resolve through `resolveBlueprintSource` against `projectRoot`
 * before we hand a filesystem path to the loader; without this every
 * such row would render under `uncategorised` (integration review
 * d-2026-08-31-046).
 *
 * @param {ReturnType<typeof listBlueprints>} rows
 * @param {object} [opts]
 * @param {string} [opts.projectRoot] - absolute path to the project root.
 *   Required to re-resolve library colon refs and bare shelf slugs.
 *   Absolute-path sources still work when omitted (they need no
 *   re-resolution), so tests that only exercise absolute paths keep
 *   their existing single-argument shape.
 * @returns {Promise<Array<{ slug: string, version: string, appliedAt: string, source: string, namespace: string | null, contributionCount: number, category: string | null }>>}
 */
export async function enrichRowsWithCategories(rows, opts = {}) {
  const projectRoot = typeof opts.projectRoot === 'string' && opts.projectRoot.length > 0
    ? opts.projectRoot
    : null;
  const out = [];
  for (const row of rows) {
    let category = null;
    if (typeof row.source === 'string' && row.source.length > 0) {
      const sourceAbs = await resolveSourceForList(row.source, projectRoot);
      if (sourceAbs !== null) {
        const loaded = await loadBlueprint(sourceAbs);
        if (!loaded.kind && typeof loaded.category === 'string') {
          category = loaded.category;
        }
      }
    }
    out.push({ ...row, category });
  }
  return out;
}

async function resolveSourceForList(source, projectRoot) {
  if (isAbsolute(source)) return source;
  if (projectRoot === null) return null;
  const resolved = await resolveBlueprintSource(source, { projectRoot }).catch(() => null);
  if (resolved && !isRcfError(resolved) && typeof resolved.resolved === 'string') {
    return resolved.resolved;
  }
  return null;
}

/**
 * Group category-enriched rows by category. Preserves appliedAt order
 * within each group. Categories are returned sorted alphabetically;
 * rows with no category collect under a final `null` group so the
 * renderer can label them (`uncategorised`) without a magic string
 * leaking into the group key.
 *
 * @param {Awaited<ReturnType<typeof enrichRowsWithCategories>>} rows
 * @returns {Array<{ category: string | null, rows: typeof rows }>}
 */
export function groupRowsByCategory(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const key = typeof row.category === 'string' ? row.category : null;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }
  const named = [...buckets.keys()]
    .filter((k) => k !== null)
    .sort((a, b) => a.localeCompare(b));
  const groups = named.map((category) => ({ category, rows: buckets.get(category) }));
  if (buckets.has(null)) groups.push({ category: null, rows: buckets.get(null) });
  return groups;
}

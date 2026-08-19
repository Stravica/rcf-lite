// Blueprint list. Reads manifest.blueprints[] and returns rows in
// appliedAt order. Rows are already validated by the schema; this
// module is a projection.

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

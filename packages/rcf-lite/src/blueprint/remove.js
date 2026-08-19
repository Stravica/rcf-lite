// Blueprint remove. Referring-doc scan + manifest patch + contribution
// file unlink.
//
// Refuses when any project-authored doc references any of the removed
// blueprint's contribution ids. `--force` is a Phase 3 concern (see
// design brief §Verbs); Phase 1 declines the override and returns the
// referring-doc list so the operator can see what needs unbinding.

import { unlink } from 'node:fs/promises';
import { join } from 'node:path';

import { rcfError } from '../core/errors/index.js';
import { updateManifest } from './manifest-writer.js';

/**
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('#core/store/walker.js').TreeModel} args.tree
 * @param {string} args.slug
 * @param {boolean} [args.dryRun]
 * @returns {Promise<{
 *   removed: boolean,
 *   slug: string,
 *   deletedPaths?: string[],
 *   referringDocs?: Array<{ docId: string, matchedId: string }>
 * } | import('../core/errors/index.js').RcfError>}
 */
export async function removeBlueprint({ projectRoot, tree, slug, dryRun = false }) {
  const applied = tree.manifest?.blueprints ?? [];
  const entry = applied.find((b) => b.slug === slug);
  if (!entry) {
    return rcfError({ kind: 'usage', message: `blueprint remove: no blueprint '${slug}' is applied on this project.` });
  }
  const contributionIds = new Set((entry.contributions ?? []).map((c) => c.id));
  const referring = scanReferringDocs(tree, contributionIds, slug);
  if (referring.length > 0) {
    return { removed: false, slug, referringDocs: referring };
  }
  const deletedPaths = [];
  for (const c of entry.contributions ?? []) {
    if (dryRun) { deletedPaths.push(c.path); continue; }
    try {
      await unlink(join(projectRoot, c.path));
      deletedPaths.push(c.path);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        return rcfError({ kind: 'ioFailure', message: `blueprint remove: unlink failed for ${c.path}: ${err.message}`, filePath: c.path });
      }
    }
  }
  const result = await updateManifest({
    projectRoot,
    manifest: tree.manifest,
    mutate: (next) => {
      const list = Array.isArray(next.blueprints) ? next.blueprints : [];
      next.blueprints = list.filter((b) => b.slug !== slug);
      if (next.blueprints.length === 0) delete next.blueprints;
    },
    dryRun,
  });
  if (result.kind) return result;
  return { removed: true, slug, deletedPaths };
}

/**
 * Walk every non-blueprint doc's string-shaped fields (including nested
 * arrays / objects) and report any occurrence of a contribution id.
 * A referring-doc match INCLUDES the blueprint's own contributions when
 * one contribution refers to another — we filter those out by checking
 * the referring doc id itself against `contributionIds`.
 */
function scanReferringDocs(tree, contributionIds, slug) {
  const hits = [];
  const contributionPaths = new Set();
  for (const entry of tree.manifest?.blueprints ?? []) {
    if (entry.slug !== slug) continue;
    for (const c of entry.contributions ?? []) contributionPaths.add(c.path);
  }
  for (const [id, doc] of tree.byId ?? new Map()) {
    if (contributionIds.has(id)) continue; // the blueprint's own contributions cross-refer each other
    for (const matchedId of findIdReferences(doc, contributionIds)) {
      hits.push({ docId: id, matchedId });
    }
  }
  return hits;
}

function findIdReferences(node, contributionIds, seen = new WeakSet()) {
  const out = [];
  if (typeof node === 'string') {
    if (contributionIds.has(node)) out.push(node);
    return out;
  }
  if (Array.isArray(node)) {
    for (const item of node) out.push(...findIdReferences(item, contributionIds, seen));
    return out;
  }
  if (typeof node === 'object' && node !== null && !seen.has(node)) {
    seen.add(node);
    for (const value of Object.values(node)) {
      out.push(...findIdReferences(value, contributionIds, seen));
    }
  }
  return out;
}

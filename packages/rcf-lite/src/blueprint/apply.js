// Blueprint apply. Orchestrates loader + conflict detection + namespaced
// contribution writes + manifest.blueprints[] append.
//
// Idempotency: repeating `apply(tree, source)` on an already-applied
// slug with no new conflicts is a no-op with a `{ applied: false,
// alreadyApplied: true }` return. A slug that WOULD conflict on
// re-apply (new version added a scope:global ADR) returns the conflict
// list without mutating anything.

import { copyFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { rcfError } from '../core/errors/index.js';
import { subdirFor } from '#core/store';
import { detectGlobalAdrConflicts } from './conflicts.js';
import { loadBlueprint } from './loader.js';
import { updateManifest } from './manifest-writer.js';
import { isNamespacedFor, stampId } from './namespace.js';

/**
 * @typedef {object} ApplyResult
 * @property {boolean} applied
 * @property {boolean} [alreadyApplied]
 * @property {string} slug
 * @property {string} version
 * @property {Array<{ id: string, path: string, kind: string }>} contributions
 * @property {import('./conflicts.js').Conflict[]} [conflicts]
 */

/**
 * @param {object} args
 * @param {string} args.projectRoot
 * @param {import('#core/store/walker.js').TreeModel} args.tree
 * @param {string} args.source - path to blueprint directory
 * @param {string} [args.namespaceOverride] - non-default namespace slug
 * @param {Date} [args.now]
 * @param {boolean} [args.dryRun]
 * @returns {Promise<ApplyResult | import('../core/errors/index.js').RcfError>}
 */
export async function applyBlueprint({ projectRoot, tree, source, namespaceOverride, now = new Date(), dryRun = false }) {
  const blueprint = await loadBlueprint(source);
  if (blueprint.kind) return blueprint; // RcfError
  const namespace = namespaceOverride ?? blueprint.slug;

  const applied = tree.manifest?.blueprints ?? [];
  const existing = applied.find((b) => b.slug === blueprint.slug);
  const stamped = stampContributions(blueprint.contributions, namespace);
  if (stamped.error) {
    return rcfError({ kind: 'validation', message: stamped.error });
  }

  // Conflict detection ALWAYS runs, including on re-apply.
  const conflicts = detectGlobalAdrConflicts(applied, {
    slug: blueprint.slug,
    contributions: stamped.contributions,
  });
  if (conflicts.length > 0) {
    return { applied: false, slug: blueprint.slug, version: blueprint.version, contributions: [], conflicts };
  }

  if (existing && existing.version === blueprint.version) {
    return { applied: false, alreadyApplied: true, slug: blueprint.slug, version: blueprint.version, contributions: stamped.contributions };
  }

  // Write contributions to the tree. Overwrites are refused on cross-blueprint id collision.
  const writtenContributions = [];
  for (const c of stamped.contributions) {
    const src = resolve(blueprint.source, 'contributions', c.path);
    const relDest = destPathFor(c);
    const absDest = join(projectRoot, relDest);
    if (dryRun) {
      writtenContributions.push(preserveScope({ id: c.id, kind: c.kind, path: relDest }, c));
      continue;
    }
    try {
      await stat(src);
    } catch {
      return rcfError({ kind: 'missingFile', message: `blueprint contribution missing on disk: ${src}`, filePath: src });
    }
    try {
      const alreadyThere = await stat(absDest).catch(() => null);
      if (alreadyThere) {
        // Same blueprint re-apply is fine; distinct blueprint's contribution collision is refused.
        if (!isNamespacedFor(c.id, namespace)) {
          return rcfError({
            kind: 'duplicateId',
            message: `blueprint apply: contribution ${c.id} would overwrite an existing file at ${relDest} and is not namespaced for '${namespace}'.`,
            filePath: relDest,
          });
        }
      }
      await mkdir(dirname(absDest), { recursive: true });
      await copyFile(src, absDest);
    } catch (err) {
      return rcfError({ kind: 'ioFailure', message: `blueprint contribution write failed: ${err.message}`, filePath: relDest });
    }
    writtenContributions.push(preserveScope({ id: c.id, kind: c.kind, path: relDest }, c));
  }

  // Update manifest.blueprints[].
  const nextEntry = {
    slug: blueprint.slug,
    version: blueprint.version,
    appliedAt: now.toISOString(),
    source,
    ...(namespaceOverride ? { namespace: namespaceOverride } : {}),
    ...(writtenContributions.length > 0 ? { contributions: writtenContributions } : {}),
  };
  const manifestResult = await updateManifest({
    projectRoot,
    manifest: tree.manifest,
    mutate: (next) => {
      const list = Array.isArray(next.blueprints) ? next.blueprints : [];
      const filtered = list.filter((b) => b.slug !== blueprint.slug);
      filtered.push(nextEntry);
      next.blueprints = filtered;
    },
    dryRun,
  });
  if (manifestResult.kind) return manifestResult; // RcfError

  return {
    applied: true,
    slug: blueprint.slug,
    version: blueprint.version,
    contributions: writtenContributions,
  };
}

function stampContributions(contributions, namespace) {
  const out = [];
  for (const c of contributions ?? []) {
    const r = stampId(c.id, namespace);
    if ('error' in r) return { error: r.error };
    out.push({ ...c, id: r.id });
  }
  return { contributions: out };
}

/**
 * Copy scope + topic from the source contribution onto the manifest
 * record when they are present. Manifest schema (0.4.4) accepts optional
 * scope='global' and topic on appliedBlueprintContribution so the
 * conflict detector can see the ADR scope across `add` invocations.
 */
function preserveScope(manifestRecord, source) {
  if (source.scope === 'global') manifestRecord.scope = 'global';
  if (typeof source.topic === 'string') manifestRecord.topic = source.topic;
  return manifestRecord;
}

function destPathFor(c) {
  const kindMap = {
    prd: 'prd', req: 'req', us: 'userStory', tad: 'tad', tac: 'tac',
    adr: 'adr', bs: 'buildSequence', fbs: 'fbs', ts: 'testSuite', cn: 'codeNode',
  };
  const kind = kindMap[c.kind];
  if (!kind) throw new Error(`blueprint apply: unknown contribution kind '${c.kind}'`);
  const dir = subdirFor(kind);
  const filename = `${filenameForId(c.id, c.kind)}.json`;
  return dir ? `rcf/${dir}/${filename}` : `rcf/${filename}`;
}

function filenameForId(id, kind) {
  return id.toLowerCase();
}

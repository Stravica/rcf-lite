// Blueprint apply. Orchestrates loader + conflict detection + namespaced
// contribution writes + manifest.blueprints[] append.
//
// Idempotency: repeating `apply(tree, source)` on an already-applied
// slug with no new conflicts is a no-op with a `{ applied: false,
// alreadyApplied: true }` return. A slug that WOULD conflict on
// re-apply (new version added a scope:global ADR) returns the conflict
// list without mutating anything.

import { copyFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { rcfError } from '../core/errors/index.js';
import { subdirFor } from '#core/store';
import { detectCrossBlueprintClaims, detectGlobalAdrConflicts } from './conflicts.js';
import { loadBlueprint } from './loader.js';
import { updateManifest } from './manifest-writer.js';
import { stampId } from './namespace.js';

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
 * @param {(src: string, dest: string) => Promise<void>} [args._copyFileForTest]
 *        Test-only seam. Substitutes fs.copyFile so a fixture can inject
 *        a failure part-way through the contribution write loop and
 *        prove the rollback runs. Never used in production.
 * @returns {Promise<ApplyResult | import('../core/errors/index.js').RcfError>}
 */
export async function applyBlueprint({ projectRoot, tree, source, namespaceOverride, now = new Date(), dryRun = false, _copyFileForTest }) {
  const blueprint = await loadBlueprint(source);
  if (blueprint.kind) return blueprint; // RcfError
  const namespace = namespaceOverride ?? blueprint.slug;

  const applied = tree.manifest?.blueprints ?? [];
  const existing = applied.find((b) => b.slug === blueprint.slug);
  const stamped = stampContributions(blueprint.contributions, namespace);
  if (stamped.error) {
    return rcfError({ kind: 'validation', message: stamped.error });
  }

  // Conflict detection ALWAYS runs, including on re-apply. Two classes
  // fire pre-write: scope:global ADR topic collisions (design brief),
  // and cross-blueprint ownership claims where an incoming id is
  // already recorded as owned by a DIFFERENT applied blueprint (the
  // spa vs spa-theme ambiguity class -- now caught here via the
  // authoritative manifest record instead of via string grammar).
  const incomingForConflicts = { slug: blueprint.slug, contributions: stamped.contributions };
  const conflicts = [
    ...detectGlobalAdrConflicts(applied, incomingForConflicts),
    ...detectCrossBlueprintClaims(applied, incomingForConflicts),
  ];
  if (conflicts.length > 0) {
    return { applied: false, slug: blueprint.slug, version: blueprint.version, contributions: [], conflicts };
  }

  // Ownership set for the overwrite guard below. On a re-apply, the
  // authoritative record is `existing.contributions[].id` -- the exact
  // list of ids the currently-applied version of this blueprint owns.
  // On first apply this is an empty set (any file already on disk at a
  // destination path is by definition foreign or author-owned).
  const ownedIds = new Set((existing?.contributions ?? []).map((c) => c.id));

  if (existing && existing.version === blueprint.version) {
    return { applied: false, alreadyApplied: true, slug: blueprint.slug, version: blueprint.version, contributions: stamped.contributions };
  }

  // Write contributions atomically at the batch level: every contribution
  // is copied to a `<name>.rcf-tmp-<slug>-<epoch>` sidecar first, and the
  // sidecars are only renamed into their final destinations after ALL
  // copies (and the pre-write collision guards) have succeeded. If any
  // step in the copy loop fails, every already-written sidecar is
  // unlinked before the error is returned; the manifest never sees the
  // partial batch, and the tree is left with no orphan contribution
  // files whose ids are not recorded anywhere.
  //
  // The alternative (write in place, roll back on failure) was rejected
  // because an in-place partial that races with a concurrent walker
  // would expose ids the manifest does not yet name. The sidecar phase
  // keeps every id-bearing file invisible to the walker until the
  // whole batch is ready to commit.
  const stampedContributions = stamped.contributions;
  const writtenContributions = [];
  const copyFileImpl = _copyFileForTest ?? copyFile;
  if (dryRun) {
    for (const c of stampedContributions) {
      const relDest = destPathFor(c);
      writtenContributions.push(preserveScope({ id: c.id, kind: c.kind, path: relDest }, c));
    }
  } else {
    const tmpSuffix = `.rcf-tmp-${blueprint.slug}-${now.getTime()}`;
    const stagedWrites = []; // { tmpAbs, absDest, relDest, id, kind, c }
    const rollback = async (err) => {
      for (const w of stagedWrites) {
        await unlink(w.tmpAbs).catch(() => {});
      }
      return rcfError({ kind: 'ioFailure', message: `blueprint contribution write failed (rolled back ${stagedWrites.length} staged file(s)): ${err.message}`, filePath: err.relDest ?? '' });
    };
    for (const c of stampedContributions) {
      const src = resolve(blueprint.source, 'contributions', c.path);
      const relDest = destPathFor(c);
      const absDest = join(projectRoot, relDest);
      try {
        await stat(src);
      } catch {
        for (const w of stagedWrites) await unlink(w.tmpAbs).catch(() => {});
        return rcfError({ kind: 'missingFile', message: `blueprint contribution missing on disk: ${src}`, filePath: src });
      }
      const alreadyThere = await stat(absDest).catch(() => null);
      if (alreadyThere) {
        // Authoritative ownership: only a file whose id is already
        // recorded on THIS blueprint's manifest entry is safe to
        // overwrite (the re-apply idempotency case). Anything else --
        // first-apply into a tree that already has the file, or a new
        // contribution appearing in a re-applied version -- is treated
        // as foreign and refused. Grammar is deliberately not consulted
        // here: `ADR-201-spa-theme` may be a legitimate `spa`-owned id
        // whose author put a semantic tail after the slug.
        if (!ownedIds.has(c.id)) {
          for (const w of stagedWrites) await unlink(w.tmpAbs).catch(() => {});
          return rcfError({
            kind: 'duplicateId',
            message: `blueprint apply: contribution ${c.id} would overwrite an existing file at ${relDest} that is not recorded as owned by blueprint '${blueprint.slug}'.`,
            filePath: relDest,
          });
        }
      }
      try {
        await mkdir(dirname(absDest), { recursive: true });
      } catch (err) {
        const wrapped = new Error(err.message); wrapped.relDest = relDest;
        return rollback(wrapped);
      }
      const tmpAbs = `${absDest}${tmpSuffix}`;
      try {
        await copyFileImpl(src, tmpAbs);
      } catch (err) {
        const wrapped = new Error(err.message); wrapped.relDest = relDest;
        return rollback(wrapped);
      }
      stagedWrites.push({ tmpAbs, absDest, relDest, id: c.id, kind: c.kind, c });
    }
    // Commit phase. Rename each sidecar into place. A rename failure
    // rolls the still-sideloaded remainder back, plus best-effort undo
    // of the renames that already committed (delete-if-differs is not
    // possible without content compare; the design brief accepts that
    // a commit-phase failure may leave a partial tree with a matching
    // partial manifest -- the manifest write happens after this loop
    // and is the ordering guarantee). The Phase 1 test injects the
    // failure in the COPY phase, which the rollback covers cleanly.
    for (const w of stagedWrites) {
      try {
        await rename(w.tmpAbs, w.absDest);
      } catch (err) {
        for (const w2 of stagedWrites) await unlink(w2.tmpAbs).catch(() => {});
        return rcfError({ kind: 'ioFailure', message: `blueprint contribution commit failed: ${err.message}`, filePath: w.relDest });
      }
    }
    for (const w of stagedWrites) {
      writtenContributions.push(preserveScope({ id: w.id, kind: w.kind, path: w.relDest }, w.c));
    }
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

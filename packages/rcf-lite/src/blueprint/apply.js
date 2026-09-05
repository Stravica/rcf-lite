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

import { readFile } from 'node:fs/promises';

import { rcfError } from '../core/errors/index.js';
import { subdirFor } from '#core/store';
import { detectCrossBlueprintClaims, detectGlobalAdrConflicts } from './conflicts.js';
import { detectContributionsOutOfBand } from './library-registry.js';
import { loadBlueprint } from './loader.js';
import { updateManifest } from './manifest-writer.js';
import { stampId } from './namespace.js';
import { nextResolutionId } from './resolutions.js';
import { buildRefusalMessage, discoverAppliedCapabilities, runElicitationPhase, writeSidecar } from './capabilities.js';

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
 * @param {string} args.source - path to blueprint directory (absolute after the CLI resolver)
 * @param {string} [args.displaySource] - the source string as the operator typed it;
 *        used only for the conflict renderer's supersede hint so it can print the exact
 *        string the operator can copy back. Defaults to `source` when omitted (so
 *        existing callers keep today's byte-for-byte behaviour).
 * @param {string} [args.namespaceOverride] - non-default namespace slug
 * @param {string} [args.effectiveSlug] - override for the blueprint's own slug
 *        when applied through an external-library qualified reference (spec §5.3):
 *        `<libraryPrefix>-<blueprintSlug>`. When set, this becomes BOTH the
 *        stamping namespace (so contributions inherit the library prefix) AND
 *        the value written into `manifest.blueprints[].slug` on the applied
 *        record, so `rcf define blueprint remove wsd-auth-oauth2` reads back
 *        cleanly. `namespaceOverride` still wins over `effectiveSlug` if both
 *        are set (operator explicitly chose a different namespace).
 * @param {string} [args.libraryPrefix] - the registered library prefix the
 *        blueprint was resolved through (spec §5.3, §7.3). When set the applied
 *        record carries a `libraryPrefix` field so `rcf library remove`'s
 *        ownership check reads the ownership fact off the record itself
 *        rather than string-matching `source`. Absent for shelf and path
 *        applies. Requires @stravica-ai/rcf-schemas 0.5.1 or later
 *        (`appliedBlueprintRecord.libraryPrefix`, additive optional).
 * @param {{ ac: { start: number, end: number }, suffixBlocks?: Array<{ kind: string, start: number, end: number }> }} [args.libraryBands]
 *        Declared bands from the resolved library. When set, every stamped
 *        contribution is band-gated before write; a contribution whose numeric
 *        portion falls outside the library's bands refuses at apply-time (spec
 *        §8.3, open question 9.9 ratified as "add both").
 * @param {Array<{ topic: string, resolvedByAdrId: string }>} [args.resolveDeclarations]
 *        Operator-supplied conflict resolutions declared on the add
 *        itself. One entry per resolved topic. For each, the resolution
 *        record is appended to `manifest.resolutions[]` in memory BEFORE
 *        the conflict detector runs, so the freshly declared resolution
 *        is honoured; the record then persists via the manifest write
 *        alongside the applied-blueprint update. Malformed declarations
 *        (topic missing from the incoming ADR set, no existing applied
 *        blueprint on the topic) are refused with an rcfError. Reads
 *        `manifest.resolutions[]` for id-mint monotonicity.
 * @param {Date} [args.now]
 * @param {boolean} [args.dryRun]
 * @param {(src: string, dest: string) => Promise<void>} [args._copyFileForTest]
 *        Test-only seam. Substitutes fs.copyFile so a fixture can inject
 *        a failure part-way through the contribution write loop and
 *        prove the rollback runs. Never used in production.
 * @returns {Promise<ApplyResult | import('../core/errors/index.js').RcfError>}
 */
export async function applyBlueprint({ projectRoot, tree, source, displaySource, namespaceOverride, effectiveSlug, libraryPrefix, libraryBands, resolveDeclarations, allowNoAuthYet = false, elicitAnswers = null, now = new Date(), dryRun = false, _copyFileForTest }) {
  const hintSource = typeof displaySource === 'string' && displaySource.length > 0 ? displaySource : source;
  const blueprint = await loadBlueprint(source);
  if (blueprint.kind) return blueprint; // RcfError
  // Effective slug rewires the blueprint's identity under a library
  // prefix (spec §5.3). It becomes both the stamping namespace and the
  // slug written into `manifest.blueprints[].slug`. `namespaceOverride`
  // still wins over `effectiveSlug` (operator's explicit --namespace on
  // the CLI). When neither is set the blueprint's own slug applies.
  const appliedSlug = typeof effectiveSlug === 'string' && effectiveSlug.length > 0
    ? effectiveSlug
    : blueprint.slug;
  const namespace = namespaceOverride ?? appliedSlug;

  const applied = tree.manifest?.blueprints ?? [];
  const existing = applied.find((b) => b.slug === appliedSlug);
  const stamped = stampContributions(blueprint.contributions, namespace);
  if (stamped.error) {
    return rcfError({ kind: 'validation', message: stamped.error });
  }
  // Apply-time band gate for external-library blueprints.
  if (libraryBands) {
    const bandErr = detectContributionsOutOfBand(stamped.contributions, libraryBands);
    if (bandErr) return bandErr;
  }

  // Capability-declaration mechanism (visual round T-5 spec 5.5).
  // Discover the union of applied capabilities across every applied
  // blueprint via source read-back; the applied-blueprint-record
  // schema is closed (rcf-schemas 0.6.0) and does not carry a
  // capabilities field, so the source blueprint.json is the ground
  // truth for what each applied blueprint declares.
  const discovery = await discoverAppliedCapabilities(applied, projectRoot);
  const appliedCapabilities = discovery.union;

  // Refusal gate for consumer blueprints that require at least one
  // applied capability. When the union has no overlap AND the CLI did
  // not pass the allow-skip flag, refuse with the templated message
  // (spec 5.5.1 verbatim for admin-console).
  if (blueprint.requiresAppliedCapabilities && !allowNoAuthYet) {
    const required = blueprint.requiresAppliedCapabilities.capabilities;
    const overlap = required.some((c) => appliedCapabilities.includes(c));
    if (!overlap) {
      const message = buildRefusalMessage({
        slug: appliedSlug,
        refusalMessageId: blueprint.requiresAppliedCapabilities.refusalMessageId,
        requiredCapabilities: required,
        appliedRecords: applied,
        allowSkipFlag: blueprint.requiresAppliedCapabilities.allowSkipFlag,
      });
      return rcfError({ kind: 'requiresAppliedCapabilities', message });
    }
  }

  // Elicitation phase (visual round T-5 spec section 5.5, T-2 gate).
  // Evaluate each declared elicit against the discovered capability
  // set; coerce operator answers per kind. A missing required answer
  // refuses before any write.
  const elicitResult = runElicitationPhase({
    elicits: blueprint.elicits,
    appliedCapabilities,
    answers: elicitAnswers ?? {},
  });
  if (elicitResult.kind) return elicitResult; // RcfError
  const appliedElicitations = elicitResult.value;

  // Pre-detection: fold operator-supplied --resolve declarations into a
  // WORKING COPY of the manifest so the detector honours them on this
  // run. The final manifest write later composes the same resolution
  // records into the persisted manifest, so the in-memory copy and the
  // on-disk write agree.
  const incomingForConflicts = { slug: appliedSlug, contributions: stamped.contributions };
  const declResult = composeDeclaredResolutions({
    manifest: tree.manifest,
    applied,
    incoming: incomingForConflicts,
    declarations: resolveDeclarations ?? [],
    now,
  });
  if (declResult.kind) return declResult; // RcfError
  const workingManifest = declResult.manifest;
  const newResolutionRecords = declResult.newRecords;
  const duplicateResolveTopics = declResult.duplicateTopics ?? [];

  // Conflict detection ALWAYS runs, including on re-apply. Two classes
  // fire pre-write: scope:global ADR topic collisions (design brief),
  // and cross-blueprint ownership claims where an incoming id is
  // already recorded as owned by a DIFFERENT applied blueprint (the
  // spa vs spa-theme ambiguity class -- now caught here via the
  // authoritative manifest record instead of via string grammar). The
  // globalAdrTopic detector consults `workingManifest.resolutions[]` so
  // a resolved conflict is dropped from the list before the caller sees
  // it.
  const rawGlobalConflicts = detectGlobalAdrConflicts(applied, incomingForConflicts, workingManifest);
  const conflicts = [
    // Thread the CLI-supplied `source` (what the operator typed) onto
    // each enriched conflict so the renderer can print option 3
    // exactly as printed - `rcf blueprint supersede <topic> --incoming
    // <source>` - with a real source path the operator can copy back
    // into a fresh shell.
    ...await enrichAdrConflicts(rawGlobalConflicts, tree, blueprint, hintSource),
    ...detectCrossBlueprintClaims(applied, incomingForConflicts),
  ];
  if (conflicts.length > 0) {
    return { applied: false, slug: appliedSlug, version: blueprint.version, contributions: [], conflicts };
  }

  // Ownership set for the overwrite guard below. On a re-apply, the
  // authoritative record is `existing.contributions[].id` -- the exact
  // list of ids the currently-applied version of this blueprint owns.
  // On first apply this is an empty set (any file already on disk at a
  // destination path is by definition foreign or author-owned).
  const ownedIds = new Set((existing?.contributions ?? []).map((c) => c.id));

  if (existing && existing.version === blueprint.version) {
    return {
      applied: false, alreadyApplied: true,
      slug: appliedSlug, version: blueprint.version,
      contributions: stamped.contributions,
      ...(duplicateResolveTopics.length > 0 ? { warnings: [{ kind: 'duplicateResolveTopic', topics: duplicateResolveTopics }] } : {}),
    };
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
    const tmpSuffix = `.rcf-tmp-${appliedSlug}-${now.getTime()}`;
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
        // here: `ADR-201-application-spa-theme` may be a legitimate
        // `application-spa`-owned id whose author put a semantic tail
        // after the slug.
        if (!ownedIds.has(c.id)) {
          for (const w of stagedWrites) await unlink(w.tmpAbs).catch(() => {});
          return rcfError({
            kind: 'duplicateId',
            message: `blueprint apply: contribution ${c.id} would overwrite an existing file at ${relDest} that is not recorded as owned by blueprint '${appliedSlug}'.`,
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

  // Update manifest.blueprints[]. The applied record's `source` field
  // carries the qualified typed ref for library-resolved blueprints
  // (`wsd:auth-oauth2`) so `rcf define blueprint upgrade` reads back
  // cleanly (spec §5.3); local-path applies carry the absolute path as
  // today. When the apply resolved through a registered external
  // library the record additionally carries `libraryPrefix`: the
  // ownership fact for the library-registered ownership check in
  // `rcf library remove`, so the registry may be edited (renamed,
  // re-pointed, unregistered) without orphaning previously applied
  // records. Shelf and path applies carry no `libraryPrefix`.
  const recordSource = typeof displaySource === 'string' && displaySource.length > 0 && displaySource !== source
    ? displaySource
    : source;
  const nextEntry = {
    slug: appliedSlug,
    version: blueprint.version,
    appliedAt: now.toISOString(),
    source: recordSource,
    ...(namespaceOverride ? { namespace: namespaceOverride } : {}),
    ...(typeof libraryPrefix === 'string' && libraryPrefix.length > 0 ? { libraryPrefix } : {}),
    ...(writtenContributions.length > 0 ? { contributions: writtenContributions } : {}),
  };
  const manifestResult = await updateManifest({
    projectRoot,
    manifest: tree.manifest,
    mutate: (next) => {
      const list = Array.isArray(next.blueprints) ? next.blueprints : [];
      const filtered = list.filter((b) => b.slug !== appliedSlug);
      filtered.push(nextEntry);
      next.blueprints = filtered;
      // Fold any --resolve declarations recorded on this add into the
      // persisted resolutions[]. Ordering is [existing, ...new] so
      // record ids stay monotonic within a day.
      if (newResolutionRecords.length > 0) {
        const resList = Array.isArray(next.resolutions) ? next.resolutions : [];
        for (const rec of newResolutionRecords) resList.push(rec);
        next.resolutions = resList;
      }
    },
    dryRun,
  });
  if (manifestResult.kind) return manifestResult; // RcfError

  // Sidecar write for the capability-declaration mechanism (visual
  // round T-5 spec 5.5.1). Per-project apply-state that the applied-
  // blueprint-record schema cannot carry today: the discovered
  // appliedCapabilities snapshot, the elicit answers, and (when the
  // gate was skipped) an allowNoAuthYet flag plus a notes string that
  // rcf define validate later reads to flag ungated surfaces. The
  // sidecar is written on ANY apply that carries capabilities-related
  // data (declared capabilities, requiresAppliedCapabilities gate,
  // elicits, or an override) so probe packs and audit tooling have
  // one deterministic file to read. dryRun skips the write.
  const wroteSidecar = !dryRun && (
    blueprint.requiresAppliedCapabilities !== undefined ||
    (Array.isArray(blueprint.elicits) && blueprint.elicits.length > 0) ||
    Array.isArray(blueprint.capabilities) ||
    allowNoAuthYet === true
  );
  let sidecarPath = null;
  if (wroteSidecar) {
    sidecarPath = await writeSidecar({
      projectRoot,
      slug: appliedSlug,
      version: blueprint.version,
      appliedAt: now.toISOString(),
      appliedCapabilities,
      appliedElicitations,
      allowNoAuthYet: allowNoAuthYet === true ? true : undefined,
      notes: allowNoAuthYet === true
        ? `no auth yet: applied under --${blueprint.requiresAppliedCapabilities?.allowSkipFlag ?? 'allow-no-auth-yet'}; surfaces gated on ${(blueprint.requiresAppliedCapabilities?.capabilities ?? []).join(', ')} will refuse at runtime until an auth blueprint is applied.`
        : undefined,
    });
  }

  return {
    applied: true,
    slug: appliedSlug,
    version: blueprint.version,
    contributions: writtenContributions,
    ...(wroteSidecar ? { sidecarPath, appliedCapabilities, appliedElicitations } : {}),
    // Companion-suggestion mechanism (spec 2.6). Bubble the source
    // blueprint's `suggestedCompanions[]` up on the result so the CLI
    // can render the resolved-suggestion block after a successful
    // apply. Unresolved here (the CLI holds the tree + libraries to
    // run the resolver); apply owns only the raw copy.
    ...(Array.isArray(blueprint.suggestedCompanions) && blueprint.suggestedCompanions.length > 0
      ? { suggestedCompanions: blueprint.suggestedCompanions }
      : {}),
    ...(duplicateResolveTopics.length > 0 ? { warnings: [{ kind: 'duplicateResolveTopic', topics: duplicateResolveTopics }] } : {}),
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

/**
 * Compose zero-or-more `manifest.resolutions[]` records from operator
 * --resolve declarations and return a working manifest copy carrying
 * them (for detector honour on this run) plus the raw new records (for
 * the eventual manifest persist). Refuses malformed declarations up
 * front so the detector never sees a resolution that would break its
 * shape assumptions.
 *
 * A declaration `{ topic, resolvedByAdrId }` is valid iff:
 *   - the incoming blueprint carries a scope:global ADR on `topic`, and
 *   - at least one currently-applied blueprint carries a scope:global
 *     ADR on the same topic (the resolution needs both sides).
 *   - resolvedByAdrId is a well-formed ADR id string.
 */
function composeDeclaredResolutions({ manifest, applied, incoming, declarations, now }) {
  if (!Array.isArray(declarations) || declarations.length === 0) {
    return { manifest: manifest ?? null, newRecords: [], duplicateTopics: [] };
  }
  const incomingGlobals = (incoming.contributions ?? [])
    .filter((c) => c.kind === 'adr' && c.scope === 'global' && typeof c.topic === 'string');
  const workingManifest = manifest ? JSON.parse(JSON.stringify(manifest)) : {};
  const newRecords = [];
  const iso = now.toISOString();
  // Error messages here are prefix-free: the CLI edge prepends
  // `[error] blueprint add: ` on every rcfError, and doubling the
  // prefix reads badly on the terminal (`blueprint add: blueprint
  // add: ...`).
  // Dedupe by topic within a single add: two --resolve declarations
  // on the same topic silently minted two records on the first
  // implementation. Keep the FIRST occurrence per topic (operator
  // wrote it first, before whatever came after), record the drops
  // so the CLI can surface a warning.
  const seenTopics = new Set();
  const duplicateTopics = [];
  for (const decl of declarations) {
    if (typeof decl?.topic !== 'string' || decl.topic.trim().length === 0) {
      // Schema minLength:1 accepts whitespace-only; the writer refuses
      // it up-front so a whitespace-only topic never lands on disk.
      return rcfError({ kind: 'usage', message: `--resolve declaration is missing a topic.` });
    }
    if (typeof decl.resolvedByAdrId !== 'string' || !/^ADR-\d{3,}(?:-[a-z0-9]+(?:-[a-z0-9]+)*)?$/.test(decl.resolvedByAdrId)) {
      return rcfError({ kind: 'usage', message: `--resolve resolvedByAdrId '${decl.resolvedByAdrId}' is not a well-formed ADR id.` });
    }
    if (typeof decl.reason === 'string' && decl.reason.length > 0 && decl.reason.trim().length === 0) {
      return rcfError({ kind: 'usage', message: `--resolve reason for topic '${decl.topic}' must not be whitespace-only.` });
    }
    if (seenTopics.has(decl.topic)) {
      duplicateTopics.push(decl.topic);
      continue;
    }
    const incomingHit = incomingGlobals.find((c) => c.topic === decl.topic);
    if (!incomingHit) {
      return rcfError({ kind: 'usage', message: `--resolve topic '${decl.topic}' does not match any scope:global ADR on the incoming blueprint.` });
    }
    const existingHits = [];
    for (const bp of applied) {
      if (bp.slug === incoming.slug) continue;
      for (const c of bp.contributions ?? []) {
        if (c.kind === 'adr' && c.scope === 'global' && c.topic === decl.topic) {
          existingHits.push({ slug: bp.slug, adrId: c.id });
        }
      }
    }
    if (existingHits.length === 0) {
      return rcfError({ kind: 'usage', message: `--resolve topic '${decl.topic}' has no applied blueprint carrying a scope:global ADR on that topic; nothing to resolve against.` });
    }
    seenTopics.add(decl.topic);
    // Mint the next id off the WORKING manifest so successive
    // declarations increment cleanly within the same batch.
    const id = nextResolutionId(workingManifest, now);
    const record = {
      id,
      createdAt: iso,
      kind: 'globalAdrTopic',
      topic: decl.topic,
      resolvedByAdrId: decl.resolvedByAdrId,
      supersedes: [
        ...existingHits.map((h) => ({ slug: h.slug, adrId: h.adrId })),
        { slug: incoming.slug, adrId: incomingHit.id },
      ],
    };
    if (typeof decl.reason === 'string' && decl.reason.length > 0) record.reason = decl.reason;
    newRecords.push(record);
    const list = Array.isArray(workingManifest.resolutions) ? workingManifest.resolutions : [];
    list.push(record);
    workingManifest.resolutions = list;
  }
  return { manifest: workingManifest, newRecords, duplicateTopics };
}

/**
 * Enrich a global-ADR conflict list with title / decision text from
 * BOTH sides: the tree's byId map (existing blueprint, already loaded
 * by the walker) and the incoming blueprint's on-disk contribution
 * file (incoming blueprint, not yet in the tree). Best-effort on
 * either side: if a lookup fails the enriched fields are simply
 * absent and the renderer falls back to id-at-path for that side.
 *
 * Round-2 review nit: the earlier version only enriched the existing
 * side, so a conflict report against shipped application-spa + REST rendered
 * asymmetrically (spa gets 'SPA auth: cookie sessions — HttpOnly
 * cookies.' while rest gets 'ADR-003-rest at rcf/adrs/...'). Both
 * sides are readable — the existing side from tree, the incoming
 * side from disk — and both sides should be rendered.
 */
async function enrichAdrConflicts(conflicts, tree, blueprint, sourceLabel) {
  if (conflicts.length === 0) return conflicts;
  const out = [];
  for (const c of conflicts) {
    if (c.kind !== 'globalAdrTopic') {
      out.push(c);
      continue;
    }
    const enriched = { ...c, incoming: { ...c.incoming }, existing: { ...c.existing } };
    // Round-3 (Baz ruling): thread the CLI-supplied source (what the
    // operator typed on `rcf blueprint add SRC`) onto the incoming
    // side so the renderer can print option 3 verbatim — the operator
    // can copy the same source path into the supersede invocation
    // with zero editing.
    if (typeof sourceLabel === 'string' && sourceLabel.length > 0) {
      enriched.incoming.source = sourceLabel;
    }
    // Existing side: the walker already loaded it into tree.byId.
    const existingDoc = tree.byId?.get(c.existing.id);
    if (existingDoc) {
      if (typeof existingDoc.title === 'string') enriched.existing.title = existingDoc.title;
      if (typeof existingDoc.decision === 'string') enriched.existing.decision = firstSentence(existingDoc.decision);
    }
    // Incoming side: read the ADR file straight from the blueprint's
    // contribution directory. blueprint.source is absolute (loader
    // resolves it), the contribution path is relative to contributions/.
    const incomingDoc = await _readIncomingAdrForEnrichment({
      blueprintSource: blueprint.source,
      contributionPath: c.incoming.path,
    });
    if (typeof incomingDoc.title === 'string') enriched.incoming.title = incomingDoc.title;
    if (typeof incomingDoc.decision === 'string') enriched.incoming.decision = incomingDoc.decision;
    out.push(enriched);
  }
  return out;
}

/**
 * Read the incoming ADR file from a blueprint's contribution directory
 * and pull title/decision. Best-effort: any read/parse failure returns
 * an empty object and the renderer falls back to id-at-path.
 */
export async function _readIncomingAdrForEnrichment({ blueprintSource, contributionPath }) {
  try {
    const raw = await readFile(`${blueprintSource}/contributions/${contributionPath}`, 'utf8');
    const doc = JSON.parse(raw);
    return {
      title: typeof doc.title === 'string' ? doc.title : undefined,
      decision: typeof doc.decision === 'string' ? firstSentence(doc.decision) : undefined,
    };
  } catch {
    return {};
  }
}

function firstSentence(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return trimmed;
  const m = trimmed.match(/^[^.!?]+[.!?](?=\s|$)/);
  return m ? m[0] : trimmed;
}

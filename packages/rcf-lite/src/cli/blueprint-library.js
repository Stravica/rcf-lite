// `rcf define blueprint library <verb>` CLI.
//
// Verbs (Phase 2b + 2c):
//   add      register an external library on this project. Accepts a
//            local path, a `git+<url>#<tag-or-sha>` ref, or a tarball
//            URL with `--sha256 <hex>`.
//   list     list registered libraries
//   remove   unregister a library (refuses when any applied blueprint on
//            the project came through the library) and removes the cache
//   refresh  re-fetch the pinned ref, verify against the registry's
//            resolved sha or tarball digest, refuse on drift
//
// Spec: external-blueprint-libraries-spec-2026-08-31.md sections 4, 6, 8.

import { isAbsolute, resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { createInterface } from 'node:readline';

import { isRcfError } from '#core/errors';
import { findProjectRoot } from '../view/index.js';
import { loadLibrary } from '../blueprint/library-loader.js';
import {
  detectBandOverlap,
  detectPrefixCollision,
  findLibrary,
  loadCoreBandReservations,
  readLibraryRegistry,
  writeLibraryRegistry,
} from '../blueprint/library-registry.js';
import { knownShelfSlugs, packagedShelfPath } from '../blueprint/shelf-resolver.js';
import { walkTree } from '#core/store';
import {
  absoluteCachePath,
  ensureEmptyCache,
  relativeCachePath,
  removeCache,
  resolveCachePath,
} from '../blueprint/library-cache.js';
import {
  fetchGitLibrary,
  parseGitRef,
  resolveRemoteSha,
} from '../blueprint/library-fetcher-git.js';
import { fetchTarballLibrary } from '../blueprint/library-fetcher-tarball.js';

/**
 * Union of core-shelf blueprint slugs used for the prefix-collision
 * gate. The packaged-shelf directory is copied into the tarball at
 * prepack time (`files: ['blueprints']`), so a source checkout does
 * not have `packages/rcf-lite/blueprints/` on disk; falling back to
 * the shipped `data/core-band-reservations.json` keeps the gate
 * effective in both shapes.
 */
async function collectCoreSlugs() {
  const fromShelf = await knownShelfSlugs(packagedShelfPath()).catch(() => []);
  const reservations = await loadCoreBandReservations();
  const slugs = new Set(fromShelf);
  for (const row of reservations.ac ?? []) if (row.blueprint) slugs.add(row.blueprint);
  for (const row of reservations.suffixBlocks ?? []) if (row.blueprint) slugs.add(row.blueprint);
  return [...slugs];
}

export const LIBRARY_HELP = `Usage: rcf define blueprint library <verb> [options]

Verbs:
  add <ref>            Register an external library on this project.
                       <ref> is one of:
                         - a local absolute or relative path to a library
                           root (a directory containing library.json);
                         - a git ref pinned to an annotated tag or a
                           commit sha, e.g.
                           git+https://github.com/wsd-team/wsd-blueprint-library.git#v1.2.0
                           or git+ssh://git@github.com/... . Floating
                           branches (main, master, HEAD, latest) refuse.
                         - a tarball URL (.tar / .tar.gz / .tgz) paired
                           with --sha256 <hex>; SHA-256 is verified on
                           the download bytes and stored as the pin.
                       Fetches metadata, runs review-on-add, writes an
                       entry to rcf/blueprint-libraries.json, and lands
                       the extracted content under
                       rcf/.blueprint-libraries/<prefix>/<ref>/ (checked
                       into git as ordinary tree content so a fresh
                       clone can 'rcf define blueprint list' without a
                       re-fetch).

  list [--json]        List every registered library on this project
                       (prefix, source, publisher, blueprint count).

  remove <prefix>      Unregister a library and drop its cache. Refuses
                       when any applied blueprint on the project came
                       through this library.

  refresh <prefix>     Re-fetch the pinned ref for a network library and
                       verify against the registry's resolved sha or
                       tarball digest; refuse-and-report on drift (spec
                       §6.4 / §9.12: annotated-tag moves are a supply
                       chain event, not an auto-update). Local sources
                       re-validate the on-disk library.json against the
                       registry snapshot.

Options:
  --prefix <slug>      (add) Override the library's declared prefix.
                       Rarely needed; only useful when two libraries
                       collide on prefix locally.
  --sha256 <hex>       (add) Required when <ref> is a tarball URL. The
                       expected SHA-256 (64 hex chars) of the download.
  --i-have-reviewed    (add) Skip the interactive review-on-add prompt.
                       Required companion to --no-review when scripting;
                       the two-flag form keeps a library-add trust
                       decision loud (spec §9.7).
  --no-review          (add) Bypass the interactive prompt. Requires
                       --i-have-reviewed.
  --json               (add, list) Emit machine-readable JSON.
  --dry-run            Print intended writes without executing.
  --quiet              Suppress non-error stdout.
  --help               Print this help.
`;

const LIBRARY_OPTION_SPEC = {
  prefix: { type: 'string' },
  sha256: { type: 'string' },
  'i-have-reviewed': { type: 'boolean' },
  'no-review': { type: 'boolean' },
  json: { type: 'boolean' },
  'dry-run': { type: 'boolean' },
  quiet: { type: 'boolean' },
  help: { type: 'boolean' },
};

/**
 * Handle `rcf define blueprint library <verb>`.
 *
 * @param {import('node:util').ParseArgsConfig} parsed - already-parsed argv (see cli/blueprint.js)
 * @param {string[]} rest - positional args after `library`
 * @param {object} deps
 * @returns {Promise<number>}
 */
export async function handleLibraryVerb(parsed, rest, deps) {
  const stdout = deps.stdout;
  const stderr = deps.stderr;
  const cwd = deps.cwd;
  const now = deps.now ?? new Date();
  const stdin = deps.stdin ?? process.stdin;

  if (parsed.values.help || rest.length === 0) {
    stdout.write(LIBRARY_HELP);
    return 0;
  }
  const verb = rest[0];
  const args = rest.slice(1);

  const projectRoot = await findProjectRoot(cwd);
  if (!projectRoot) {
    stderr.write('[error] no rcf/ tree found in this directory or any ancestor.\n');
    return 2;
  }

  if (verb === 'add') return handleAdd({ args, parsed, projectRoot, now, stdout, stderr, stdin });
  if (verb === 'list') return handleList({ parsed, projectRoot, stdout, stderr });
  if (verb === 'remove') return handleRemove({ args, parsed, projectRoot, stdout, stderr });
  if (verb === 'refresh') return handleRefresh({ args, parsed, projectRoot, stdout, stderr });

  stderr.write(`[error] blueprint library: unknown verb '${verb}'\n`);
  stderr.write(LIBRARY_HELP);
  return 2;
}

async function handleAdd({ args, parsed, projectRoot, now, stdout, stderr, stdin }) {
  if (args.length === 0) {
    stderr.write('[error] blueprint library add: missing <ref>\n');
    return 2;
  }
  const ref = args[0];

  const kind = classifySourceRef(ref);
  // Fetch phase: land the library on disk under a temporary cachePath
  // computed against the library's declared prefix (loader reads it from
  // library.json) once we know it. For local sources the cache path is
  // the operator's own directory - no copy, no cache slot. For git and
  // tarball we fetch into an on-disk cache and load from there.
  const dryRun = parsed.values['dry-run'] === true;
  const fetchResult = await performFetch({ kind, ref, parsed, projectRoot, stderr });
  if (typeof fetchResult === 'number') return fetchResult;

  const { libraryRoot, sourceKind, sourceRef, resolvedSha, tarballSha256, cachePathAbs, cachePathRel } = fetchResult;

  const library = await loadLibrary(libraryRoot, { validateBlueprints: true });
  if (isRcfError(library)) {
    stderr.write(`[error] blueprint library add: ${library.message}\n`);
    if (sourceKind !== 'local' && cachePathAbs) {
      // Roll back a fetched-but-invalid library so the cache does not
      // linger as ghost state.
      await removeCache(cachePathAbs);
    }
    return 2;
  }

  const libraryPrefix = typeof parsed.values.prefix === 'string' && parsed.values.prefix.length > 0
    ? parsed.values.prefix
    : library.libraryPrefix;

  const registry = await readLibraryRegistry(projectRoot);
  if (isRcfError(registry)) {
    stderr.write(`[error] blueprint library add: ${registry.message}\n`);
    return 2;
  }
  if (findLibrary(registry, libraryPrefix)) {
    stderr.write(`[error] blueprint library add: libraryPrefix '${libraryPrefix}' is already registered on this project. Use 'library refresh' or 'library remove' first.\n`);
    return 2;
  }
  const coreSlugs = await collectCoreSlugs();
  const prefixErr = detectPrefixCollision({ libraryPrefix, registry, coreSlugs });
  if (prefixErr) {
    stderr.write(`[error] blueprint library add: ${prefixErr.message}\n`);
    return 2;
  }
  const coreReservations = await loadCoreBandReservations();
  const bandErr = detectBandOverlap({
    candidate: { libraryPrefix, bands: library.bands },
    registry,
    coreReservations,
  });
  if (bandErr) {
    stderr.write(`[error] blueprint library add: ${bandErr.message}\n`);
    return 2;
  }

  const wantsReview = parsed.values['no-review'] !== true;
  const iHaveReviewed = parsed.values['i-have-reviewed'] === true;
  if (parsed.values['no-review'] === true && !iHaveReviewed) {
    stderr.write('[error] blueprint library add: --no-review requires --i-have-reviewed (spec §9.7: the two-flag form keeps the trust decision loud).\n');
    return 2;
  }
  if (wantsReview) {
    printReview({ stdout, ref, library, libraryPrefix, coreReservations, sourceKind, resolvedSha, tarballSha256 });
    if (!iHaveReviewed) {
      const proceed = await prompt(stdin, stdout, 'Proceed with add? [y/N] ');
      if (!/^y(es)?$/i.test((proceed ?? '').trim())) {
        stdout.write('[blueprint library] aborted by operator; no registry entry written.\n');
        if (sourceKind !== 'local' && cachePathAbs) {
          await removeCache(cachePathAbs);
        }
        return 0;
      }
    }
  }

  const provenance = { tier: sourceKind };
  if (sourceKind === 'git') {
    provenance.shaVerifiedAt = now.toISOString();
  } else if (sourceKind === 'tarball') {
    provenance.shaVerifiedAt = now.toISOString();
    provenance.tarballSha256 = tarballSha256;
  }
  const entry = {
    libraryPrefix,
    sourceKind,
    sourceRef,
    ...(resolvedSha ? { resolvedSha } : {}),
    displayName: library.displayName,
    publisher: { ...library.publisher },
    libraryRef: library.libraryRef,
    bands: library.bands,
    blueprints: library.blueprints.map((b) => ({ slug: b.slug, path: b.path })),
    addedAt: now.toISOString(),
    reviewedBy: 'operator',
    provenance,
    cachePath: sourceKind === 'local' ? libraryRoot : cachePathRel,
  };

  const nextRegistry = {
    registryVersion: registry.registryVersion,
    libraries: [...registry.libraries, entry],
  };
  const write = await writeLibraryRegistry(projectRoot, nextRegistry, { dryRun });
  if (isRcfError(write)) {
    stderr.write(`[error] blueprint library add: ${write.message}\n`);
    if (sourceKind !== 'local' && cachePathAbs) await removeCache(cachePathAbs);
    return 2;
  }
  if (parsed.values.json) {
    stdout.write(`${JSON.stringify({
      added: !dryRun,
      dryRun,
      libraryPrefix: entry.libraryPrefix,
      sourceKind: entry.sourceKind,
      resolvedSha: entry.resolvedSha ?? null,
      tarballSha256: entry.provenance.tarballSha256 ?? null,
      cachePath: entry.cachePath,
      blueprintCount: entry.blueprints.length,
      registryPath: write.path,
    })}\n`);
    return 0;
  }
  if (!parsed.values.quiet) {
    if (dryRun) {
      stdout.write(`[blueprint library] dry-run: would add '${libraryPrefix}' (${entry.blueprints.length} blueprint(s), source=${sourceKind}) to ${write.path}.\n`);
    } else {
      const pinNote = resolvedSha ? ` (sha ${resolvedSha.slice(0, 12)})` : (tarballSha256 ? ` (sha256 ${tarballSha256.slice(0, 12)})` : '');
      stdout.write(`[blueprint library] added '${libraryPrefix}' (${entry.blueprints.length} blueprint(s), ${sourceKind})${pinNote} to ${write.path}.\n`);
    }
  }
  return 0;
}

/**
 * Land the library on disk. Returns either a numeric exit code (error
 * already reported to stderr) or an object describing the fetched
 * library placement.
 *
 * @returns {Promise<number | { libraryRoot: string, sourceKind: 'local' | 'git' | 'tarball', sourceRef: string, resolvedSha?: string, tarballSha256?: string, cachePathAbs?: string, cachePathRel?: string }>}
 */
async function performFetch({ kind, ref, parsed, projectRoot, stderr }) {
  const dryRun = parsed.values['dry-run'] === true;
  if (kind === 'local') {
    const localRoot = isAbsolute(ref) ? ref : resolve(projectRoot, ref);
    let libStat;
    try {
      libStat = await stat(localRoot);
    } catch (err) {
      stderr.write(`[error] blueprint library add: path '${localRoot}' cannot be read: ${err.message}\n`);
      return 2;
    }
    if (!libStat.isDirectory()) {
      stderr.write(`[error] blueprint library add: path '${localRoot}' is not a directory.\n`);
      return 2;
    }
    return { libraryRoot: localRoot, sourceKind: 'local', sourceRef: localRoot };
  }
  if (kind === 'git') {
    const parsed_ref = parseGitRef(ref);
    if (isRcfError(parsed_ref)) {
      stderr.write(`[error] blueprint library add: ${parsed_ref.message}\n`);
      return 2;
    }
    // Provisional cache slot keyed by tag or short sha. The final slot
    // moves to the library-declared libraryRef if it differs, but for
    // git the ref-as-typed is what the operator will use to look this
    // library up in the registry.
    const provisionalRef = parsed_ref.ref;
    // We do not yet know libraryPrefix (that comes from library.json)
    // so we fetch into a scratch dir and rename later based on the
    // loaded prefix. Fetch into <projectRoot>/rcf/.blueprint-libraries/.pending-<pid>/
    const scratchPrefix = `.pending-${process.pid}-${Date.now().toString(36)}`;
    const scratchAbs = absoluteCachePath(projectRoot, scratchPrefix, provisionalRef);
    const prepErr = await ensureEmptyCache(scratchAbs, { replace: true });
    if (prepErr) {
      stderr.write(`[error] blueprint library add: ${prepErr.message}\n`);
      return 2;
    }
    if (dryRun) {
      stderr.write(`[error] blueprint library add: --dry-run is not supported for network fetches (would fetch ${parsed_ref.url}#${parsed_ref.ref}).\n`);
      await removeCache(scratchAbs);
      return 2;
    }
    const fetched = await fetchGitLibrary({ url: parsed_ref.url, ref: parsed_ref.ref, refKind: parsed_ref.refKind, targetDir: scratchAbs });
    if (isRcfError(fetched)) {
      stderr.write(`[error] blueprint library add: ${fetched.message}\n`);
      await removeCache(scratchAbs);
      return 2;
    }
    // Peek at library.json before we settle the cache slot so we know
    // the prefix and libraryRef the operator committed to.
    const peek = await loadLibrary(scratchAbs, { validateBlueprints: false });
    if (isRcfError(peek)) {
      stderr.write(`[error] blueprint library add: ${peek.message}\n`);
      await removeCache(scratchAbs);
      return 2;
    }
    const finalRel = relativeCachePath(peek.libraryPrefix, peek.libraryRef);
    const finalAbs = absoluteCachePath(projectRoot, peek.libraryPrefix, peek.libraryRef);
    const settleErr = await settleFinal(scratchAbs, finalAbs);
    if (settleErr) {
      stderr.write(`[error] blueprint library add: ${settleErr.message}\n`);
      return 2;
    }
    return {
      libraryRoot: finalAbs,
      sourceKind: 'git',
      sourceRef: ref,
      resolvedSha: fetched.resolvedSha,
      cachePathAbs: finalAbs,
      cachePathRel: finalRel,
    };
  }
  if (kind === 'tarball') {
    const expected = typeof parsed.values.sha256 === 'string' ? parsed.values.sha256 : '';
    if (!expected) {
      stderr.write("[error] blueprint library add: tarball source requires --sha256 <hex> (64 hex chars); the SHA-256 is the pin (spec §6.1).\n");
      return 2;
    }
    if (dryRun) {
      stderr.write(`[error] blueprint library add: --dry-run is not supported for network fetches (would fetch tarball ${ref}).\n`);
      return 2;
    }
    const scratchPrefix = `.pending-${process.pid}-${Date.now().toString(36)}`;
    const provisionalRef = 'downloading';
    const scratchAbs = absoluteCachePath(projectRoot, scratchPrefix, provisionalRef);
    const prepErr = await ensureEmptyCache(scratchAbs, { replace: true });
    if (prepErr) {
      stderr.write(`[error] blueprint library add: ${prepErr.message}\n`);
      return 2;
    }
    const fetched = await fetchTarballLibrary({ url: ref, expectedSha256: expected, targetDir: scratchAbs });
    if (isRcfError(fetched)) {
      stderr.write(`[error] blueprint library add: ${fetched.message}\n`);
      await removeCache(scratchAbs);
      return 2;
    }
    const peek = await loadLibrary(scratchAbs, { validateBlueprints: false });
    if (isRcfError(peek)) {
      stderr.write(`[error] blueprint library add: ${peek.message}\n`);
      await removeCache(scratchAbs);
      return 2;
    }
    const finalRel = relativeCachePath(peek.libraryPrefix, peek.libraryRef);
    const finalAbs = absoluteCachePath(projectRoot, peek.libraryPrefix, peek.libraryRef);
    const settleErr = await settleFinal(scratchAbs, finalAbs);
    if (settleErr) {
      stderr.write(`[error] blueprint library add: ${settleErr.message}\n`);
      return 2;
    }
    return {
      libraryRoot: finalAbs,
      sourceKind: 'tarball',
      sourceRef: ref,
      tarballSha256: fetched.tarballSha256,
      cachePathAbs: finalAbs,
      cachePathRel: finalRel,
    };
  }
  stderr.write(`[error] blueprint library add: unknown source kind '${kind}'.\n`);
  return 2;
}

async function settleFinal(scratchAbs, finalAbs) {
  const { rename, mkdir, rm } = await import('node:fs/promises');
  const { dirname } = await import('node:path');
  try {
    await rm(finalAbs, { recursive: true, force: true });
    await mkdir(dirname(finalAbs), { recursive: true });
    await rename(scratchAbs, finalAbs);
    return null;
  } catch (err) {
    return { kind: 'ioFailure', message: `library cache settle: ${err.message}` };
  }
}

async function handleList({ parsed, projectRoot, stdout, stderr }) {
  const registry = await readLibraryRegistry(projectRoot);
  if (isRcfError(registry)) {
    stderr.write(`[error] blueprint library list: ${registry.message}\n`);
    return 2;
  }
  if (parsed.values.json) {
    stdout.write(`${JSON.stringify({
      registryVersion: registry.registryVersion,
      libraries: registry.libraries.map((l) => ({
        libraryPrefix: l.libraryPrefix,
        sourceKind: l.sourceKind,
        sourceRef: l.sourceRef,
        publisher: l.publisher,
        libraryRef: l.libraryRef,
        blueprintCount: Array.isArray(l.blueprints) ? l.blueprints.length : 0,
        addedAt: l.addedAt,
      })),
    }, null, 2)}\n`);
    return 0;
  }
  if (registry.libraries.length === 0) {
    if (!parsed.values.quiet) stdout.write('[blueprint library] no libraries registered on this project.\n');
    return 0;
  }
  for (const l of registry.libraries) {
    const count = Array.isArray(l.blueprints) ? l.blueprints.length : 0;
    stdout.write(`${l.libraryPrefix}\t${l.sourceKind}\t${l.publisher.displayName}\t${count} blueprint(s)\t${l.sourceRef}\n`);
  }
  return 0;
}

async function handleRemove({ args, parsed, projectRoot, stdout, stderr }) {
  if (args.length === 0) {
    stderr.write('[error] blueprint library remove: missing <libraryPrefix>\n');
    return 2;
  }
  const libraryPrefix = args[0];
  const registry = await readLibraryRegistry(projectRoot);
  if (isRcfError(registry)) {
    stderr.write(`[error] blueprint library remove: ${registry.message}\n`);
    return 2;
  }
  const entry = findLibrary(registry, libraryPrefix);
  if (!entry) {
    stderr.write(`[error] blueprint library remove: library '${libraryPrefix}' is not registered.\n`);
    return 2;
  }
  // Refuse when any applied blueprint on the project came through the
  // library. The ownership fact lives on the record itself as
  // `libraryPrefix` (stamped at apply-time when the apply resolved
  // through this registry). Records applied before the field shipped
  // (@stravica-ai/rcf-schemas 0.5.1) carry no `libraryPrefix`; for
  // those we fall back to the pre-field signal, `source` starting with
  // `<prefix>:`. Preferring the record over the string match makes the
  // ownership durable across registry edits: a library re-registered
  // under a different prefix does not orphan the records applied under
  // the previous prefix.
  const { tree, errors } = await walkTree({ projectRoot });
  if (errors.length > 0) {
    for (const e of errors) stderr.write(`[tree] ${e.kind}: ${e.message}\n`);
    return 2;
  }
  const referring = (tree.manifest?.blueprints ?? []).filter((b) => {
    if (typeof b.libraryPrefix === 'string' && b.libraryPrefix.length > 0) {
      return b.libraryPrefix === libraryPrefix;
    }
    return typeof b.source === 'string' && b.source.startsWith(`${libraryPrefix}:`);
  });
  if (referring.length > 0) {
    stderr.write(`[error] blueprint library remove: ${referring.length} applied blueprint(s) came through '${libraryPrefix}':\n`);
    for (const r of referring) stderr.write(`  ${r.slug} <- ${r.source}\n`);
    stderr.write('remove those first (rcf define blueprint remove <slug>) or explicitly force with an escalation flag (not in v1).\n');
    return 3;
  }
  const nextRegistry = {
    registryVersion: registry.registryVersion,
    libraries: registry.libraries.filter((l) => l.libraryPrefix !== libraryPrefix),
  };
  const dryRun = parsed.values['dry-run'] === true;
  const write = await writeLibraryRegistry(projectRoot, nextRegistry, { dryRun });
  if (isRcfError(write)) {
    stderr.write(`[error] blueprint library remove: ${write.message}\n`);
    return 2;
  }
  // Clean the on-disk cache for network sources so a subsequent `add`
  // starts from a clean slate. Local sources point at the operator's
  // own directory and must never be touched.
  if (!dryRun && entry.sourceKind !== 'local') {
    const cachePathAbs = resolveCachePath(projectRoot, entry.cachePath);
    const cacheErr = await removeCache(cachePathAbs);
    if (cacheErr) {
      stderr.write(`[warn] blueprint library remove: registry entry gone; cache cleanup failed: ${cacheErr.message}\n`);
    }
  }
  if (!parsed.values.quiet) {
    stdout.write(`[blueprint library] removed '${libraryPrefix}' from ${write.path}.\n`);
  }
  return 0;
}

async function handleRefresh({ args, parsed, projectRoot, stdout, stderr }) {
  if (args.length === 0) {
    stderr.write('[error] blueprint library refresh: missing <libraryPrefix>\n');
    return 2;
  }
  const libraryPrefix = args[0];
  const registry = await readLibraryRegistry(projectRoot);
  if (isRcfError(registry)) {
    stderr.write(`[error] blueprint library refresh: ${registry.message}\n`);
    return 2;
  }
  const entry = findLibrary(registry, libraryPrefix);
  if (!entry) {
    stderr.write(`[error] blueprint library refresh: library '${libraryPrefix}' is not registered.\n`);
    return 2;
  }
  if (entry.sourceKind === 'local') {
    const library = await loadLibrary(entry.cachePath, { validateBlueprints: true });
    if (isRcfError(library)) {
      stderr.write(`[error] blueprint library refresh: ${library.message}\n`);
      return 2;
    }
    const drifted = compareLibrarySnapshot(entry, library);
    if (drifted.length > 0) {
      stderr.write(`[blueprint library refresh] '${libraryPrefix}' has drifted from the registered snapshot:\n`);
      for (const d of drifted) stderr.write(`  ${d}\n`);
      stderr.write("re-run 'rcf define blueprint library add <ref>' to pick up the newer library (spec §10.1: freshness is advisory, adoption is an operator act).\n");
      return 3;
    }
    if (!parsed.values.quiet) {
      stdout.write(`[blueprint library] '${libraryPrefix}' refresh clean: on-disk library matches the registry snapshot.\n`);
    }
    return 0;
  }
  if (entry.sourceKind === 'git') {
    const parsedGit = parseGitRef(entry.sourceRef);
    if (isRcfError(parsedGit)) {
      stderr.write(`[error] blueprint library refresh: registered sourceRef is malformed: ${parsedGit.message}\n`);
      return 2;
    }
    const upstream = await resolveRemoteSha({ url: parsedGit.url, ref: parsedGit.ref, refKind: parsedGit.refKind });
    if (isRcfError(upstream)) {
      stderr.write(`[error] blueprint library refresh: ${upstream.message}\n`);
      return 2;
    }
    if (typeof entry.resolvedSha === 'string' && entry.resolvedSha.toLowerCase() !== upstream.resolvedSha) {
      stderr.write(
        `[blueprint library refresh] '${libraryPrefix}' pin drift: the tag '${parsedGit.ref}' at ${parsedGit.url} has moved from sha `
        + `${entry.resolvedSha} to ${upstream.resolvedSha}. Publishers should not move annotated tags. `
        + `Re-add explicitly if intentional (spec §6.4 / §9.12).\n`,
      );
      return 3;
    }
    // Sha matches; re-fetch into a scratch cache and verify the tree
    // still validates. This catches the (rare) case of a cache tree
    // that has been corrupted or hand-edited between refreshes.
    const scratchPrefix = `.pending-${process.pid}-${Date.now().toString(36)}`;
    const scratchAbs = absoluteCachePath(projectRoot, scratchPrefix, parsedGit.ref);
    const prepErr = await ensureEmptyCache(scratchAbs, { replace: true });
    if (prepErr) { stderr.write(`[error] blueprint library refresh: ${prepErr.message}\n`); return 2; }
    const fetched = await fetchGitLibrary({ url: parsedGit.url, ref: parsedGit.ref, refKind: parsedGit.refKind, targetDir: scratchAbs });
    if (isRcfError(fetched)) {
      await removeCache(scratchAbs);
      stderr.write(`[error] blueprint library refresh: ${fetched.message}\n`);
      return 2;
    }
    const library = await loadLibrary(scratchAbs, { validateBlueprints: true });
    if (isRcfError(library)) {
      await removeCache(scratchAbs);
      stderr.write(`[error] blueprint library refresh: ${library.message}\n`);
      return 2;
    }
    const drifted = compareLibrarySnapshot(entry, library);
    if (drifted.length > 0) {
      await removeCache(scratchAbs);
      stderr.write(`[blueprint library refresh] '${libraryPrefix}' has drifted from the registered snapshot:\n`);
      for (const d of drifted) stderr.write(`  ${d}\n`);
      stderr.write("re-run 'rcf define blueprint library add <ref>' to pick up the newer library.\n");
      return 3;
    }
    // Land the fresh tree in the registered cache slot.
    const finalAbs = resolveCachePath(projectRoot, entry.cachePath);
    const settleErr = await settleFinal(scratchAbs, finalAbs);
    if (settleErr) { stderr.write(`[error] blueprint library refresh: ${settleErr.message}\n`); return 2; }
    if (!parsed.values.quiet) {
      stdout.write(`[blueprint library] '${libraryPrefix}' refresh clean: git ref '${parsedGit.ref}' still resolves to ${upstream.resolvedSha.slice(0, 12)}.\n`);
    }
    return 0;
  }
  if (entry.sourceKind === 'tarball') {
    const expected = entry.provenance?.tarballSha256;
    if (typeof expected !== 'string' || expected.length === 0) {
      stderr.write("[error] blueprint library refresh: tarball entry has no provenance.tarballSha256 pin.\n");
      return 2;
    }
    const scratchPrefix = `.pending-${process.pid}-${Date.now().toString(36)}`;
    const scratchAbs = absoluteCachePath(projectRoot, scratchPrefix, 'refreshing');
    const prepErr = await ensureEmptyCache(scratchAbs, { replace: true });
    if (prepErr) { stderr.write(`[error] blueprint library refresh: ${prepErr.message}\n`); return 2; }
    const fetched = await fetchTarballLibrary({ url: entry.sourceRef, expectedSha256: expected, targetDir: scratchAbs });
    if (isRcfError(fetched)) {
      await removeCache(scratchAbs);
      stderr.write(`[error] blueprint library refresh: ${fetched.message}\n`);
      return 2;
    }
    const library = await loadLibrary(scratchAbs, { validateBlueprints: true });
    if (isRcfError(library)) {
      await removeCache(scratchAbs);
      stderr.write(`[error] blueprint library refresh: ${library.message}\n`);
      return 2;
    }
    const drifted = compareLibrarySnapshot(entry, library);
    if (drifted.length > 0) {
      await removeCache(scratchAbs);
      stderr.write(`[blueprint library refresh] '${libraryPrefix}' has drifted from the registered snapshot:\n`);
      for (const d of drifted) stderr.write(`  ${d}\n`);
      stderr.write("re-run 'rcf define blueprint library add <ref>' to pick up the newer library.\n");
      return 3;
    }
    const finalAbs = resolveCachePath(projectRoot, entry.cachePath);
    const settleErr = await settleFinal(scratchAbs, finalAbs);
    if (settleErr) { stderr.write(`[error] blueprint library refresh: ${settleErr.message}\n`); return 2; }
    if (!parsed.values.quiet) {
      stdout.write(`[blueprint library] '${libraryPrefix}' refresh clean: tarball SHA-256 still matches ${expected.slice(0, 12)}.\n`);
    }
    return 0;
  }
  stderr.write(`[error] blueprint library refresh: unknown source kind '${entry.sourceKind}'.\n`);
  return 2;
}

function compareLibrarySnapshot(entry, library) {
  const drifted = [];
  if (library.libraryPrefix !== entry.libraryPrefix) drifted.push(`libraryPrefix '${entry.libraryPrefix}' -> '${library.libraryPrefix}'`);
  if (library.libraryRef !== entry.libraryRef) drifted.push(`libraryRef '${entry.libraryRef}' -> '${library.libraryRef}'`);
  if (JSON.stringify(library.bands) !== JSON.stringify(entry.bands)) drifted.push('bands changed');
  return drifted;
}

function classifySourceRef(ref) {
  // Tarball extension wins over the transport check because `https://.../foo.tar.gz`
  // is a valid tarball ref and would otherwise be misclassified as git.
  // Strip an optional `#` fragment before the extension check so a
  // fragmented tarball URL still classifies correctly.
  const noFragment = ref.split('#')[0];
  if (noFragment.endsWith('.tar.gz') || noFragment.endsWith('.tgz') || noFragment.endsWith('.tar')) return 'tarball';
  if (ref.startsWith('git+') || ref.startsWith('git@') || ref.startsWith('ssh://')) return 'git';
  // http(s) with a `.git` in the path or a `#<ref>` fragment reads as
  // a git URL; unadorned http(s) without either signal falls back to
  // local so an accidental URL does not silently invoke a git clone.
  if ((ref.startsWith('https://') || ref.startsWith('http://')) && (ref.includes('.git') || ref.includes('#'))) return 'git';
  return 'local';
}

function printReview({ stdout, ref, library, libraryPrefix, coreReservations, sourceKind = 'local', resolvedSha, tarballSha256 }) {
  const suffix = (library.bands.suffixBlocks ?? []).map((b) => `${b.kind} ${b.start}-${b.end}`).join(', ');
  stdout.write(`\nREVIEW - you are about to add this library to the project registry.\n\n`);
  stdout.write(`  Library      : ${library.displayName}\n`);
  stdout.write(`  Prefix       : ${libraryPrefix}\n`);
  stdout.write(`  Publisher    : ${library.publisher.displayName}${library.publisher.contact ? ` <${library.publisher.contact}>` : ''}\n`);
  stdout.write(`  Source       : ${ref} (${sourceKind})\n`);
  if (typeof resolvedSha === 'string' && resolvedSha.length > 0) {
    stdout.write(`  Pinned sha   : ${resolvedSha}\n`);
  }
  if (typeof tarballSha256 === 'string' && tarballSha256.length > 0) {
    stdout.write(`  Tarball sha  : ${tarballSha256}\n`);
  }
  stdout.write(`  Library ref  : ${library.libraryRef}\n`);
  stdout.write(`  AC band      : ${library.bands.ac.start} - ${library.bands.ac.end}\n`);
  if (suffix.length > 0) stdout.write(`  Suffix blocks: ${suffix}\n`);
  stdout.write(`\n  Blueprints on this library:\n`);
  for (const bp of library.blueprints) {
    stdout.write(`    ${libraryPrefix}:${bp.slug}\n`);
  }
  // Spec §8.1: surface the scope:global ADR topics each blueprint
  // claims so the operator sees, at the review moment, which cross-
  // library / cross-core trust-boundary interactions this add commits
  // them to. Suppressed only when no blueprint on the library claims
  // any global topic (the render would otherwise be a lonely header).
  const withTopics = library.blueprints.filter((bp) => Array.isArray(bp.globalTopics) && bp.globalTopics.length > 0);
  if (withTopics.length > 0) {
    const qualifiedWidth = Math.max(...withTopics.map((bp) => `${libraryPrefix}:${bp.slug}`.length));
    stdout.write(`\n  Global topics these blueprints claim (may conflict with core or with other libraries):\n`);
    for (const bp of withTopics) {
      const qualified = `${libraryPrefix}:${bp.slug}`;
      stdout.write(`    ${qualified.padEnd(qualifiedWidth)} -> ${bp.globalTopics.join(', ')}\n`);
    }
  }
  stdout.write(`\n  Provenance   : ${sourceKind}${sourceKind === 'local' ? ' (dev use)' : ''}\n`);
  stdout.write(`  Band check   : cross-checked ${coreReservations.ac.length} core AC row(s), ${coreReservations.suffixBlocks.length} core suffix block(s); no overlap.\n`);
  stdout.write(`  Prefix check : '${libraryPrefix}' does not collide with any core slug.\n`);
  stdout.write(`\n`);
}

async function prompt(stdin, stdout, question) {
  return new Promise((resolveP) => {
    const rl = createInterface({ input: stdin, output: stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolveP(answer);
    });
  });
}

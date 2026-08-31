// `rcf define blueprint library <verb>` CLI.
//
// Verbs (Phase 2b):
//   add      register an external library on this project (local source in
//            2b; network fetchers land in 2c)
//   list     list registered libraries
//   remove   unregister a library (refuses when any applied blueprint on
//            the project came through the library)
//   refresh  re-validate an already-registered library's on-disk shape
//
// Spec: external-blueprint-libraries-spec-2026-08-31.md sections 4, 8.

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
                       <ref> is either a local absolute or relative path
                       to a library root (a directory containing
                       library.json). Fetches metadata, runs review-on-
                       add, and writes an entry to
                       rcf/blueprint-libraries.json.

                       Phase 2b covers local sources; the git and
                       tarball fetchers land in Phase 2c. A private-repo
                       library today is registered via a local clone.

  list [--json]        List every registered library on this project
                       (prefix, source, publisher, blueprint count).

  remove <prefix>      Unregister a library. Refuses when any applied
                       blueprint on the project came through this
                       library.

  refresh <prefix>     Re-validate an already-registered library's
                       on-disk shape. Phase 2b re-reads the local
                       library.json and reports any drift from the
                       registry snapshot; phase 2c will re-fetch a git
                       or tarball source and verify the sha.

Options:
  --prefix <slug>      (add) Override the library's declared prefix.
                       Rarely needed; only useful when two libraries
                       collide on prefix locally.
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

  // Phase 2b: local sources only. Fetchers land in 2c.
  const kind = classifySourceRef(ref);
  if (kind !== 'local') {
    stderr.write(
      `[error] blueprint library add: source kind '${kind}' requires the network fetchers landing in Phase 2c. `
      + 'In 2b, register the library from a local path (a directory carrying library.json). '
      + 'For private git repos today, clone the repo locally and point add at the clone.\n',
    );
    return 2;
  }

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

  const library = await loadLibrary(localRoot, { validateBlueprints: true });
  if (isRcfError(library)) {
    stderr.write(`[error] blueprint library add: ${library.message}\n`);
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
    printReview({ stdout, ref, library, libraryPrefix, coreReservations });
    if (!iHaveReviewed) {
      const proceed = await prompt(stdin, stdout, 'Proceed with add? [y/N] ');
      if (!/^y(es)?$/i.test((proceed ?? '').trim())) {
        stdout.write('[blueprint library] aborted by operator; no registry entry written.\n');
        return 0;
      }
    }
  }

  const entry = {
    libraryPrefix,
    sourceKind: 'local',
    sourceRef: localRoot,
    displayName: library.displayName,
    publisher: { ...library.publisher },
    libraryRef: library.libraryRef,
    bands: library.bands,
    blueprints: library.blueprints.map((b) => ({ slug: b.slug, path: b.path })),
    addedAt: now.toISOString(),
    reviewedBy: 'operator',
    provenance: { tier: 'local' },
    cachePath: localRoot,
  };

  const nextRegistry = {
    registryVersion: registry.registryVersion,
    libraries: [...registry.libraries, entry],
  };
  const write = await writeLibraryRegistry(projectRoot, nextRegistry, { dryRun: parsed.values['dry-run'] === true });
  if (isRcfError(write)) {
    stderr.write(`[error] blueprint library add: ${write.message}\n`);
    return 2;
  }
  if (parsed.values.json) {
    stdout.write(`${JSON.stringify({
      added: !parsed.values['dry-run'],
      dryRun: parsed.values['dry-run'] === true,
      libraryPrefix: entry.libraryPrefix,
      blueprintCount: entry.blueprints.length,
      registryPath: write.path,
    })}\n`);
    return 0;
  }
  if (!parsed.values.quiet) {
    if (parsed.values['dry-run']) {
      stdout.write(`[blueprint library] dry-run: would add '${libraryPrefix}' (${entry.blueprints.length} blueprint(s)) to ${write.path}.\n`);
    } else {
      stdout.write(`[blueprint library] added '${libraryPrefix}' (${entry.blueprints.length} blueprint(s)) to ${write.path}.\n`);
    }
  }
  return 0;
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
  // library. Signal: `manifest.blueprints[].source` starts with `<prefix>:`.
  const { tree, errors } = await walkTree({ projectRoot });
  if (errors.length > 0) {
    for (const e of errors) stderr.write(`[tree] ${e.kind}: ${e.message}\n`);
    return 2;
  }
  const referring = (tree.manifest?.blueprints ?? []).filter((b) => typeof b.source === 'string' && b.source.startsWith(`${libraryPrefix}:`));
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
  const write = await writeLibraryRegistry(projectRoot, nextRegistry, { dryRun: parsed.values['dry-run'] === true });
  if (isRcfError(write)) {
    stderr.write(`[error] blueprint library remove: ${write.message}\n`);
    return 2;
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
  if (entry.sourceKind !== 'local') {
    stderr.write(`[error] blueprint library refresh: source kind '${entry.sourceKind}' requires the network fetchers landing in Phase 2c.\n`);
    return 2;
  }
  const library = await loadLibrary(entry.cachePath, { validateBlueprints: true });
  if (isRcfError(library)) {
    stderr.write(`[error] blueprint library refresh: ${library.message}\n`);
    return 2;
  }
  // Detect drift from the registry snapshot on load-bearing fields.
  const drifted = [];
  if (library.libraryPrefix !== entry.libraryPrefix) drifted.push(`libraryPrefix '${entry.libraryPrefix}' -> '${library.libraryPrefix}'`);
  if (library.libraryRef !== entry.libraryRef) drifted.push(`libraryRef '${entry.libraryRef}' -> '${library.libraryRef}'`);
  if (JSON.stringify(library.bands) !== JSON.stringify(entry.bands)) drifted.push('bands changed');
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

function classifySourceRef(ref) {
  if (ref.startsWith('git+') || ref.startsWith('git@') || ref.startsWith('https://') || ref.startsWith('http://') || ref.startsWith('ssh://')) return 'git';
  if (ref.endsWith('.tar.gz') || ref.endsWith('.tgz') || ref.endsWith('.tar')) return 'tarball';
  return 'local';
}

function printReview({ stdout, ref, library, libraryPrefix, coreReservations }) {
  const suffix = (library.bands.suffixBlocks ?? []).map((b) => `${b.kind} ${b.start}-${b.end}`).join(', ');
  stdout.write(`\nREVIEW - you are about to add this library to the project registry.\n\n`);
  stdout.write(`  Library      : ${library.displayName}\n`);
  stdout.write(`  Prefix       : ${libraryPrefix}\n`);
  stdout.write(`  Publisher    : ${library.publisher.displayName}${library.publisher.contact ? ` <${library.publisher.contact}>` : ''}\n`);
  stdout.write(`  Source       : ${ref} (local)\n`);
  stdout.write(`  Library ref  : ${library.libraryRef}\n`);
  stdout.write(`  AC band      : ${library.bands.ac.start} - ${library.bands.ac.end}\n`);
  if (suffix.length > 0) stdout.write(`  Suffix blocks: ${suffix}\n`);
  stdout.write(`\n  Blueprints on this library:\n`);
  for (const bp of library.blueprints) {
    stdout.write(`    ${libraryPrefix}:${bp.slug}\n`);
  }
  stdout.write(`\n  Provenance   : local (dev use)\n`);
  stdout.write(`  Band check   : cross-checked ${coreReservations.ac.length} core AC row(s), ${coreReservations.suffixBlocks.length} core suffix block(s); no overlap.\n`);
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

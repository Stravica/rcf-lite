// Resolve a `rcf define blueprint add <source>` argument to an absolute
// blueprint directory.
//
// Resolution order (Phase 1 + Phase 2b external-library registry;
// see external-blueprint-libraries-spec-2026-08-31.md section 5.2 for
// the ratified spec text):
//
//   1. `@stock/<slug>` is reserved for the packaged shelf. The `@stock/`
//      qualifier strips off and the bare slug resolves against the
//      packaged shelf. This is the recommended long-form.
//   2. Any other `@<library>/<slug>` (slash form) is rejected. The
//      ratified qualified surface (spec §9.2) is COLON-separated
//      (`<libraryPrefix>:<slug>`); the slash form is a reserved
//      non-canonical shape and the refusal message points at the colon
//      form so the operator sees the right invocation.
//   3. `<libraryPrefix>:<slug>` (colon form) is the qualified external-
//      library reference (spec §5.2 step 1). The segment before the
//      colon must match a `libraryPrefix` in the project registry at
//      `rcf/blueprint-libraries.json`; the resolver expands to
//      `<library-cache>/blueprints/<segment-after-colon>` and returns
//      an `effectiveSlug` (`<libraryPrefix>-<slug>`) plus the library
//      prefix so the apply layer can stamp the qualified identity on
//      contributions and the applied-blueprint record.
//   4. Any argument that names a filesystem location - starts with `./`,
//      `../`, `/`, or `~`, or contains a path separator, or names an
//      existing directory - is treated as a PATH and returned unchanged.
//      This preserves the existing local / relative-path semantic every
//      test and existing operator invocation relies on.
//   5. Any other bare kebab slug (`deploy-cloudflare-workers`,
//      `application-spa`) resolves against the packaged shelf. This is
//      the sugar the persona reviews asked for; it means the docs and
//      the CLI say the same thing.
//   6. Anything that has slipped through here falls through as a path
//      so the loader's own "no blueprint.json found" error names the
//      exact string the operator typed.
//
// The packaged shelf lives at `<packageRoot>/blueprints/<slug>/` - the
// tarball is built with `files: [ "blueprints" ]` and a `prepack`
// script that copies the repo-root shelf into the package directory
// before pack runs.

import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rcfError } from '../core/errors/index.js';
import { findLibrary, readLibraryRegistry } from './library-registry.js';

const here = dirname(fileURLToPath(import.meta.url));
// packages/rcf-lite/src/blueprint -> packages/rcf-lite
const PACKAGE_ROOT = resolve(here, '..', '..');
const PACKAGED_SHELF = join(PACKAGE_ROOT, 'blueprints');

const KEBAB_SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const QUALIFIED = /^@([a-z][a-z0-9-]*)\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/;
// Colon-form qualified reference: <libraryPrefix>:<blueprintSlug>. Both
// sides are kebab slugs (per spec §5.1 / §5.2). Grammar matches the
// blueprintSlug pattern on each side.
const COLON_QUALIFIED = /^([a-z][a-z0-9]*(?:-[a-z0-9]+)*):([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/;

const PATH_HINT = /[\\/]|^~|^\./;

/**
 * @typedef {object} ResolvedSource
 * @property {'path' | 'shelf' | 'library'} kind
 *   `path` if the argument was treated as a filesystem path (unchanged);
 *   `shelf` if a bare slug or `@stock/<slug>` was resolved against the
 *   packaged shelf; `library` if a colon-qualified `<libraryPrefix>:<slug>`
 *   was resolved through the project registry to an external-library
 *   blueprint directory. The apply.js layer treats every kind the same
 *   once resolved (all are absolute directory paths); the kind is
 *   exposed for the CLI's diagnostics and (for `library`) so the apply
 *   layer can pick up the `effectiveSlug` and `libraryPrefix`.
 * @property {string} resolved  Absolute path suitable for `applyBlueprint({ source })`.
 * @property {string} original  The argument the operator typed, preserved for
 *   diagnostics, the conflict-renderer's supersede hint, and (for
 *   `library`) as the qualified ref written into `manifest.blueprints[].source`.
 * @property {string} [slug]           The bare slug when resolution went through the shelf.
 * @property {string} [libraryPrefix]  The library prefix when resolution went through the registry.
 * @property {string} [libraryBlueprintSlug]
 *                                     The blueprint's own bare slug inside the library.
 * @property {string} [effectiveSlug]  `<libraryPrefix>-<libraryBlueprintSlug>` when
 *                                     kind is `library` (spec §5.3); the value the
 *                                     apply layer stamps as both the blueprint's
 *                                     namespace and the applied record's `slug`.
 * @property {{ ac: { start: number, end: number }, suffixBlocks?: Array<{ kind: string, start: number, end: number }> }} [libraryBands]
 *                                     The library's declared bands, forwarded so the
 *                                     apply-time gate can refuse contributions that
 *                                     fall outside them.
 */

/**
 * @param {string} source - argument as typed by the operator
 * @param {object} [opts]
 * @param {string} [opts.packagedShelf] - override for tests
 * @param {string} [opts.projectRoot]   - project root for registry lookups.
 *   When omitted, colon-qualified sources refuse with a "no registry
 *   context" error. Callers apply-time (CLI, MCP) always supply this;
 *   test callers that only exercise the shelf paths may omit it.
 * @returns {Promise<ResolvedSource | import('../core/errors/index.js').RcfError>}
 */
export async function resolveBlueprintSource(source, opts = {}) {
  if (typeof source !== 'string' || source.length === 0) {
    return rcfError({ kind: 'usage', message: 'blueprint source is required' });
  }
  const packagedShelf = opts.packagedShelf ?? PACKAGED_SHELF;

  // Rule 1 / 2 FIRST: qualified `@lib/slug` forms carry a `/` that
  // would otherwise trip the path-hint check below. `@stock/<slug>`
  // resolves to the packaged shelf; every other slash form is the
  // non-canonical shape and refuses, pointing at the ratified colon
  // form (spec §9.2).
  const qualified = QUALIFIED.exec(source);
  if (qualified) {
    const [, library, slug] = qualified;
    if (library === 'stock') {
      return resolveShelfSlug(slug, source, packagedShelf);
    }
    return rcfError({
      kind: 'usage',
      message: (
        `blueprint source '${source}' uses the slash-qualified '@<library>/<slug>' shape, which is not the ratified external-library reference form. `
        + `Use the colon form '${library}:${slug}' after registering the library with 'rcf define blueprint library add <ref>', or '@stock/<slug>' for the packaged shelf.`
      ),
    });
  }

  // Rule 3: colon-qualified `<libraryPrefix>:<slug>` is the ratified
  // external-library reference (spec §5.2). We check before the path
  // hint because the colon-form is unambiguous: a colon is not a
  // filesystem separator on any platform we target, and the kebab
  // grammar on both sides rules out an accidental match with, for
  // example, a Windows drive letter (`C:\path`, uppercase, backslash).
  const colon = COLON_QUALIFIED.exec(source);
  if (colon) {
    const [, libraryPrefix, blueprintSlug] = colon;
    return resolveLibraryQualified({
      libraryPrefix,
      blueprintSlug,
      original: source,
      projectRoot: opts.projectRoot,
    });
  }

  // Rule 4: path-looking arguments are passed through unchanged. We look
  // at the SHAPE only (does it contain a separator, does it start with a
  // relative-path marker, is it absolute), so an existing operator with a
  // `./blueprints/foo` invocation keeps the current behaviour byte-for-byte.
  if (isAbsolute(source) || PATH_HINT.test(source)) {
    return { kind: 'path', resolved: resolve(source), original: source };
  }

  // Rule 5: any other bare kebab token is a shelf slug.
  if (KEBAB_SLUG.test(source)) {
    return resolveShelfSlug(source, source, packagedShelf);
  }

  // Rule 6: anything that has slipped through here is neither a path,
  // nor a qualified library slug, nor a bare kebab slug. Treat it as a
  // path so the loader emits the familiar "no blueprint.json found"
  // error against the exact string the operator typed; that keeps the
  // failure locus close to what they wrote rather than adding a
  // resolver-specific class.
  return { kind: 'path', resolved: resolve(source), original: source };
}

async function resolveLibraryQualified({ libraryPrefix, blueprintSlug, original, projectRoot }) {
  if (typeof projectRoot !== 'string' || projectRoot.length === 0) {
    return rcfError({
      kind: 'usage',
      message: `blueprint source '${original}' uses the qualified library form but the resolver was called without a projectRoot; the registry at rcf/blueprint-libraries.json cannot be located.`,
    });
  }
  const registry = await readLibraryRegistry(projectRoot);
  if (registry.kind) return registry; // RcfError
  const entry = findLibrary(registry, libraryPrefix);
  if (!entry) {
    const known = registry.libraries.map((l) => l.libraryPrefix);
    const hint = known.length > 0
      ? ` Registered libraries: ${known.join(', ')}.`
      : ' No libraries are registered on this project; run `rcf define blueprint library add <ref>` first.';
    return rcfError({
      kind: 'usage',
      message: `blueprint source '${original}' names library '${libraryPrefix}' which is not registered on this project.${hint}`,
    });
  }
  const libraryRoot = isAbsolute(entry.cachePath) ? entry.cachePath : join(projectRoot, entry.cachePath);
  const bpEntry = findBlueprintEntry(entry, blueprintSlug);
  if (!bpEntry) {
    return rcfError({
      kind: 'usage',
      message: `blueprint source '${original}': library '${libraryPrefix}' has no blueprint with slug '${blueprintSlug}' in its registered manifest snapshot; the operator may need to re-run 'rcf define blueprint library add <ref>' to pick up a newer library.`,
    });
  }
  const resolved = join(libraryRoot, bpEntry.path);
  if (!existsSync(resolved)) {
    return rcfError({
      kind: 'usage',
      message: `blueprint source '${original}': library '${libraryPrefix}' blueprint '${blueprintSlug}' resolved to ${resolved} but that path is missing. Run 'rcf define blueprint library refresh ${libraryPrefix}'.`,
      filePath: resolved,
    });
  }
  return {
    kind: 'library',
    resolved,
    original,
    libraryPrefix,
    libraryBlueprintSlug: blueprintSlug,
    effectiveSlug: `${libraryPrefix}-${blueprintSlug}`,
    libraryBands: entry.bands,
  };
}

function findBlueprintEntry(entry, blueprintSlug) {
  // Registry entries snapshot the library's blueprints[] at add time
  // (spec §4.2); the snapshot is what the resolver consults. When the
  // snapshot is absent (a future registry-version compatibility case),
  // fall through and let the on-disk library dictate the layout by
  // relying on the conventional blueprints/<slug>/ path.
  if (!Array.isArray(entry.blueprints)) {
    return { slug: blueprintSlug, path: `blueprints/${blueprintSlug}` };
  }
  return entry.blueprints.find((b) => b.slug === blueprintSlug);
}

async function resolveShelfSlug(slug, original, packagedShelf) {
  const candidate = join(packagedShelf, slug);
  if (!existsSync(candidate)) {
    const known = await knownShelfSlugs(packagedShelf);
    const suggestion = known.length > 0
      ? ` Known shelf slugs: ${known.join(', ')}.`
      : ' The packaged shelf appears empty; reinstall rcf-lite to restore it.';
    return rcfError({
      kind: 'usage',
      message: `blueprint source '${original}' did not match a packaged shelf entry at ${candidate}.${suggestion}`,
      filePath: candidate,
    });
  }
  try {
    const s = await stat(candidate);
    if (!s.isDirectory()) {
      return rcfError({
        kind: 'usage',
        message: `blueprint source '${original}' resolved to ${candidate} but that path is not a directory.`,
        filePath: candidate,
      });
    }
  } catch (err) {
    return rcfError({
      kind: 'ioFailure',
      message: `blueprint source '${original}' resolution failed: ${err.message}`,
      filePath: candidate,
    });
  }
  return { kind: 'shelf', resolved: candidate, original, slug };
}

/**
 * Enumerate the packaged shelf's slugs (top-level directories). Empty
 * array on a missing shelf. Used to render a helpful "did you mean"
 * hint on a resolver miss.
 *
 * @param {string} [packagedShelf]
 * @returns {Promise<string[]>}
 */
export async function knownShelfSlugs(packagedShelf = PACKAGED_SHELF) {
  try {
    const { readdir } = await import('node:fs/promises');
    const entries = await readdir(packagedShelf, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

/** Absolute path of the packaged shelf. Test-visible. */
export function packagedShelfPath() {
  return PACKAGED_SHELF;
}

/** Placeholder to keep unused-import linters happy in bundles that only pull the constant. */
export const PATH_SEPARATOR = sep;

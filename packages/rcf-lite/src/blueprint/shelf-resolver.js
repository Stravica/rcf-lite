// Resolve a `rcf define blueprint add <source>` argument to an absolute
// blueprint directory.
//
// Resolution order (Phase 1; the phase-2 external-library registry
// layers on top of this without reworking the CLI):
//
//   1. Any argument that names a filesystem location - starts with `./`,
//      `../`, `/`, or `~`, or contains a path separator, or names an
//      existing directory - is treated as a PATH and returned unchanged.
//      This preserves the existing local / relative-path semantic every
//      test and existing operator invocation relies on.
//   2. `@stock/<slug>` is reserved for the packaged shelf. The `@stock/`
//      qualifier strips off and the bare slug resolves against the
//      packaged shelf. This is the recommended long-form.
//   3. Any other bare kebab slug (`deploy-cloudflare-workers`,
//      `application-spa`) resolves against the packaged shelf. This is
//      the sugar the persona reviews asked for; it means the docs and
//      the CLI say the same thing.
//   4. A slug qualifier that names a KNOWN external-library alias other
//      than `@stock` is rejected with a clear message pointing the
//      operator at the current phase-1 capabilities. This reservation
//      keeps the phase-2 external-libraries mechanism free to land the
//      registry surface later without a breaking rename.
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

const here = dirname(fileURLToPath(import.meta.url));
// packages/rcf-lite/src/blueprint -> packages/rcf-lite
const PACKAGE_ROOT = resolve(here, '..', '..');
const PACKAGED_SHELF = join(PACKAGE_ROOT, 'blueprints');

const KEBAB_SLUG = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const QUALIFIED = /^@([a-z][a-z0-9-]*)\/([a-z][a-z0-9]*(?:-[a-z0-9]+)*)$/;

const PATH_HINT = /[\\/]|^~|^\./;

/**
 * @typedef {object} ResolvedSource
 * @property {'path' | 'shelf'} kind
 *   `path` if the argument was treated as a filesystem path (unchanged);
 *   `shelf` if a bare slug or `@stock/<slug>` was resolved against the
 *   packaged shelf. The apply.js layer treats both the same once resolved -
 *   both are absolute directory paths - but the kind is exposed for the
 *   CLI's future diagnostics (`--dry-run` labelling, etc.).
 * @property {string} resolved  Absolute path suitable for `applyBlueprint({ source })`.
 * @property {string} original  The argument the operator typed, preserved for
 *   diagnostics and the conflict-renderer's supersede hint.
 * @property {string} [slug]    The bare slug when resolution went through the shelf.
 */

/**
 * @param {string} source - argument as typed by the operator
 * @param {object} [opts]
 * @param {string} [opts.packagedShelf] - override for tests
 * @returns {Promise<ResolvedSource | import('../core/errors/index.js').RcfError>}
 */
export async function resolveBlueprintSource(source, opts = {}) {
  if (typeof source !== 'string' || source.length === 0) {
    return rcfError({ kind: 'usage', message: 'blueprint source is required' });
  }
  const packagedShelf = opts.packagedShelf ?? PACKAGED_SHELF;

  // Rule 2 / 4 FIRST: qualified `@lib/slug` forms carry a `/` that
  // would otherwise trip the path-hint check below. `@stock/<slug>`
  // resolves to the packaged shelf; any other library qualifier is
  // reserved for the phase-2 external-libraries mechanism and refuses
  // with a clear message.
  const qualified = QUALIFIED.exec(source);
  if (qualified) {
    const [, library, slug] = qualified;
    if (library === 'stock') {
      return resolveShelfSlug(slug, source, packagedShelf);
    }
    return rcfError({
      kind: 'usage',
      message: (
        `blueprint source '${source}' names external library '@${library}', which is reserved for the phase-2 external-libraries mechanism and not resolvable yet. `
        + 'Use `@stock/<slug>` for the packaged shelf, a local path (`./path/to/blueprint`), or wait for the external-library registry.'
      ),
    });
  }

  // Rule 1: path-looking arguments are passed through unchanged. We look
  // at the SHAPE only (does it contain a separator, does it start with a
  // relative-path marker, is it absolute), so an existing operator with a
  // `./blueprints/foo` invocation keeps the current behaviour byte-for-byte.
  if (isAbsolute(source) || PATH_HINT.test(source)) {
    return { kind: 'path', resolved: resolve(source), original: source };
  }

  // Rule 3: any other bare kebab token is a shelf slug.
  if (KEBAB_SLUG.test(source)) {
    return resolveShelfSlug(source, source, packagedShelf);
  }

  // Anything that has slipped through here is neither a path, nor a
  // qualified library slug, nor a bare kebab slug. Treat it as a path so
  // the loader emits the familiar "no blueprint.json found" error against
  // the exact string the operator typed; that keeps the failure locus
  // close to what they wrote rather than adding a resolver-specific class.
  return { kind: 'path', resolved: resolve(source), original: source };
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

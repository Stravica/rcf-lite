// External-library on-disk cache helpers (spec §4.4).
//
// Fetched library content sits under
// `rcf/.blueprint-libraries/<libraryPrefix>/<libraryRef>/`, checked
// into git as ordinary tree content so a fresh clone can `rcf define
// blueprint list` without a re-fetch. The cache is the working root
// the resolver reads through; the `cachePath` field on every registry
// entry points at it.
//
// This module owns path computation and a small set of directory
// primitives shared by the git and tarball fetchers (Phase 2c). It
// deliberately does NOT know about git or tar; the fetchers layer on
// top and land their extracted content at the paths computed here.

import { existsSync } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { rcfError } from '../core/errors/index.js';

export const CACHE_ROOT = 'rcf/.blueprint-libraries';

/**
 * Repo-relative cache path for a library at a given ref. Repo-relative
 * because that is what the registry stores (`entry.cachePath`); the
 * resolver joins it against `projectRoot` at read time.
 *
 * @param {string} libraryPrefix
 * @param {string} libraryRef
 * @returns {string}
 */
export function relativeCachePath(libraryPrefix, libraryRef) {
  return `${CACHE_ROOT}/${libraryPrefix}/${sanitiseRef(libraryRef)}`;
}

/**
 * Absolute cache path for a library at a given ref, joined against a
 * project root.
 *
 * @param {string} projectRoot
 * @param {string} libraryPrefix
 * @param {string} libraryRef
 * @returns {string}
 */
export function absoluteCachePath(projectRoot, libraryPrefix, libraryRef) {
  const rel = relativeCachePath(libraryPrefix, libraryRef);
  return isAbsolute(rel) ? rel : join(projectRoot, rel);
}

/**
 * Prepare an empty cache directory. Refuses when a non-empty cache
 * already exists at the target (the caller must remove it first via
 * `removeCache`, or fail fast and prompt the operator). This keeps
 * fetches deterministic: content lands on a clean slate every time.
 *
 * @param {string} absPath
 * @param {object} [opts]
 * @param {boolean} [opts.replace=false] - when true, remove any
 *   pre-existing content at absPath before creating the fresh dir.
 * @returns {Promise<null | import('../core/errors/index.js').RcfError>}
 */
export async function ensureEmptyCache(absPath, opts = {}) {
  try {
    if (existsSync(absPath)) {
      if (opts.replace === true) {
        await rm(absPath, { recursive: true, force: true });
      } else {
        const s = await stat(absPath);
        if (s.isDirectory()) {
          return rcfError({
            kind: 'usage',
            message: `library cache: path already exists at ${absPath}. Remove it or run 'library refresh' to re-fetch.`,
            filePath: absPath,
          });
        }
        return rcfError({
          kind: 'usage',
          message: `library cache: non-directory blocks cache path ${absPath}.`,
          filePath: absPath,
        });
      }
    }
    await mkdir(absPath, { recursive: true });
    return null;
  } catch (err) {
    return rcfError({
      kind: 'ioFailure',
      message: `library cache: could not prepare ${absPath}: ${err.message}`,
      filePath: absPath,
      stack: err.stack,
    });
  }
}

/**
 * Recursive remove of a cache directory. No-op when the path does not
 * exist. Used by `library remove` and by the fetchers' rollback path.
 *
 * @param {string} absPath
 * @returns {Promise<null | import('../core/errors/index.js').RcfError>}
 */
export async function removeCache(absPath) {
  try {
    await rm(absPath, { recursive: true, force: true });
    return null;
  } catch (err) {
    return rcfError({
      kind: 'ioFailure',
      message: `library cache: could not remove ${absPath}: ${err.message}`,
      filePath: absPath,
      stack: err.stack,
    });
  }
}

/**
 * Resolve an absolute cache path from either an absolute
 * `entry.cachePath` (legacy local-source entries in phase 2b stored
 * the library root path here) or a repo-relative one (phase 2c network
 * fetches store the relative form; the resolver joins with the project
 * root at read time).
 *
 * @param {string} projectRoot
 * @param {string} cachePath
 * @returns {string}
 */
export function resolveCachePath(projectRoot, cachePath) {
  return isAbsolute(cachePath) ? cachePath : resolve(projectRoot, cachePath);
}

/**
 * Replace path-hostile characters in a libraryRef so it can be used as
 * a directory segment. Refs are already semver-ish or short tag names
 * in practice; this guards against a publisher who ships a ref like
 * `1.2.0/rc1` or an operator who hand-types one. Slashes and colons are
 * mapped to a single `-` so the on-disk layout stays flat.
 *
 * @param {string} ref
 * @returns {string}
 */
export function sanitiseRef(ref) {
  return String(ref).replace(/[\\/:*?"<>|]+/g, '-');
}

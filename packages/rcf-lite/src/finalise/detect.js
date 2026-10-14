// rcf verify install detection (spec §8.3, amendment 5 - install-together
// posture). The finalise gate MUST detect whether the `rcf` bin (which
// carries the `verify` group) is resolvable and, when it is absent,
// prompt to install rcf-lite - NEVER silently skip the ship gate (the
// one behaviour §8.3 explicitly forbids).
//
// The 0.10.0 CLI reorganisation folded the standalone `rcf-verify` bin
// into the umbrella `rcf` CLI as the `verify` group. Detection now
// resolves the `rcf` bin exclusively; there is no legacy fallback.
//
// Three detection routes, in order (issue 356, US-16505 / AC-16505-5:
// package-first, PATH as the documented fallback):
//   1. The package finalise itself runs from - this package's own
//      `bin/rcf.js`, resolved relative to this module. Finalise and the
//      verify it launches are then the same install at the same
//      version, so an isolated project install (`node_modules/.bin/rcf
//      build finalise`) can never spawn a stale global that happens to
//      sit first on PATH (the issue 356 symptom: a 0.33.0 global exited
//      2 on the 0.34.0 arguments without writing a report).
//   2. Package resolution from the project dir - a local-project install
//      (`npm i rcf-lite` in a repo's node_modules) resolves the
//      `rcf-lite` package and its `bin/rcf.js` entry point. Reached only
//      when route 1 cannot see its own entry (a bundled or relocated
//      copy of this module).
//   3. The `rcf` bin on PATH - the umbrella install exposes `rcf` as a
//      global bin (`npm i -g rcf-lite`). The fallback when no package
//      entry resolves at all.
// Every route yields a concrete invocation the finalise spawn (spawn.js)
// uses verbatim, carrying the `source` route and the `version` of the
// resolved binary (read from its package.json; null when a PATH bin does
// not lead back to a readable rcf-lite package.json: omit-not-fake).
// Finalise records the invocation on the report as `run.verify` so an
// operator can see which verifier ran. A miss returns { installed:false }
// and the caller enters the prompt-or-explicit-flag path.

import { access, constants, readFile, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// VERIFY_PACKAGE is the install target and the name shown to operators
// in absent-verify messaging.
const VERIFY_PACKAGE = 'rcf-lite';
const VERIFY_PACKAGE_CANDIDATES = [VERIFY_PACKAGE];
const VERIFY_BIN = 'rcf';

// This module lives at <package>/src/finalise/detect.js; the package's
// own verify entry is <package>/bin/rcf.js (package.json "bin").
const SELF_PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SELF_BIN_ENTRY = join(SELF_PACKAGE_ROOT, 'bin', 'rcf.js');

/**
 * The concrete way to launch the `rcf` bin as a fresh subprocess.
 *   - `{ command: '<abs-bin>', prefixArgs: [] }` for a PATH / shim bin
 *     (its own shebang runs it).
 *   - `{ command: process.execPath, prefixArgs: ['<abs-entry.js>'] }` for a
 *     package-resolved entry (run it under the current node): the package
 *     finalise runs from, or the project's local install (the entry path
 *     tells them apart).
 *   - `version` is the resolved binary's package.json version, or null
 *     when it could not be read.
 * @typedef {{ command: string, prefixArgs: string[], source: 'path'|'package', version: string|null }} VerifyInvocation
 */

/**
 * @typedef {{ installed: boolean, invocation: VerifyInvocation | null }} VerifyDetection
 */

/**
 * Scan PATH for an executable named `rcf` (plus the Windows `.cmd` /
 * `.exe` shim variants). Returns the first absolute path that exists
 * and is executable, or null.
 *
 * @param {string} name
 * @param {object} [io]
 * @param {NodeJS.ProcessEnv} [io.env]
 * @returns {Promise<string|null>}
 */
export async function findOnPath(name, { env = process.env } = {}) {
  const rawPath = env.PATH ?? env.Path ?? '';
  if (!rawPath) return null;
  const dirs = rawPath.split(delimiter).filter(Boolean);
  // On Windows a bare name resolves via PATHEXT-style shims; probe the common
  // npm shim names. On POSIX only the bare name matters.
  const candidates = process.platform === 'win32'
    ? [`${name}.cmd`, `${name}.exe`, name]
    : [name];
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = resolve(dir, candidate);
      try {
        // X_OK is meaningless for the .cmd/.exe shims on Windows; existence is
        // enough there. On POSIX require the execute bit.
        await access(full, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        return full;
      } catch {
        // not here; keep scanning
      }
    }
  }
  return null;
}

/**
 * Resolve the `rcf` bin entry point from a starting directory, following
 * the normal node_modules resolution the caller's project sees. Returns
 * the absolute path to `bin/rcf.js`, or null if the package is not
 * installed / resolvable from there.
 *
 * @param {string} fromDir - directory to resolve from (the project root / cwd)
 * @returns {Promise<string|null>}
 */
export async function resolvePackageBin(fromDir) {
  // Resolve from a synthetic module living in fromDir so node walks that
  // project's node_modules chain, not this package's own.
  let req;
  try {
    req = createRequire(join(fromDir, 'noop.js'));
  } catch {
    return null;
  }
  for (const candidate of VERIFY_PACKAGE_CANDIDATES) {
    try {
      const pkgJsonPath = req.resolve(`${candidate}/package.json`);
      const req2 = createRequire(pkgJsonPath);
      const pkg = req2(`${candidate}/package.json`);
      const binField = pkg.bin;
      const rel = typeof binField === 'string' ? binField : binField?.[VERIFY_BIN];
      if (!rel) continue;
      const abs = resolve(dirname(pkgJsonPath), rel);
      await access(abs, constants.F_OK);
      return abs;
    } catch {
      // Candidate not resolvable from here; try the next one.
    }
  }
  return null;
}

/**
 * Resolve the verify entry of the rcf-lite package this module runs from
 * (issue 356 route 1). Returns the absolute path to this package's own
 * `bin/rcf.js`, or null when it is not on disk (a bundled or relocated
 * copy of this module that has lost its bin directory).
 *
 * @returns {Promise<string|null>}
 */
export async function resolveSelfBin() {
  try {
    await access(SELF_BIN_ENTRY, constants.F_OK);
    return SELF_BIN_ENTRY;
  } catch {
    return null;
  }
}

/**
 * Read the rcf-lite version behind a resolved `rcf` entry. Follows the
 * entry's realpath (an npm global bin is a symlink into the installed
 * package) and walks up to the nearest package.json whose name is
 * `rcf-lite`. Returns the version string, or null when nothing readable
 * answers (a foreign script named `rcf`, a shim, an unreadable tree):
 * omit-not-fake, the report then records `version: null`.
 *
 * @param {string} entryPath - absolute path of the bin or entry point
 * @returns {Promise<string|null>}
 */
export async function readEntryVersion(entryPath) {
  let start;
  try {
    start = await realpath(entryPath);
  } catch {
    return null;
  }
  let dir = dirname(start);
  for (;;) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
      if (pkg && VERIFY_PACKAGE_CANDIDATES.includes(pkg.name) && typeof pkg.version === 'string') {
        return pkg.version;
      }
    } catch {
      // No package.json here, or unreadable; keep walking up.
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Detect whether the `rcf` bin (carrying the `verify` group) is
 * resolvable and, if so, how to launch it. Deps are injectable so the
 * finalise gate can be exercised without a real installed rcf-lite.
 *
 * Order (issue 356): this package's own entry, then the project's local
 * install, then PATH. PATH is the documented fallback only.
 *
 * @param {object} [deps]
 * @param {string} [deps.cwd] - project dir to resolve a local install from
 * @param {typeof resolveSelfBin} [deps.resolveSelfBin]
 * @param {typeof resolvePackageBin} [deps.resolvePackageBin]
 * @param {typeof findOnPath} [deps.findOnPath]
 * @param {typeof readEntryVersion} [deps.readEntryVersion]
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @returns {Promise<VerifyDetection>}
 */
export async function detectVerify(deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  const versionOf = deps.readEntryVersion ?? readEntryVersion;

  const selfEntry = deps.resolveSelfBin ? await deps.resolveSelfBin() : await resolveSelfBin();
  if (selfEntry) {
    return {
      installed: true,
      invocation: {
        command: process.execPath, prefixArgs: [selfEntry], source: 'package', version: await versionOf(selfEntry),
      },
    };
  }
  const resolved = deps.resolvePackageBin ? await deps.resolvePackageBin(cwd)
    : await resolvePackageBin(cwd);
  if (resolved) {
    return {
      installed: true,
      invocation: {
        command: process.execPath, prefixArgs: [resolved], source: 'package', version: await versionOf(resolved),
      },
    };
  }
  const onPath = deps.findOnPath ? await deps.findOnPath(VERIFY_BIN, { env: deps.env })
    : await findOnPath(VERIFY_BIN, { env: deps.env });
  if (onPath) {
    return {
      installed: true,
      invocation: { command: onPath, prefixArgs: [], source: 'path', version: await versionOf(onPath) },
    };
  }
  return { installed: false, invocation: null };
}

export { VERIFY_PACKAGE, VERIFY_PACKAGE_CANDIDATES, VERIFY_BIN };

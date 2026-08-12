// rcf-verify install detection (spec §8.3, amendment 5 - install-together
// posture). The finalise gate MUST detect whether `rcf-verify` is resolvable
// and, when it is absent, prompt to install it - NEVER silently skip the ship
// gate (the one behaviour §8.3 explicitly forbids).
//
// Two detection routes, in order, matching how the CLI is actually installed:
//   1. The `rcf-verify` bin on PATH - the umbrella install exposes both `rcf`
//      and `rcf-verify` as global bins (`npm i -g rcf-lite`).
//   2. Package resolution from the project dir - the local-project install
//      (`npm i rcf-lite` in a repo's node_modules). Two package specifiers
//      are tried in order: the current umbrella `rcf-lite`, then the legacy
//      `@stravica-ai/rcf-verify-lite` name (deprecated at 0.7.1 but still
//      resolvable in lockfiles that pinned it). Either resolves to the same
//      `bin/rcf-verify.js` entry point.
// Either route yields a concrete invocation the finalise spawn (spawn.js)
// uses verbatim. A miss returns { installed:false } and the caller enters
// the prompt-or-explicit-flag path.

import { access, constants } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve } from 'node:path';

// VERIFY_PACKAGE is the current install target and the name shown to
// operators in absent-verify messaging. VERIFY_PACKAGE_LEGACY is only used
// as a resolution fallback for lockfiles still pinning the pre-0.7.1 scoped
// name; it is never displayed as an install target.
const VERIFY_PACKAGE = 'rcf-lite';
const VERIFY_PACKAGE_LEGACY = '@stravica-ai/rcf-verify-lite';
const VERIFY_PACKAGE_CANDIDATES = [VERIFY_PACKAGE, VERIFY_PACKAGE_LEGACY];
const VERIFY_BIN = 'rcf-verify';

/**
 * The concrete way to launch rcf-verify as a fresh subprocess.
 *   - `{ command: '<abs-bin>', prefixArgs: [] }` for a PATH / shim bin
 *     (its own shebang runs it).
 *   - `{ command: process.execPath, prefixArgs: ['<abs-entry.js>'] }` for a
 *     package-resolved entry (run it under the current node).
 * @typedef {{ command: string, prefixArgs: string[], source: 'path'|'package' }} VerifyInvocation
 */

/**
 * @typedef {{ installed: boolean, invocation: VerifyInvocation | null }} VerifyDetection
 */

/**
 * Scan PATH for an executable named `rcf-verify` (plus the Windows
 * `.cmd`/`.exe` shim variants). Returns the first absolute path that exists
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
 * Resolve the rcf-verify bin entry point from a starting directory, following
 * the normal node_modules resolution the caller's project sees. Returns the
 * absolute path to `bin/rcf-verify.js`, or null if no candidate package is
 * installed / resolvable from there.
 *
 * Candidates are tried in the order defined by VERIFY_PACKAGE_CANDIDATES: the
 * current umbrella (`rcf-lite`) first, then the deprecated scoped name
 * (`@stravica-ai/rcf-verify-lite`) as a fallback for lockfiles pinned to it.
 * The first candidate whose bin resolves and exists on disk wins.
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
 * Detect whether rcf-verify is resolvable and, if so, how to launch it.
 * Deps are injectable so the finalise gate can be exercised without a real
 * rcf-verify on the test machine.
 *
 * @param {object} [deps]
 * @param {string} [deps.cwd] - project dir to resolve a local install from
 * @param {typeof findOnPath} [deps.findOnPath]
 * @param {typeof resolvePackageBin} [deps.resolvePackageBin]
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @returns {Promise<VerifyDetection>}
 */
export async function detectVerify(deps = {}) {
  const cwd = deps.cwd ?? process.cwd();
  const onPath = deps.findOnPath ? await deps.findOnPath(VERIFY_BIN, { env: deps.env })
    : await findOnPath(VERIFY_BIN, { env: deps.env });
  if (onPath) {
    return { installed: true, invocation: { command: onPath, prefixArgs: [], source: 'path' } };
  }
  const resolved = deps.resolvePackageBin ? await deps.resolvePackageBin(cwd)
    : await resolvePackageBin(cwd);
  if (resolved) {
    return {
      installed: true,
      invocation: { command: process.execPath, prefixArgs: [resolved], source: 'package' },
    };
  }
  return { installed: false, invocation: null };
}

export { VERIFY_PACKAGE, VERIFY_PACKAGE_LEGACY, VERIFY_PACKAGE_CANDIDATES, VERIFY_BIN };

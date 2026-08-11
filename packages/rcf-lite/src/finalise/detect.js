// rcf-verify install detection (spec §8.3, amendment 5 - install-together
// posture). build-lite's finalise gate MUST detect whether `rcf-verify` is
// resolvable and, when it is absent, prompt to install it - NEVER silently
// skip the ship gate (the one behaviour §8.3 explicitly forbids).
//
// Two detection routes, in order, matching how the two packages are actually
// installed:
//   1. The `rcf-verify` bin on PATH - the install-together default is two
//      global bins (`npm i -g @stravica-ai/rcf-build-lite @stravica-ai/rcf-verify-lite`).
//   2. Package resolution from the project dir - the local-project install
//      (`npm i @stravica-ai/rcf-verify-lite` in a repo's node_modules).
// Either hit yields a concrete invocation the finalise spawn (spawn.js) uses
// verbatim. A miss returns { installed:false } and the caller enters the
// prompt-or-explicit-flag path.

import { access, constants } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { delimiter, dirname, join, resolve } from 'node:path';

const VERIFY_PACKAGE = '@stravica-ai/rcf-verify-lite';
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
 * Resolve the rcf-verify package's bin entry point from a starting directory,
 * following the normal node_modules resolution the caller's project sees.
 * Returns the absolute path to `bin/rcf-verify.js`, or null if the package is
 * not installed / not resolvable from there.
 *
 * @param {string} fromDir - directory to resolve from (the project root / cwd)
 * @returns {Promise<string|null>}
 */
export async function resolvePackageBin(fromDir) {
  try {
    // Resolve from a synthetic module living in fromDir so node walks that
    // project's node_modules chain, not build-lite's own.
    const req = createRequire(join(fromDir, 'noop.js'));
    const pkgJsonPath = req.resolve(`${VERIFY_PACKAGE}/package.json`);
    const req2 = createRequire(pkgJsonPath);
    const pkg = req2(`${VERIFY_PACKAGE}/package.json`);
    const binField = pkg.bin;
    const rel = typeof binField === 'string' ? binField : binField?.[VERIFY_BIN];
    if (!rel) return null;
    const abs = resolve(dirname(pkgJsonPath), rel);
    await access(abs, constants.F_OK);
    return abs;
  } catch {
    return null;
  }
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

export { VERIFY_PACKAGE, VERIFY_BIN };

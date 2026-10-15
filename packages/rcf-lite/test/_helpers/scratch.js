// Shared test helper for WSD-w010 (temp-dir leak fix).
//
// `scratchDir(t, prefix)` mkdtemps a fresh scratch dir and registers
// a `t.after()` that removes it. The non-`t` form `scratchDir(prefix)`
// registers cleanup on a module-level `after` hook plus a process
// `beforeExit` fallback, for mkdtemp calls from module-scope helpers
// or outside a test context. Both forms return the absolute path.
//
// `scratchDirSync(prefix)` is the sync counterpart for callers that
// cannot await (module-scope helpers that run before the first test).
//
// All three forms exist to let a run of the package test suite leave
// `TMPDIR` empty: see `test/_leak/temp-dir-cleanup.test.js`.

import { mkdtemp, rm } from 'node:fs/promises';
import {
  mkdtempSync,
  rmSync,
  chmodSync,
  readdirSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve as resolvePath, sep } from 'node:path';

const moduleTracked = new Set();
let exitHookRegistered = false;

// Finding 1 guard: the exit hook runs `rmSync({ recursive: true })`
// on every entry in `moduleTracked`, so a path registered here must
// be strictly inside the helper's own scratch root (os.tmpdir(),
// resolved through symlinks). We assert the invariant at registration
// time so a bad path never lands in the tracked set and the delete
// loop never gets a chance to touch anything outside TMPDIR. The
// cleanup loops also re-check at delete time (defence in depth
// against a between-registration-and-exit symlink swap).
const TMP_ROOT_REAL = realpathSync(tmpdir());

function resolveLeafRealPath(input) {
  // Resolve the deepest existing ancestor through realpath so a
  // symlink anywhere on the path cannot escape. A non-existent leaf
  // is tolerated (mkdtemp output may be removed between creation and
  // registration); we reattach any missing tail unchanged after the
  // deepest realpath succeeds.
  let probe = resolvePath(input);
  const tail = [];
  for (;;) {
    try {
      const real = realpathSync(probe);
      if (tail.length === 0) return real;
      return join(real, ...tail.reverse());
    } catch {
      const parent = resolvePath(probe, '..');
      if (parent === probe) {
        throw new Error(`path has no existing ancestor: ${input}`);
      }
      const seg = probe.slice(parent.length).replace(/^[\\/]+/, '');
      tail.push(seg);
      probe = parent;
    }
  }
}

function assertInsideTmpRoot(input, label) {
  if (typeof input !== 'string' || input.length === 0) {
    throw new TypeError(`${label}: path must be a non-empty string`);
  }
  if (!isAbsolute(input)) {
    throw new Error(`${label}: path must be absolute, got: ${input}`);
  }
  if (input.split(sep).includes('..')) {
    throw new Error(`${label}: path must not contain '..' segments: ${input}`);
  }
  let real;
  try {
    real = resolveLeafRealPath(input);
  } catch (err) {
    throw new Error(`${label}: ${err.message}`);
  }
  if (real === TMP_ROOT_REAL) {
    throw new Error(
      `${label}: refusing tmpdir root itself: ${input} resolves to ${real}`,
    );
  }
  if (!real.startsWith(TMP_ROOT_REAL + sep)) {
    throw new Error(
      `${label}: path escapes tmpdir ${TMP_ROOT_REAL}: ${input} resolves to ${real}`,
    );
  }
}

// Give every entry under `dir` write permissions (sync, best-effort)
// so a subsequent `rmSync` can remove trees whose contents a test
// intentionally chmod'd to r-x (see test/cli/error-classification.test.js
// BUG-007, which drops write on `rcf/requirements` and relies on its
// own `t.after` to restore it; module-level cleanup must survive that
// restore being missed or racing).
function chmodWritableRecursive(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  try {
    chmodSync(dir, 0o700);
  } catch {
    // Best-effort.
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    // Finding 2: never chmod a symlink. chmodSync follows the link
    // and would change permissions on whatever it points at,
    // including targets outside the scratch root. Platform support
    // for lchmod is inconsistent (not on Linux), so we skip
    // symlinks entirely. The recursive delete afterwards removes
    // the link (not its target) without needing a writable mode on
    // it.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      chmodWritableRecursive(full);
    } else {
      try {
        chmodSync(full, 0o600);
      } catch {
        // Best-effort.
      }
    }
  }
}

// Finding 5: a bare `rm` in the per-test `t.after` swallowed EACCES/
// EPERM silently; a 0500 subtree under the scratch dir then leaked.
// This helper retries once after relaxing permissions on the SCRATCH
// subtree (bounded by the finding 1 guard above: nothing outside
// TMPDIR is in the tracked set, so chmodWritableRecursive stays
// inside the scratch root), then surfaces any remaining failure to
// stderr named with the path. Never swallows silently.
async function removeScratchWithRetry(
  dir,
  { rmFn = rm, chmodFn = chmodWritableRecursive, onStderr } = {},
) {
  const emit = onStderr ?? ((s) => process.stderr.write(s));
  try {
    await rmFn(dir, { recursive: true, force: true });
    return;
  } catch (err) {
    const code = err && err.code;
    if (code === 'EACCES' || code === 'EPERM') {
      try {
        chmodFn(dir);
      } catch {
        // Best-effort.
      }
      try {
        await rmFn(dir, { recursive: true, force: true });
        return;
      } catch (err2) {
        emit(
          `scratch helper: cleanup failed at ${dir}: ${err2.code ?? err2.message}\n`,
        );
        throw err2;
      }
    }
    emit(
      `scratch helper: cleanup failed at ${dir}: ${code ?? err.message}\n`,
    );
    throw err;
  }
}

function cleanupSync() {
  for (const dir of moduleTracked) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch (err) {
      const code = err && err.code;
      if (code === 'EACCES' || code === 'EPERM') {
        try {
          chmodWritableRecursive(dir);
          rmSync(dir, { recursive: true, force: true });
          continue;
        } catch (err2) {
          process.stderr.write(
            `scratch helper: exit cleanup failed at ${dir}: ${err2.code ?? err2.message}\n`,
          );
          continue;
        }
      }
      process.stderr.write(
        `scratch helper: exit cleanup failed at ${dir}: ${code ?? err.message}\n`,
      );
    }
  }
  moduleTracked.clear();
}

function ensureModuleHook() {
  if (exitHookRegistered) return;
  exitHookRegistered = true;
  // Process-level cleanup is the only reliable spot: node:test's
  // `after()` from inside a test body registers for that test's own
  // context (not the file suite), so a cleanup that fires there races
  // with the test's own `t.after` chmod restores. The exit handler
  // runs after every test in the file has completed and its hooks
  // have resolved, so permission state is final by the time we rm.
  process.on('exit', cleanupSync);
}

/**
 * Create a scratch directory under `tmpdir()` and register cleanup.
 *
 * Call with a test context `t` (so cleanup fires per test), or with
 * just a prefix (cleanup fires at module teardown).
 *
 * @param {import('node:test').TestContext | string} tOrPrefix
 * @param {string} [maybePrefix]
 * @returns {Promise<string>}
 */
export async function scratchDir(tOrPrefix, maybePrefix) {
  if (typeof tOrPrefix === 'string') {
    const dir = await mkdtemp(join(tmpdir(), tOrPrefix));
    moduleTracked.add(dir);
    ensureModuleHook();
    return dir;
  }
  const t = tOrPrefix;
  const prefix = maybePrefix;
  const dir = await mkdtemp(join(tmpdir(), prefix));
  t.after(async () => {
    try {
      await removeScratchWithRetry(dir);
    } catch {
      // Already surfaced to stderr by removeScratchWithRetry; do
      // not throw from the test hook (it would mask the test's own
      // outcome). The pin asserts TMPDIR empty regardless.
    }
  });
  return dir;
}

/**
 * Sync counterpart of {@link scratchDir}. Cleanup is at module
 * teardown (via `after()` plus a `process.on('exit')` fallback).
 *
 * @param {string} prefix
 * @returns {string}
 */
export function scratchDirSync(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  moduleTracked.add(dir);
  ensureModuleHook();
  return dir;
}

/**
 * Register an already-created temp dir for module-level cleanup.
 *
 * The exit hook recursively deletes every registered path, so this
 * function refuses (throws, synchronously, at registration time) any
 * path that is not an absolute path strictly under
 * `realpath(os.tmpdir())`. A refused path never enters the tracked
 * set, so the delete loop never touches anything outside TMPDIR.
 *
 * @param {string} dir
 */
export function trackDirForCleanup(dir) {
  assertInsideTmpRoot(dir, 'trackDirForCleanup');
  moduleTracked.add(dir);
  ensureModuleHook();
}

// Test-only internal exports. Not part of the public helper API.
export {
  chmodWritableRecursive as _chmodWritableRecursive,
  removeScratchWithRetry as _removeScratchWithRetry,
  assertInsideTmpRoot as _assertInsideTmpRoot,
  TMP_ROOT_REAL as _TMP_ROOT_REAL,
};

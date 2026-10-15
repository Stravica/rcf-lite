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
import { mkdtempSync, rmSync, chmodSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const moduleTracked = new Set();
let exitHookRegistered = false;

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
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
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

function cleanupSync() {
  for (const dir of moduleTracked) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // A test may have chmod'd a child to r-x; relax perms and retry.
      try {
        chmodWritableRecursive(dir);
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // Best-effort.
      }
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
      await rm(dir, { recursive: true, force: true });
    } catch {
      // Best-effort.
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
 * @param {string} dir
 */
export function trackDirForCleanup(dir) {
  moduleTracked.add(dir);
  ensureModuleHook();
}

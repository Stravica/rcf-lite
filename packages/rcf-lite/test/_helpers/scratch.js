// Shared test helper for WSD-w010 (temp-dir leak fix).
//
// `scratchDir(t, prefix)` mkdtemps a fresh scratch dir and registers
// a `t.after()` that removes it. The non-`t` form `scratchDir(prefix)`
// registers cleanup on a module-level `after` hook instead, for
// mkdtemp calls made from module-scope helpers or outside a test
// context. Both forms return the absolute path, matching `mkdtemp`'s
// contract.
//
// `scratchDirSync(prefix)` is the sync counterpart for callers that
// cannot await (module-scope `const` helpers that spawn child
// processes before the first test runs). It registers removal on a
// module-level `after` hook.
//
// All three forms exist to let a run of the package test suite leave
// `TMPDIR` empty: see `test/_leak/temp-dir-cleanup.test.js`.

import { after } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const moduleTracked = [];
let moduleHookRegistered = false;

function ensureModuleHook() {
  if (moduleHookRegistered) return;
  moduleHookRegistered = true;
  after(async () => {
    while (moduleTracked.length) {
      const dir = moduleTracked.pop();
      try {
        await rm(dir, { recursive: true, force: true });
      } catch {
        // Best-effort: a test that already removed the dir is fine.
      }
    }
  });
}

/**
 * Create a scratch directory under `tmpdir()` and register cleanup.
 *
 * Call with a test context `t` (so cleanup fires per test), or with
 * just a prefix (cleanup fires once at module teardown).
 *
 * @param {import('node:test').TestContext | string} tOrPrefix
 * @param {string} [maybePrefix]
 * @returns {Promise<string>}
 */
export async function scratchDir(tOrPrefix, maybePrefix) {
  if (typeof tOrPrefix === 'string') {
    const dir = await mkdtemp(join(tmpdir(), tOrPrefix));
    moduleTracked.push(dir);
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
 * Sync counterpart of {@link scratchDir}. Cleanup is always done at
 * module teardown; there is no per-test variant.
 *
 * @param {string} prefix
 * @returns {string}
 */
export function scratchDirSync(prefix) {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  moduleTracked.push(dir);
  ensureModuleHook();
  return dir;
}

/**
 * Register an already-created temp dir for module-level cleanup.
 * Useful when the directory came from product code the test can't
 * route through scratchDir.
 *
 * @param {string} dir
 */
export function trackDirForCleanup(dir) {
  moduleTracked.push(dir);
  ensureModuleHook();
}

// Guard test for the temp-dir leak helper's registration-time boundary
// AND delete-time ancestor-symlink-swap recheck.
//
// Registration-time cases (biting the pre-existing assertInsideTmpRoot):
//   * '/' is refused and never enters the tracked set.
//   * $HOME is refused.
//   * A path containing a '..' segment is refused; the referenced
//     directory is intact afterwards.
//   * A symlink escaping the scratch root is refused; its target
//     is intact afterwards.
//
// Delete-time case (biting the finding-1 P1 fix in cleanupSync):
//   * A path registered inside TMP_ROOT_REAL whose ANCESTOR is
//     subsequently swapped for a symlink pointing outside the
//     scratch root must be REFUSED at exit, the outside directory
//     and its contents must stay intact, and stderr must name the
//     refused path.
//
// This file sits in `test/_leak/` so a `--test test/_leak/` filter
// (and the pin's own invocation) picks it up without a separate
// matcher.

import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  symlinkSync,
  rmSync,
} from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { dirname, join, resolve as resolvePath, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { trackDirForCleanup } from '../_helpers/scratch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const HELPER_PATH = resolvePath(HERE, '..', '_helpers', 'scratch.js');

test('registration refuses the filesystem root', () => {
  assert.throws(
    () => trackDirForCleanup('/'),
    /trackDirForCleanup:[\s\S]*(escapes|tmpdir)/i,
  );
  // Root must remain; registration never deletes, but assert anyway.
  assert.ok(existsSync('/'), 'root filesystem must remain');
});

test('registration refuses $HOME', () => {
  const home = process.env.HOME || homedir();
  assert.ok(home && home.length > 0, 'HOME must be set for this test');
  assert.throws(
    () => trackDirForCleanup(home),
    /trackDirForCleanup:[\s\S]*(escapes|tmpdir)/i,
  );
  assert.ok(existsSync(home), 'HOME must remain intact');
});

test("registration refuses a path containing '..'", (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'track-dir-guard-dotdot-'));
  t.after(() => {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      // Best-effort.
    }
  });
  const nested = join(scratch, 'nested');
  mkdirSync(nested);
  const sentinel = join(nested, 'sentinel.txt');
  writeFileSync(sentinel, 'present');
  // path.join normalises '..' away; build a literal path with a '..'
  // segment preserved so the guard's segment check is actually exercised.
  const dotdot = nested + sep + '..' + sep + 'nested';
  assert.throws(
    () => trackDirForCleanup(dotdot),
    /trackDirForCleanup:[\s\S]*'\.\.'/,
  );
  assert.ok(existsSync(sentinel), 'target directory must be intact');
});

test('registration refuses a symlink escaping the scratch root', (t) => {
  const wrapper = mkdtempSync(join(tmpdir(), 'track-dir-guard-sym-'));
  t.after(() => {
    try {
      rmSync(wrapper, { recursive: true, force: true });
    } catch {
      // Best-effort.
    }
  });
  // Point the symlink at '/' so its realpath cannot possibly sit
  // inside TMP_ROOT_REAL on any supported platform.
  const link = join(wrapper, 'escaping-link');
  symlinkSync('/', link);
  assert.throws(
    () => trackDirForCleanup(link),
    /trackDirForCleanup:[\s\S]*(escapes|tmpdir)/i,
  );
  assert.ok(existsSync('/'), 'symlink target (root) must remain');
});

test(
  'delete-time recheck refuses an ancestor symlink swap, outside dir intact, stderr names the path',
  (t) => {
    // Wrapper under the real OS tmpdir. We put BOTH the child's TMPDIR
    // (scratchRoot) and the "outside" directory inside this wrapper so
    // cleanup is portable; the child sees scratchRoot as TMP_ROOT_REAL
    // and anything outside scratchRoot (e.g. the sibling `outside`
    // directory) is correctly outside the child's TMP_ROOT_REAL.
    const wrapper = mkdtempSync(join(tmpdir(), 'track-dir-guard-delete-'));
    t.after(() => {
      try {
        rmSync(wrapper, { recursive: true, force: true });
      } catch {
        // Best-effort.
      }
    });

    const scratchRoot = join(wrapper, 'scratch-root');
    mkdirSync(scratchRoot);
    const outside = join(wrapper, 'outside');
    mkdirSync(outside);
    const outsideChild = join(outside, 'child');
    mkdirSync(outsideChild);
    const precious = join(outsideChild, 'precious.txt');
    writeFileSync(precious, 'do-not-delete');

    // Child script: register a legitimate inside-the-root path, then
    // swap its ANCESTOR for a symlink to the outside dir. Normal
    // process exit fires the helper's exit hook; the delete-time
    // recheck must refuse the deletion.
    const script = [
      `import { trackDirForCleanup } from ${JSON.stringify(HELPER_PATH)};`,
      "import { mkdirSync, renameSync, symlinkSync } from 'node:fs';",
      "import { join } from 'node:path';",
      'const scratchRoot = process.env.TMPDIR;',
      "const parent = join(scratchRoot, 'parent');",
      "const child = join(parent, 'child');",
      'mkdirSync(parent);',
      'mkdirSync(child);',
      'trackDirForCleanup(child);',
      "const parentMoved = join(scratchRoot, 'parent-moved');",
      'renameSync(parent, parentMoved);',
      `symlinkSync(${JSON.stringify(outside)}, parent);`,
      '// Normal exit from here fires process.on("exit", cleanupSync).',
    ].join('\n');

    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      {
        env: { ...process.env, TMPDIR: scratchRoot },
        encoding: 'utf8',
      },
    );

    assert.equal(
      result.status,
      0,
      `child exit code: ${result.status}; stderr: ${result.stderr}`,
    );
    // Outside tree must be intact.
    assert.ok(
      existsSync(outsideChild),
      'outside/child directory must survive the exit hook',
    );
    assert.ok(
      existsSync(precious),
      'outside/child/precious.txt must survive the exit hook',
    );
    assert.equal(readFileSync(precious, 'utf8'), 'do-not-delete');
    // Stderr must name the refusal and the refused path.
    assert.match(
      result.stderr,
      /scratch helper: refusing delete/i,
      `stderr must announce the refusal, got: ${result.stderr}`,
    );
    const expectedRegisteredPath = join(scratchRoot, 'parent', 'child');
    assert.ok(
      result.stderr.includes(expectedRegisteredPath),
      `stderr must name the refused path ${expectedRegisteredPath}, got: ${result.stderr}`,
    );
  },
);

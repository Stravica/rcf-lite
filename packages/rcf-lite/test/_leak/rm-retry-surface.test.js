// Finding 5 biting test: a scratch dir with a 0500 subtree must be
// cleaned up via a one-shot chmod retry, and any failure beyond
// the retry must be surfaced to stderr (never swallowed). Before
// the fix the per-test `t.after` dropped the EACCES silently and
// the scratch leaked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _removeScratchWithRetry } from '../_helpers/scratch.js';

test('_removeScratchWithRetry removes a scratch dir even when a child subtree is chmod 0500', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'rm-retry-'));
  await mkdir(join(scratch, 'locked'), { recursive: true });
  await writeFile(join(scratch, 'locked', 'file.txt'), 'data', 'utf8');
  // Drop write bit so a naive `rm` can fail on some platforms.
  await chmod(join(scratch, 'locked', 'file.txt'), 0o400);
  await chmod(join(scratch, 'locked'), 0o500);

  // Must not throw. On platforms where rm succeeds immediately
  // (macOS lets the owner remove entries from an r-x dir) the
  // retry path is unexercised; on platforms where the first rm
  // fails with EACCES the retry chmods and succeeds.
  await _removeScratchWithRetry(scratch);
  await assert.rejects(() => stat(scratch), /ENOENT/, 'scratch dir is gone');
});

test('_removeScratchWithRetry surfaces failure to stderr and rethrows when retry still fails', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'rm-surface-'));
  const captured = [];
  // Inject a failing rmFn so we can exercise the surfacing branch
  // without needing a filesystem that rejects every rm attempt.
  const brokenRm = async () => {
    const err = new Error('simulated unremovable scratch');
    err.code = 'EACCES';
    throw err;
  };
  const noopChmod = () => {}; // the retry chmod is a no-op in this fixture

  await assert.rejects(
    _removeScratchWithRetry(scratch, {
      rmFn: brokenRm,
      chmodFn: noopChmod,
      onStderr: (s) => captured.push(s),
    }),
    /simulated unremovable scratch|EACCES/,
  );
  const joined = captured.join('');
  assert.match(
    joined,
    /scratch helper: cleanup failed at/,
    'stderr carries the surfacing line',
  );
  assert.ok(
    joined.includes(scratch),
    `stderr includes the scratch path (got: ${joined.slice(0, 200)})`,
  );

  // Real cleanup for the test's fixture.
  await rm(scratch, { recursive: true, force: true });
});

test('_removeScratchWithRetry surfaces non-EACCES errors as well (never silently swallow)', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'rm-surface-other-'));
  const captured = [];
  const brokenRm = async () => {
    const err = new Error('simulated EBUSY');
    err.code = 'EBUSY';
    throw err;
  };
  await assert.rejects(
    _removeScratchWithRetry(scratch, {
      rmFn: brokenRm,
      onStderr: (s) => captured.push(s),
    }),
    /EBUSY/,
  );
  assert.match(
    captured.join(''),
    /scratch helper: cleanup failed at.*EBUSY/,
    'non-EACCES failure is surfaced, not swallowed',
  );
  await rm(scratch, { recursive: true, force: true });
});

// Finding 2 biting test: the recursive-permission restore must not
// follow symlinks. Before the fix, chmodSync on a symlink inside
// a scratch dir followed the link and changed the mode of its
// target, which could be a read-only file outside the scratch
// root. The fix skips symbolic links entirely.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, symlink, rm, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { _chmodWritableRecursive } from '../_helpers/scratch.js';

test('chmodWritableRecursive skips symlinks and leaves the target file mode unchanged', async () => {
  // Create a read-only "outside" file that the symlink will point at.
  const outside = await mkdtemp(join(tmpdir(), 'outside-target-'));
  const outsideFile = join(outside, 'readonly-target.txt');
  await writeFile(outsideFile, 'important', 'utf8');
  await chmod(outsideFile, 0o400);
  const beforeMode = (await stat(outsideFile)).mode & 0o777;
  assert.equal(beforeMode, 0o400, 'precondition: outside file is 0400');

  // Create a scratch dir containing (a) a symlink pointing at the
  // outside file and (b) a regular file so the restore has at
  // least one non-symlink entry to chmod.
  const scratch = await mkdtemp(join(tmpdir(), 'scratch-with-link-'));
  await symlink(outsideFile, join(scratch, 'link-to-outside'));
  const plainFile = join(scratch, 'ordinary.txt');
  await writeFile(plainFile, 'ok', 'utf8');
  await chmod(plainFile, 0o400);

  // Run the restore. The symlink entry must be skipped.
  _chmodWritableRecursive(scratch);

  // The outside file's mode must be unchanged.
  const afterMode = (await stat(outsideFile)).mode & 0o777;
  assert.equal(
    afterMode,
    0o400,
    `outside target mode must be unchanged (was ${beforeMode.toString(8)}, now ${afterMode.toString(8)})`,
  );

  // Sanity: the ordinary (non-symlink) file inside the scratch was
  // chmodded, so permission restore still works where it should.
  const plainAfter = (await stat(plainFile)).mode & 0o777;
  assert.equal(plainAfter, 0o600, 'ordinary file inside scratch was chmodded');

  // Cleanup. Restore outside write bit so rm succeeds.
  await chmod(outsideFile, 0o600);
  await rm(outside, { recursive: true, force: true });
  await rm(scratch, { recursive: true, force: true });
});

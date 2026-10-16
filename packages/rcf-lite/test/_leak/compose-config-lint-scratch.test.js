// Finding 4 biting test: the compose-config-lint probe's scratch
// directory must be unique per concurrent invocation. The old code
// used `${Date.now()}` as the suffix, so two invocations in the
// same millisecond shared a directory and either one's `finally`
// `rm -rf` could delete the shared dir while the other was still
// using it. The fix routes through mkdtemp (atomic, unique).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, rm, stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import { makeComposeConfigLintScratch } from '../../../../blueprints/platform-docker-compose-host/contributions/probes/compose-config-lint.mjs';

test('makeComposeConfigLintScratch assigns distinct dirs under concurrency and all can be cleaned up', async () => {
  const paths = await Promise.all(
    Array.from({ length: 8 }, () => makeComposeConfigLintScratch()),
  );
  try {
    // Each returned path is distinct.
    const unique = new Set(paths);
    assert.equal(
      unique.size,
      paths.length,
      'each concurrent call must return a distinct path',
    );

    // Each path exists, is a directory, is empty, lives under the
    // same parent, and carries the expected prefix.
    const parents = new Set();
    for (const p of paths) {
      const s = await stat(p);
      assert.ok(s.isDirectory(), `${p} is a directory`);
      const entries = await readdir(p);
      assert.deepEqual(entries, [], `${p} starts empty`);
      parents.add(dirname(p));
      assert.ok(
        basename(p).startsWith('rcf-lite-t2-compose-config-lint-'),
        `basename of ${p} carries the expected prefix`,
      );
    }
    assert.equal(parents.size, 1, 'all scratch dirs share one parent (tmpdir)');
  } finally {
    // Each dir cleans up independently.
    for (const p of paths) {
      await rm(p, { recursive: true, force: true });
    }
  }
  // Verify cleanup actually removed them.
  for (const p of paths) {
    await assert.rejects(() => stat(p), /ENOENT/);
  }
});

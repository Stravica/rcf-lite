// The configurable gh fake (test/feedback/gh-fakes/gh-fake-configurable.mjs,
// RCF_FEEDBACK_GH_MODULE) with one addition for the FBS-231 round 7 tests:
// when RCF_TEST_GH_HOLD=1, the first ghIssueCreate of the process returns
// the fake's own result only after the fixture lets it go. The fake records
// the call and its result first, then writes paused-<id>-filed into
// RCF_TEST_PAUSE_DIR (the issue is filed: the external side effect has
// happened) and holds until release-<id>-filed exists. A hold that runs out
// (8 seconds) writes timeout-<id>-filed and exits 97. No network, ever.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { ghIssueCreate as create } from '../feedback/gh-fakes/gh-fake-configurable.mjs';

export * from '../feedback/gh-fakes/gh-fake-configurable.mjs';

const cell = new Int32Array(new SharedArrayBuffer(4));
let held = false;

export async function ghIssueCreate(opts) {
  const out = await create(opts);
  const dir = process.env.RCF_TEST_PAUSE_DIR;
  if (process.env.RCF_TEST_GH_HOLD === '1' && dir && !held) {
    held = true;
    const id = process.env.RCF_TEST_PAUSE_ID ?? String(process.pid);
    writeFileSync(join(dir, `paused-${id}-filed`), JSON.stringify({ url: out?.value?.url ?? null, title: opts?.title ?? null }));
    const start = performance.now();
    while (!existsSync(join(dir, `release-${id}-filed`))) {
      if (performance.now() - start > 8000) {
        writeFileSync(join(dir, `timeout-${id}-filed`), String(process.pid));
        process.exit(97);
      }
      Atomics.wait(cell, 0, 0, 2);
    }
  }
  return out;
}

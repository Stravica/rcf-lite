#!/usr/bin/env node
// Detached view-supervisor child entry point (spec §9.3).
//
// Spawned by `rcf view start --detach`; the parent CLI process
// invokes `child_process.spawn` on this file with `detached: true` and
// unrefs. The child reads its config from env vars set by the parent,
// then hands off to the supervisor loop.

import { runDetachedChild } from '../src/view-supervisor/index.js';

runDetachedChild().catch((err) => {
  process.stderr.write(`[view-supervisor-child] unexpected failure: ${err.message}\n${err.stack}\n`);
  process.exit(1);
});

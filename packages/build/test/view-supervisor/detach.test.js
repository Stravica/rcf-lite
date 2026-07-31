// Track C+D §9.3 supervisor integration test.
//
// Spawns a real detached supervisor against an ephemeral port, asserts
// that it comes up, that the manifest carries reviewSurface.viewServer
// with our pid, and that stop cleanly unwinds. Uses port 0 -> the
// server picks; asks for a short heartbeat so the status check is fast.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  startDetached,
  stopDetached,
  statusOfDetached,
} from '../../src/view-supervisor/supervisor.js';

async function scaffoldTree(dir) {
  await mkdir(join(dir, 'rcf'), { recursive: true });
  const seed = {
    version: '2.0.0',
    projectName: 'view-supervisor-detach-test',
    prd: { id: 'PRD-001', path: 'rcf/prd.json' },
    tad: { id: 'TAD-001', path: 'rcf/tad.json' },
    bs: { id: 'BS-001', path: 'rcf/build-sequence.json' },
  };
  await writeFile(join(dir, 'rcf', 'manifest.json'), JSON.stringify(seed, null, 2));
}

test('rcf view start --detach survives its parent CLI exit and stop cleanly tears down', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-view-detach-'));
  await scaffoldTree(dir);
  try {
    const started = await startDetached({
      projectRoot: dir,
      port: 0,
      heartbeatMs: 500,
      startupTimeoutMs: 8000,
    });
    assert.ok(started.pid > 0, 'supervisor pid must be positive');
    assert.match(started.url, /^http:\/\/127\.0\.0\.1:\d+$/);

    const status = await statusOfDetached(dir, { heartbeatMs: 500 });
    assert.equal(status.state, 'running');
    assert.equal(status.pid, started.pid);
    assert.equal(status.record.mode, 'detached');
    assert.ok(status.record.healthCheckPath.endsWith('/healthz'));

    const stopped = await stopDetached(dir);
    assert.equal(stopped.stopped, true);
    assert.equal(stopped.pid, started.pid);

    const after = await statusOfDetached(dir, { heartbeatMs: 500 });
    assert.equal(after.state, 'not-started');
  } finally {
    await rm(dir, { recursive: true });
  }
});

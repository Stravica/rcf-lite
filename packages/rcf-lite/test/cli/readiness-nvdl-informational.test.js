// 0.30.0 PR 8 (US-17902; REQ-179 / AC-17902-4).
//
// NV-DL-ADM-01 refuses on an unfrozen tree, but the readiness compute
// still runs and prints its diagnostics (ADR-4123: refusal is
// informational on the compute). This test pins that the exit code
// and output shape are unchanged from the 0.29.0 informational
// posture on the compute itself; the admissibility wrap surfaces
// through separate verbs (bundle --next in PR 8).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { initProject } from '#core/store/init.js';
import { main as readinessMain } from '../../src/cli/readiness.js';

function makeSink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  Object.defineProperty(stream, 'text', { get() { return Buffer.concat(chunks).toString('utf8'); } });
  return stream;
}

async function scaffold() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-pr8-readiness-info-'));
  const result = await initProject({ projectRoot: root });
  assert.ok(result && Array.isArray(result.created));
  return root;
}

test('readiness compute (PR 8, AC-17902-4): still runs and prints under NV-DL refusal', async () => {
  const projectRoot = await scaffold();
  const stdout = makeSink();
  const stderr = makeSink();
  const code = await readinessMain([], { stdout, stderr, cwd: projectRoot });
  // 0.29.0 informational posture: exit 0 with the compute's output.
  assert.equal(code, 0, `expected readiness to exit 0 on an unfrozen tree; stderr=${stderr.text}`);
  assert.ok(stdout.text.length > 0, 'readiness must print the compute envelope');
});

test('readiness --json (PR 8, AC-17902-4): JSON envelope still emits under NV-DL refusal', async () => {
  const projectRoot = await scaffold();
  const stdout = makeSink();
  const stderr = makeSink();
  const code = await readinessMain(['--json'], { stdout, stderr, cwd: projectRoot });
  assert.equal(code, 0);
  const body = JSON.parse(stdout.text);
  // The envelope keeps the 0.29.0 shape: delta, stages, tree info.
  assert.ok('delta' in body);
  assert.ok('stages' in body);
});

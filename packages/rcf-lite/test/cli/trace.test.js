// `rcf trace <id>` bin-invocation tests. Spec §4.5.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '@stravica-ai/rcf-lite-core/store/init.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(cwd, args = []) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function scaffold() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-trace-cli-'));
  await initProject({ projectRoot: tmp, projectName: 'TraceTest' });
  return tmp;
}

test('rcf trace REQ-001 --forward walks REQ -> US -> AC', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['trace', 'REQ-001', '--forward', '--format', 'json']);
  assert.equal(code, 0);
  const body = JSON.parse(stdout);
  const ids = body.nodes.map((n) => n.id);
  assert.ok(ids.includes('US-101'));
  assert.ok(ids.includes('AC-101-1'));
});

test('rcf trace AC-101-1 --back walks AC -> US -> REQ -> PRD', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['trace', 'AC-101-1', '--back', '--format', 'json']);
  assert.equal(code, 0);
  const body = JSON.parse(stdout);
  const ids = body.nodes.map((n) => n.id);
  assert.deepEqual(ids, ['AC-101-1', 'US-101', 'REQ-001', 'PRD-001']);
});

test('rcf trace US-101 --both emits ancestors + descendants around the pivot', async () => {
  const tmp = await scaffold();
  const { code, stdout } = await runBin(tmp, ['trace', 'US-101', '--both', '--format', 'json']);
  assert.equal(code, 0);
  const body = JSON.parse(stdout);
  assert.equal(body.pivot, 'US-101');
  assert.equal(body.direction, 'both');
  const ancIds = body.ancestors.map((n) => n.id);
  const descIds = body.descendants.map((n) => n.id);
  assert.ok(ancIds.includes('REQ-001'));
  assert.ok(descIds.includes('AC-101-1'));
});

test('rcf trace REQ-999 (unknown id) exits 2', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['trace', 'REQ-999']);
  assert.equal(code, 2);
  assert.match(stderr, /not found/);
});

test('rcf trace REQ-001 --forward --back exits 2 (mutually exclusive)', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['trace', 'REQ-001', '--forward', '--back']);
  assert.equal(code, 2);
  assert.match(stderr, /mutually exclusive/);
});

test('rcf trace with no positional exits 2', async () => {
  const tmp = await scaffold();
  const { code, stderr } = await runBin(tmp, ['trace']);
  assert.equal(code, 2);
  assert.match(stderr, /expected exactly one/);
});

// Issue 310 regression: `rcf discover req-baseline opt-out --dry-run`
// must leave the manifest untouched. On 0.31.0 the flag was accepted
// but the opt-out was still appended to manifest.baselineAcOptOuts
// and the manifest was rewritten.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { initProject } from '#core/store/init.js';
import { main } from '../../src/cli/req-baseline.js';

function makeSink() {
  const chunks = [];
  const stream = new Writable({
    write(chunk, _enc, cb) { chunks.push(chunk); cb(); },
  });
  Object.defineProperty(stream, 'text', { get() { return Buffer.concat(chunks).toString('utf8'); } });
  return stream;
}

async function scratchProject(prefix = 'req-baseline-opt-out-dry-run-') {
  const root = await mkdtemp(join(tmpdir(), prefix));
  const result = await initProject({ projectRoot: root });
  assert.ok(result && Array.isArray(result.created), `initProject failed: ${JSON.stringify(result)}`);
  return root;
}

async function run(argv, cwd) {
  const stdout = makeSink();
  const stderr = makeSink();
  const code = await main(argv, { stdout, stderr, cwd });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

async function readManifest(cwd) {
  const abs = join(cwd, 'rcf', 'manifest.json');
  return readFile(abs);
}

test('req-baseline opt-out --dry-run leaves manifest.json byte-equal (issue 310)', async () => {
  const cwd = await scratchProject();
  const before = await readManifest(cwd);
  const r = await run([
    'opt-out',
    '--req', 'REQ-004',
    '--key', 'defineD4:failure',
    '--reason', 'rehearsal only; viewer clone test',
    '--dry-run',
  ], cwd);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /\[dry-run\] would opt-out REQ-004 defineD4:failure \(scope=req\)/);
  const after = await readManifest(cwd);
  assert.equal(after.toString('utf8'), before.toString('utf8'), 'manifest.json bytes must not change on --dry-run');
});

test('req-baseline opt-out --dry-run --json emits dryRun:true (issue 310)', async () => {
  const cwd = await scratchProject();
  const before = await readManifest(cwd);
  const r = await run([
    'opt-out',
    '--req', 'REQ-004',
    '--key', 'defineD4:failure',
    '--reason', 'rehearsal only; viewer clone test',
    '--dry-run',
    '--json',
  ], cwd);
  assert.equal(r.code, 0, r.stderr);
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.reqId, 'REQ-004');
  assert.equal(payload.baselineKey, 'defineD4:failure');
  assert.equal(payload.scope, 'req');
  const after = await readManifest(cwd);
  assert.equal(after.toString('utf8'), before.toString('utf8'), 'manifest.json bytes must not change on --dry-run');
});

test('req-baseline opt-out --dry-run does NOT create rcf/define/ (issue 310)', async () => {
  const cwd = await scratchProject();
  // Record whether rcf/define/ exists before the dry-run; it may be
  // created by initProject already. The regression here is about the
  // opt-out path not creating any new file.
  const defineBefore = await stat(join(cwd, 'rcf', 'define')).then(() => true, () => false);
  await run([
    'opt-out',
    '--req', 'REQ-004',
    '--key', 'defineD4:failure',
    '--reason', 'rehearsal only; viewer clone test',
    '--dry-run',
  ], cwd);
  const defineAfter = await stat(join(cwd, 'rcf', 'define')).then(() => true, () => false);
  assert.equal(defineAfter, defineBefore, 'rcf/define/ existence must not flip on --dry-run');
});

test('req-baseline opt-out WITHOUT --dry-run still writes (positive control, issue 310)', async () => {
  const cwd = await scratchProject();
  const before = await readManifest(cwd);
  const r = await run([
    'opt-out',
    '--req', 'REQ-004',
    '--key', 'defineD4:failure',
    '--reason', 'real opt-out, keep this record for audit',
  ], cwd);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /opt-out boo-\d{4}-\d{2}-\d{2}-\d{3} recorded for REQ-004/);
  const after = await readManifest(cwd);
  assert.notEqual(after.toString('utf8'), before.toString('utf8'), 'manifest.json must change when --dry-run is not passed');
  const next = JSON.parse(after.toString('utf8'));
  assert.ok(Array.isArray(next.baselineAcOptOuts), 'baselineAcOptOuts must be an array');
  assert.equal(next.baselineAcOptOuts.length, 1, 'exactly one opt-out written');
  assert.equal(next.baselineAcOptOuts[0].reqId, 'REQ-004');
  assert.equal(next.baselineAcOptOuts[0].baselineKey, 'defineD4:failure');
});

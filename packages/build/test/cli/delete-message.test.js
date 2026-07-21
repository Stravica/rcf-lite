// Regression tests for BUG-005 (delete uses conditional/future tense on
// an operation that DID execute — "Would delete N file(s)" for a real
// delete) and BUG-006 (plan output prints `rcf/.../{id}.json` placeholder
// path instead of the real subdirectory).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '../../src/store/init.js';

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

async function scaffoldWithReq() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-delete-msg-'));
  await initProject({ projectRoot: tmp, projectName: 'DeleteMsg' });
  const r = await runBin(tmp, ['create', 'req', '--parent', 'PRD-001', '--title', 'To Delete']);
  assert.equal(r.code, 0);
  return tmp;
}

test('BUG-005: rcf delete (no --dry-run) uses past-tense header', async () => {
  const tmp = await scaffoldWithReq();
  const { code, stdout } = await runBin(tmp, ['delete', 'REQ-002']);
  assert.equal(code, 0);
  assert.match(stdout, /^Deleted 1 file\(s\), mutated 0 doc\(s\)\./m,
    `expected past-tense "Deleted …", got: ${JSON.stringify(stdout)}`);
  assert.doesNotMatch(stdout, /^Would delete/,
    'must NOT start with "Would delete" on an executed operation');
});

test('BUG-005: rcf delete --dry-run uses future-tense header with (dry-run) marker', async () => {
  const tmp = await scaffoldWithReq();
  const { code, stdout } = await runBin(tmp, ['delete', 'REQ-002', '--dry-run']);
  assert.equal(code, 0);
  assert.match(stdout, /^Would delete 1 file\(s\) and mutate 0 doc\(s\)\. \(dry-run\)/m);
});

test('BUG-006: rcf delete plan line resolves the real subdirectory (no `rcf/.../` placeholder)', async () => {
  const tmp = await scaffoldWithReq();
  const { code, stdout } = await runBin(tmp, ['delete', 'REQ-002', '--dry-run']);
  assert.equal(code, 0);
  assert.doesNotMatch(stdout, /rcf\/\.\.\.\//,
    `plan line must not contain the "rcf/.../" placeholder, got: ${JSON.stringify(stdout)}`);
  assert.match(stdout, /delete rcf\/requirements\/req-002\.json/,
    `expected real subdirectory path, got: ${JSON.stringify(stdout)}`);
});

test('BUG-006: rcf delete US --cascade plan resolves REQ + US subdirectories', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-delete-msg-cascade-'));
  await initProject({ projectRoot: tmp, projectName: 'DeleteMsgCascade' });
  // Add a REQ and a child US so cascade prints multiple deleted paths.
  await runBin(tmp, ['create', 'req', '--parent', 'PRD-001', '--title', 'R']);
  await runBin(tmp, ['create', 'us', '--parent', 'REQ-002', '--title', 'U']);
  const { code, stdout } = await runBin(tmp, ['delete', 'REQ-002', '--cascade', '--dry-run']);
  assert.equal(code, 0);
  assert.doesNotMatch(stdout, /rcf\/\.\.\.\//);
  assert.match(stdout, /delete rcf\/requirements\/req-002\.json/);
  assert.match(stdout, /delete rcf\/user-stories\/us-201\.json/);
});

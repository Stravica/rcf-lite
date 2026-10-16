// Code-hygiene unit test (FBS-218, bound to no criterion): `rcf verify run
// --parity-env` takes an environment name, so the argument vector finalise
// builds must carry a value after the flag and parse under verify's spec.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FINALISE_PARITY_ENV, buildVerifyArgs } from '../../src/finalise/spawn.js';
import { main as verifyRun } from '../../src/verify/cli/run.js';

function capture() {
  return { data: '', write(chunk) { this.data += chunk; return true; } };
}

test('buildVerifyArgs forwards --parity-env with the finalise environment name', () => {
  const args = buildVerifyArgs({
    repo: '/p', url: 'https://a', profile: 'ci', out: '/r.json', severityGate: 'BROKEN',
    parityEnv: true, provision: '/creds.json',
  });
  const at = args.indexOf('--parity-env');
  assert.ok(at >= 0);
  assert.equal(args[at + 1], FINALISE_PARITY_ENV);
  assert.equal(args[at + 2], '--provision', 'the next flag is not swallowed as the value');
});

test('verify run parses the finalise argument vector with --parity-env (no usage error)', async () => {
  const args = buildVerifyArgs({
    repo: '/nonexistent-rcf-repo', url: 'https://a', profile: 'ci', out: '/r.json', severityGate: 'BROKEN', parityEnv: true,
  }).slice(2);
  const stderr = capture();
  const code = await verifyRun([...args, '--provision-mode', 'skip'], { stdout: capture(), stderr, cwd: '/' });
  assert.doesNotMatch(stderr.data, /\[error\] usage/, 'the argument vector parses; the run fails later on the missing chain');
  assert.notEqual(code, 0);
});

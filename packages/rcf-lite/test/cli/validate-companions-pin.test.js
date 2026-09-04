// End-to-end test for `rcf define validate` refusing exit 3 when
// rcf/companions.json pins a role to an unresolvable provider
// (core-companions spec section 5).
//
// Covers TS-043 TC-043-validate-refuses-unresolvable-pin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '#core/store';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(cwd, args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('validate refuses exit 3 when a companions.json pin names an unresolvable provider (TC-043-validate-refuses-unresolvable-pin)', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-validate-pin-'));
  const init = await initProject({ projectRoot: root, projectName: 'validate-pin' });
  assert.equal(init.kind, undefined);
  await writeFile(join(root, 'rcf', 'companions.json'), JSON.stringify({
    schemaVersion: 1,
    roles: { logging: { provider: 'nope:nope', pinnedAt: '2026-09-04T00:00:00Z' } },
  }, null, 2) + '\n');
  const { code, stderr } = await runBin(root, ['define', 'validate', '--no-code']);
  assert.equal(code, 3, stderr);
  assert.match(stderr, /rcf\/companions\.json pins role 'logging' to 'nope:nope' but no such provider is applied, registered or on the shelf\./);
});

test('validate is clean when companions.json is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rcf-validate-pin-absent-'));
  await initProject({ projectRoot: root, projectName: 'no-pin-file' });
  const { code, stdout } = await runBin(root, ['define', 'validate', '--no-code']);
  assert.equal(code, 0, stdout);
});

// AC-4.1, AC-4.2 — init seeds rcf/.identity/profile.md and is
// idempotent against operator edits.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { IDENTITY_TEMPLATE } from '../../src/setup/identity-seed.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBinInit(cwd) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, 'init', '--project-name', 'IdTest', '--non-interactive'], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('AC-4.1: rcf init creates rcf/.identity/profile.md with the canonical template', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-id-'));
  const { code } = await runBinInit(tmp);
  assert.equal(code, 0);
  const profile = await readFile(join(tmp, 'rcf', '.identity', 'profile.md'), 'utf8');
  assert.equal(profile, IDENTITY_TEMPLATE);
});

test('AC-4.2: init re-run leaves an operator-owned profile.md byte-identical', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-id-re-'));
  await runBinInit(tmp);
  const custom = '# my profile\n\nBaz. Direct, casual, no filler.\n';
  await writeFile(join(tmp, 'rcf', '.identity', 'profile.md'), custom, 'utf8');
  const { code } = await runBinInit(tmp);
  assert.equal(code, 0);
  const after = await readFile(join(tmp, 'rcf', '.identity', 'profile.md'), 'utf8');
  assert.equal(after, custom);
});

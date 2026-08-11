// End-to-end sequence: fresh-init -> doctor (clean) -> operator-edit
// (stale) -> doctor (drift) -> --fix -> doctor (clean). Integration
// coverage of the full doctor loop per §10.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

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

test('e2e: init -> doctor clean -> stale -> doctor 3 -> --fix -> doctor clean', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-doc-e2e-'));
  const init = await runBin(tmp, ['init', '--project-name', 'E2E', '--non-interactive']);
  assert.equal(init.code, 0);

  const clean1 = await runBin(tmp, ['doctor']);
  assert.equal(clean1.code, 0, `expected clean, got: ${clean1.stdout}`);

  const claude = await readFile(join(tmp, 'CLAUDE.md'), 'utf8');
  await writeFile(join(tmp, 'CLAUDE.md'), claude.replace('### RULE 1:', '### R1:'), 'utf8');
  const drift = await runBin(tmp, ['doctor']);
  assert.equal(drift.code, 3);
  assert.match(drift.stdout, /stale-hash/);

  const fix = await runBin(tmp, ['doctor', '--fix']);
  assert.equal(fix.code, 0, fix.stdout);

  const clean2 = await runBin(tmp, ['doctor']);
  assert.equal(clean2.code, 0);
});

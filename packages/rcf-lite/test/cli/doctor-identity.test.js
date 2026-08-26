// AC-4.3..AC-4.7 — identity check semantics for `rcf doctor` (§5.5)
// and the git-ignore-effective check (AC-4.3 via real `git check-ignore`).
// Warn-only, no --fix; the profile is entirely operator-owned after seed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
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

async function runGit(cwd, args) {
  try {
    const { stdout } = await exec('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    return { code: 0, stdout };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '' };
  }
}

async function freshInit(prefix = 'rcf-doc-id-') {
  const tmp = await mkdtemp(join(tmpdir(), prefix));
  const { code } = await runBin(tmp, ['init', '--project-name', 'IdTest', '--non-interactive']);
  assert.equal(code, 0);
  return tmp;
}

test('AC-4.3: after rcf init, git check-ignore rcf/.identity/profile.md exits 0 (path is ignored)', async () => {
  const tmp = await freshInit('rcf-doc-id-gitcheck-');
  // Requires a real git repo.
  const initResult = await runGit(tmp, ['init', '--quiet']);
  assert.equal(initResult.code, 0);
  const check = await runGit(tmp, ['check-ignore', 'rcf/.identity/profile.md']);
  assert.equal(check.code, 0, 'git check-ignore should exit 0 (ignored)');
});

test('AC-4.4a: doctor --check identity on a fresh init exits 0 (present + ignored)', async () => {
  const tmp = await freshInit('rcf-doc-id-clean-');
  const { code, stdout } = await runBin(tmp, ['doctor', '--check', 'identity']);
  assert.equal(code, 0, stdout);
});

test('AC-4.4b: doctor --check identity on a repo with profile.md deleted reports missing-file and exits 3', async () => {
  const tmp = await freshInit('rcf-doc-id-missing-');
  await unlink(join(tmp, 'rcf', '.identity', 'profile.md'));
  const { code, stdout } = await runBin(tmp, ['doctor', '--check', 'identity']);
  assert.equal(code, 3, stdout);
  assert.match(stdout, /missing-file/);
});

test('AC-4.4b: doctor --check identity reports gitignore-mismatch when rcf/.identity/ is unignored', async () => {
  const tmp = await freshInit('rcf-doc-id-unignored-');
  // Remove the managed block from .gitignore.
  await writeFile(join(tmp, '.gitignore'), '# operator only\n', 'utf8');
  const { code, stdout } = await runBin(tmp, ['doctor', '--check', 'identity']);
  assert.equal(code, 3, stdout);
  assert.match(stdout, /gitignore-mismatch/);
});

test('AC-4.5: doctor --fix --check identity writes nothing (warn-only)', async () => {
  const tmp = await freshInit('rcf-doc-id-nofix-');
  await unlink(join(tmp, 'rcf', '.identity', 'profile.md'));
  const { code } = await runBin(tmp, ['doctor', '--fix', '--check', 'identity']);
  assert.equal(code, 3);
  const stillMissing = await readFile(join(tmp, 'rcf', '.identity', 'profile.md'), 'utf8').catch(() => null);
  assert.equal(stillMissing, null, '--fix must not re-seed profile.md');
});

test('AC-4.6: rcf validate does not descend into rcf/.identity/', async () => {
  const tmp = await freshInit('rcf-doc-id-walker-');
  await writeFile(join(tmp, 'rcf', '.identity', 'junk.json'), '{not valid json', 'utf8');
  const { code, stderr } = await runBin(tmp, ['define', 'validate']);
  assert.equal(code, 0, `validate exited ${code}: ${stderr}`);
});

test('AC-4.7: canonical profile.md template has no em-dash and no denylisted American-English forms', async () => {
  const tmp = await freshInit('rcf-doc-id-lint-');
  const profile = await readFile(join(tmp, 'rcf', '.identity', 'profile.md'), 'utf8');
  assert.equal(/—/.test(profile), false, 'em-dash in profile template');
  const deny = /\b(behavior|behaviors|behavioral|organization|organizations|organize|organized|realize|realized|analyze|analyzed|customize|customizing|color|colors|favor|favors|centered|labeled|traveled|catalog|dialog)\b/i;
  assert.equal(deny.test(profile), false, 'American-English form in profile template');
});

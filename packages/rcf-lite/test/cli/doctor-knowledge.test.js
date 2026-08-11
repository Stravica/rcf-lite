// AC-2.4..AC-2.6 — knowledge check semantics for `rcf doctor` (§3.5).
// Directory-shape only: missing-directory / missing-subdir. --fix is
// refused in v1; the operator re-runs `rcf init` (which now seeds
// knowledge) or creates the directory by hand.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
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

async function freshInit(prefix = 'rcf-doc-kn-') {
  const tmp = await mkdtemp(join(tmpdir(), prefix));
  const { code } = await runBin(tmp, ['init', '--project-name', 'KnTest', '--non-interactive']);
  assert.equal(code, 0);
  return tmp;
}

test('AC-2.4: doctor on a repo missing rcf/knowledge/ reports missing-directory and exits 3', async () => {
  const tmp = await freshInit();
  await rm(join(tmp, 'rcf', 'knowledge'), { recursive: true, force: true });
  const { code, stdout } = await runBin(tmp, ['doctor', '--check', 'knowledge']);
  assert.equal(code, 3, stdout);
  assert.match(stdout, /missing-directory/);
});

test('AC-2.5: doctor on a repo with knowledge/ but no notes/ reports missing-subdir', async () => {
  const tmp = await freshInit();
  await rm(join(tmp, 'rcf', 'knowledge', 'notes'), { recursive: true, force: true });
  const { code, stdout } = await runBin(tmp, ['doctor', '--check', 'knowledge']);
  assert.equal(code, 3, stdout);
  assert.match(stdout, /missing-subdir/);
});

test('AC-2.6: doctor --fix --check knowledge refuses to create the directory (v1: routes through rcf init)', async () => {
  const tmp = await freshInit();
  await rm(join(tmp, 'rcf', 'knowledge'), { recursive: true, force: true });
  const { code, stdout } = await runBin(tmp, ['doctor', '--fix', '--check', 'knowledge']);
  // Refused: exit 3, no directory created.
  assert.equal(code, 3, stdout);
  const stillMissing = await readFile(join(tmp, 'rcf', 'knowledge', 'README.md'), 'utf8').catch(() => null);
  assert.equal(stillMissing, null, 'README.md was NOT re-created by --fix');
});

test('AC-2.7: canonical README.md and INDEX.md contain no em-dash and no denylisted American-English forms', async () => {
  const tmp = await freshInit();
  const readme = await readFile(join(tmp, 'rcf', 'knowledge', 'README.md'), 'utf8');
  const index = await readFile(join(tmp, 'rcf', 'knowledge', 'INDEX.md'), 'utf8');
  const deny = /\b(behavior|behaviors|behavioral|organization|organizations|organize|organized|realize|realized|analyze|analyzed|customize|customizing|color|colors|favor|favors|centered|labeled|traveled|catalog|dialog)\b/i;
  for (const [name, text] of [['README', readme], ['INDEX', index]]) {
    assert.equal(/—/.test(text), false, `${name} contains em-dash`);
    assert.equal(deny.test(text), false, `${name} contains American-English denylist form`);
  }
});

test('knowledge check is clean on fresh init', async () => {
  const tmp = await freshInit();
  const { code } = await runBin(tmp, ['doctor', '--check', 'knowledge']);
  assert.equal(code, 0);
});

// Sanity: writing an operator note under notes/ does not disturb doctor.
test('doctor is indifferent to operator files under rcf/knowledge/', async () => {
  const tmp = await freshInit();
  await writeFile(join(tmp, 'rcf', 'knowledge', 'notes', 'ci-node-version.md'), '# CI Node\n\nUses 24.\n', 'utf8');
  const { code } = await runBin(tmp, ['doctor', '--check', 'knowledge']);
  assert.equal(code, 0);
});

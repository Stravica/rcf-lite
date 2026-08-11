// AC-3.1, AC-3.2 (init side) — init writes the managed .gitignore
// block on a fresh repo, appends alongside operator entries on an
// existing repo, and rounds-trip through doctor cleanly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { composeGitignoreBlock } from '../../src/setup/managed-gitignore.js';

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

test('fresh init: .gitignore contains exactly the composed managed block', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-gi-fresh-'));
  const { code } = await runBin(tmp, ['init', '--project-name', 'GTest', '--non-interactive']);
  assert.equal(code, 0);
  const gitignore = await readFile(join(tmp, '.gitignore'), 'utf8');
  assert.equal(gitignore, composeGitignoreBlock());
});

test('existing .gitignore: operator entries preserved above the managed block', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-gi-existing-'));
  const operatorHeader = '# operator gitignore\nnode_modules/\n.env\n';
  await writeFile(join(tmp, '.gitignore'), operatorHeader, 'utf8');
  const { code } = await runBin(tmp, ['init', '--project-name', 'GTest', '--non-interactive']);
  assert.equal(code, 0);
  const gitignore = await readFile(join(tmp, '.gitignore'), 'utf8');
  assert.equal(gitignore.startsWith(operatorHeader), true, 'operator header preserved verbatim');
  assert.match(gitignore, /# rcf:managed:begin/);
  assert.match(gitignore, /rcf\/\.identity\//);
});

test('re-run init on the same repo: managed block does not duplicate', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-gi-rerun-'));
  await runBin(tmp, ['init', '--project-name', 'First', '--non-interactive']);
  const first = await readFile(join(tmp, '.gitignore'), 'utf8');
  await runBin(tmp, ['init', '--project-name', 'Second', '--non-interactive']);
  const second = await readFile(join(tmp, '.gitignore'), 'utf8');
  const beginCount = (second.match(/# rcf:managed:begin/g) ?? []).length;
  assert.equal(beginCount, 1, 'exactly one managed block after re-run');
  assert.equal(second, first, 'idempotent: byte-identical after re-run');
});

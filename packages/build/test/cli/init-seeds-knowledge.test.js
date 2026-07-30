// AC-2.1..AC-2.3 — init seeds rcf/knowledge/ correctly and idempotently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { KNOWLEDGE_README, KNOWLEDGE_INDEX } from '../../src/setup/knowledge-seed.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBinInit(cwd) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, 'init', '--project-name', 'KTest', '--non-interactive'], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function pathExists(p) {
  try { await access(p); return true; } catch { return false; }
}

test('AC-2.1: rcf init on a fresh repo creates rcf/knowledge/{README.md, INDEX.md, notes/.gitkeep, docs/.gitkeep} with canonical text', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-kn-'));
  const { code } = await runBinInit(tmp);
  assert.equal(code, 0);
  const readme = await readFile(join(tmp, 'rcf', 'knowledge', 'README.md'), 'utf8');
  const index = await readFile(join(tmp, 'rcf', 'knowledge', 'INDEX.md'), 'utf8');
  assert.equal(readme, KNOWLEDGE_README);
  assert.equal(index, KNOWLEDGE_INDEX);
  assert.equal(await pathExists(join(tmp, 'rcf', 'knowledge', 'notes', '.gitkeep')), true);
  assert.equal(await pathExists(join(tmp, 'rcf', 'knowledge', 'docs', '.gitkeep')), true);
});

test('AC-2.2: init re-run leaves rcf/knowledge/README.md untouched even with operator content', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-kn-re-'));
  await runBinInit(tmp);
  const custom = '# Custom README\n\nOperator wrote this after init.\n';
  await writeFile(join(tmp, 'rcf', 'knowledge', 'README.md'), custom, 'utf8');
  const { code } = await runBinInit(tmp);
  assert.equal(code, 0);
  const after = await readFile(join(tmp, 'rcf', 'knowledge', 'README.md'), 'utf8');
  assert.equal(after, custom, 'operator-owned README preserved');
});

test('AC-2.3: init re-run on a repo whose knowledge/ tree was fully deleted re-seeds all four managed files', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-init-kn-nuke-'));
  await runBinInit(tmp);
  await rm(join(tmp, 'rcf', 'knowledge'), { recursive: true, force: true });
  const { code } = await runBinInit(tmp);
  assert.equal(code, 0);
  const readme = await readFile(join(tmp, 'rcf', 'knowledge', 'README.md'), 'utf8');
  assert.equal(readme, KNOWLEDGE_README);
  assert.equal(await pathExists(join(tmp, 'rcf', 'knowledge', 'notes', '.gitkeep')), true);
  assert.equal(await pathExists(join(tmp, 'rcf', 'knowledge', 'docs', '.gitkeep')), true);
});

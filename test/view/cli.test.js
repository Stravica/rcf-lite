// CLI test for bin/rcf-view.js. Drives the bin as a subprocess against
// temporary fixture roots and asserts exit codes + stdout/stderr lines.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '../../src/store/init.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const bin = resolve(repoRoot, 'bin', 'rcf-view.js');

async function runBin(cwd, args = []) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], { cwd, encoding: 'utf8' });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('rcf-view --help exits 0 in any directory (D17)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-help-'));
  const { code, stdout } = await runBin(tmp, ['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: rcf-view/);
  assert.match(stdout, /--strict/);
  assert.match(stdout, /Exit codes/);
});

test('rcf-view in a directory with no project exits 2 (usage)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-noproject-'));
  const { code, stderr } = await runBin(tmp);
  assert.equal(code, 2);
  assert.match(stderr, /no project root found/);
});

test('rcf-view --unknown-flag exits 2 (usage)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-bad-flag-'));
  const { code, stderr } = await runBin(tmp, ['--whatever']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown option/);
});

test('rcf-view on a clean fresh project exits 0 and writes output', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-clean-'));
  await initProject({ projectRoot: tmp });
  const { code, stdout } = await runBin(tmp);
  assert.equal(code, 0, stdout);
  assert.match(stdout, /wrote 3 files/);
  const s = await stat(join(tmp, '.rcf-view', 'index.html'));
  assert.ok(s.isFile());
});

test('rcf-view on a broken tree exits 3, writes output by default (OQ7)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-broken-'));
  await initProject({ projectRoot: tmp });
  const prdPath = join(tmp, 'rcf', 'prd.json');
  const prd = JSON.parse(await readFile(prdPath, 'utf8'));
  prd.requirementIds = ['REQ-099'];
  await writeFile(prdPath, JSON.stringify(prd), 'utf8');
  const { code, stderr } = await runBin(tmp);
  assert.equal(code, 3);
  assert.match(stderr, /missingFile/);
  assert.match(stderr, /Pass --strict/);
  const s = await stat(join(tmp, '.rcf-view', 'index.html'));
  assert.ok(s.isFile());
});

test('rcf-view --strict on a broken tree exits 3 with no output', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-strict-'));
  await initProject({ projectRoot: tmp });
  const prdPath = join(tmp, 'rcf', 'prd.json');
  const prd = JSON.parse(await readFile(prdPath, 'utf8'));
  prd.requirementIds = ['REQ-099'];
  await writeFile(prdPath, JSON.stringify(prd), 'utf8');
  const { code, stderr } = await runBin(tmp, ['--strict']);
  assert.equal(code, 3);
  assert.match(stderr, /output not written/);
  try {
    await stat(join(tmp, '.rcf-view', 'index.html'));
    assert.fail('no index.html should be written under --strict');
  } catch (err) {
    assert.equal(err.code, 'ENOENT');
  }
});

test('rcf-view --quiet suppresses stdout summary on success', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-quiet-'));
  await initProject({ projectRoot: tmp });
  const { code, stdout } = await runBin(tmp, ['--quiet']);
  assert.equal(code, 0);
  assert.equal(stdout, '');
});

test('rcf-view --quiet --verbose is a usage error', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-clash-'));
  await initProject({ projectRoot: tmp });
  const { code, stderr } = await runBin(tmp, ['--quiet', '--verbose']);
  assert.equal(code, 2);
  assert.match(stderr, /mutually exclusive/);
});

test('rcf-view --verbose emits per-document log lines on stdout', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-verbose-'));
  await initProject({ projectRoot: tmp });
  const { code, stdout } = await runBin(tmp, ['--verbose']);
  assert.equal(code, 0);
  assert.match(stdout, /walking tree/);
  assert.match(stdout, /wrote /);
});

test('rcf-view runs from a subdirectory and walks upward (D19)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-sub-'));
  await initProject({ projectRoot: tmp });
  const subDir = join(tmp, 'rcf', 'requirements');
  const { code } = await runBin(subDir);
  assert.equal(code, 0);
  const s = await stat(join(tmp, '.rcf-view', 'index.html'));
  assert.ok(s.isFile());
});

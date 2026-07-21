// `rcf help` + top-level help subcommand tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(args = []) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], { encoding: 'utf8' });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

test('rcf with no args prints top-level help (exit 0)', async () => {
  const { code, stdout } = await runBin([]);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: rcf <command>/);
  assert.match(stdout, /init/);
  assert.match(stdout, /view/);
  assert.match(stdout, /validate/);
  assert.match(stdout, /create/);
  assert.match(stdout, /read/);
  assert.match(stdout, /update/);
  assert.match(stdout, /delete/);
  assert.match(stdout, /link/);
});

test('rcf --version prints "rcf <semver>"', async () => {
  const { code, stdout } = await runBin(['--version']);
  assert.equal(code, 0);
  assert.match(stdout, /^rcf \d+\.\d+\.\d+\n?$/);
});

test('rcf --help prints the top-level help', async () => {
  const { code, stdout } = await runBin(['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: rcf <command>/);
});

test('rcf help create prints the create-specific block', async () => {
  const { code, stdout } = await runBin(['help', 'create']);
  assert.equal(code, 0);
  assert.match(stdout, /Kinds: req \| us \| ac/);
  assert.match(stdout, /--parent/);
});

test('rcf help unknown-topic exits 2', async () => {
  const { code, stderr } = await runBin(['help', 'nope']);
  assert.equal(code, 2);
  assert.match(stderr, /no help topic/);
});

test('rcf bogus-subcommand exits 2 (usage)', async () => {
  const { code, stderr } = await runBin(['bogus']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown subcommand/);
});

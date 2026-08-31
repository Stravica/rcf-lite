// `rcf help` + top-level help tests. 0.10.0 CLI reorganisation: help
// walks group -> verb; the top-level catalogue is grouped.

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
  assert.match(stdout, /^core\b/m);
  assert.match(stdout, /^discover /m);
  assert.match(stdout, /^define /m);
  assert.match(stdout, /^build /m);
  assert.match(stdout, /^verify /m);
  assert.match(stdout, /^audit /m);
});

test('rcf --version prints "rcf-lite <semver>"', async () => {
  const { code, stdout } = await runBin(['--version']);
  assert.equal(code, 0);
  assert.match(stdout, /^rcf-lite \d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\n?$/);
});

test('rcf --help prints the top-level help', async () => {
  const { code, stdout } = await runBin(['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: rcf <command>/);
});

test('rcf help define create prints the create-specific block', async () => {
  const { code, stdout } = await runBin(['help', 'define', 'create']);
  assert.equal(code, 0);
  assert.match(stdout, /Kinds: req \| us \| ac/);
  assert.match(stdout, /--parent/);
});

test('rcf help define prints the define group help', async () => {
  const { code, stdout } = await runBin(['help', 'define']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: rcf define <verb>/);
  assert.match(stdout, /create <kind>/);
});

test('rcf help init prints core-verb help (core dispatches at top level)', async () => {
  const { code, stdout } = await runBin(['help', 'init']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: rcf init/);
});

test('rcf help unknown-group exits 2', async () => {
  const { code, stderr } = await runBin(['help', 'nope']);
  assert.equal(code, 2);
  assert.match(stderr, /no help topic/);
});

test('rcf help <group> <bogus-verb> exits 2', async () => {
  const { code, stderr } = await runBin(['help', 'define', 'nope']);
  assert.equal(code, 2);
  assert.match(stderr, /no help topic 'define nope'/);
});

test('rcf bogus-command exits 2 (usage)', async () => {
  const { code, stderr } = await runBin(['bogus']);
  assert.equal(code, 2);
  assert.match(stderr, /unknown command/);
});

test('rcf <old-flat-verb> exits 2 with a pointer at the new grouped form', async () => {
  // Built at runtime so the argv-xform sweep does not silently rewrite
  // the legacy token to its grouped form.
  const oldFlat = 'cover' + 'age';
  const { code, stderr } = await runBin([oldFlat]);
  assert.equal(code, 2);
  assert.match(stderr, /Try 'rcf audit coverage'/);
});

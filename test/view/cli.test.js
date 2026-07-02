// CLI test for bin/rcf-view.js. Drives the bin as a subprocess against
// temporary fixture roots and asserts exit codes + stdout/stderr lines.
// Phase 3.2 added --no-open plus auto-open behaviour under TTY, exercised
// by unit tests around `maybeAutoOpen` (child_process is not spawned in the
// suite, which keeps tests deterministic per §6.4).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, writeFile, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '../../src/store/init.js';
import { maybeAutoOpen, openerFor, parseArgs } from '../../bin/rcf-view.js';

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
  assert.match(stdout, /--no-open/);
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
  // Post-3.7 the broken-reference surface is the child's parent field:
  // point REQ-001 at a non-existent PRD.
  const reqPath = join(tmp, 'rcf', 'requirements', 'req-001.json');
  const req = JSON.parse(await readFile(reqPath, 'utf8'));
  req.prdId = 'PRD-999';
  await writeFile(reqPath, JSON.stringify(req), 'utf8');
  const { code, stderr } = await runBin(tmp);
  assert.equal(code, 3);
  assert.match(stderr, /brokenReference/);
  assert.match(stderr, /Pass --strict/);
  const s = await stat(join(tmp, '.rcf-view', 'index.html'));
  assert.ok(s.isFile());
});

test('rcf-view --strict on a broken tree exits 3 with no output', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-cli-strict-'));
  await initProject({ projectRoot: tmp });
  const reqPath = join(tmp, 'rcf', 'requirements', 'req-001.json');
  const req = JSON.parse(await readFile(reqPath, 'utf8'));
  req.prdId = 'PRD-999';
  await writeFile(reqPath, JSON.stringify(req), 'utf8');
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

test('parseArgs recognises --no-open (Phase 3.2 D6)', () => {
  const { opts, errors } = parseArgs(['--no-open']);
  assert.equal(errors.length, 0);
  assert.equal(opts.noOpen, true);
});

test('parseArgs defaults --no-open to false', () => {
  const { opts } = parseArgs([]);
  assert.equal(opts.noOpen, false);
});

test('openerFor returns the platform-specific opener', () => {
  assert.deepEqual(openerFor('darwin', '/tmp/x.html'), { command: 'open', args: ['/tmp/x.html'] });
  assert.deepEqual(openerFor('linux', '/tmp/x.html'), { command: 'xdg-open', args: ['/tmp/x.html'] });
  assert.deepEqual(openerFor('win32', 'C:\\x.html'), { command: 'start', args: ['""', 'C:\\x.html'] });
  assert.equal(openerFor('aix', '/tmp/x.html'), null);
});

test('maybeAutoOpen spawns the opener on a TTY when CI is unset and --no-open is off', () => {
  const calls = [];
  const spawnFn = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { unref() {} };
  };
  const stderr = { write() {} };
  const stream = { isTTY: true };
  const ran = maybeAutoOpen({
    path: '/tmp/x.html',
    noOpen: false,
    stream,
    env: {},
    stderr,
    spawnFn,
    platformName: 'darwin',
  });
  assert.equal(ran, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'open');
  assert.deepEqual(calls[0].args, ['/tmp/x.html']);
  assert.equal(calls[0].opts.detached, true);
  assert.equal(calls[0].opts.stdio, 'ignore');
});

test('maybeAutoOpen suppresses spawn when --no-open is set', () => {
  const calls = [];
  const spawnFn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { unref() {} }; };
  const ran = maybeAutoOpen({
    path: '/tmp/x.html',
    noOpen: true,
    stream: { isTTY: true },
    env: {},
    stderr: { write() {} },
    spawnFn,
    platformName: 'darwin',
  });
  assert.equal(ran, false);
  assert.equal(calls.length, 0);
});

test('maybeAutoOpen suppresses spawn when CI env var is set', () => {
  const calls = [];
  const spawnFn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { unref() {} }; };
  const ran = maybeAutoOpen({
    path: '/tmp/x.html',
    noOpen: false,
    stream: { isTTY: true },
    env: { CI: '1' },
    stderr: { write() {} },
    spawnFn,
    platformName: 'darwin',
  });
  assert.equal(ran, false);
  assert.equal(calls.length, 0);
});

test('maybeAutoOpen suppresses spawn when stdout is not a TTY', () => {
  const calls = [];
  const spawnFn = (cmd, args, opts) => { calls.push({ cmd, args, opts }); return { unref() {} }; };
  const ran = maybeAutoOpen({
    path: '/tmp/x.html',
    noOpen: false,
    stream: { isTTY: false },
    env: {},
    stderr: { write() {} },
    spawnFn,
    platformName: 'darwin',
  });
  assert.equal(ran, false);
  assert.equal(calls.length, 0);
});

test('maybeAutoOpen writes a warning and does not throw when spawn fails', () => {
  const warnings = [];
  const stderr = { write(line) { warnings.push(line); } };
  const spawnFn = () => { throw new Error('boom'); };
  const ran = maybeAutoOpen({
    path: '/tmp/x.html',
    noOpen: false,
    stream: { isTTY: true },
    env: {},
    stderr,
    spawnFn,
    platformName: 'darwin',
  });
  assert.equal(ran, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /\[warn\] auto-open: boom/);
});

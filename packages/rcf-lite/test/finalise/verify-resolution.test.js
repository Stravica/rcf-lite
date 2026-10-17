// Issue 356 (2026-10-13) secondary fault, US-16505 / TS-250 (AC-16505-5):
// verify-binary resolution and its disclosure.
//
// `detectVerify` resolved the `rcf` bin PATH-first, so an isolated 0.34.0
// project install (`node_modules/.bin/rcf build finalise`) spawned whatever
// `rcf` came first on PATH: a stale global 0.33.0 that exited 2 on the
// 0.34.0 arguments without writing a report, and finalise could not say
// which binary it had run. The contract:
//   1. finalise prefers the verify entry of the rcf-lite package it runs
//      from (this package's own bin/rcf.js under the current node), and
//      uses PATH only when no package entry resolves;
//   2. the resolved invocation carries the version of that binary;
//   3. the finalise report records the resolved verify command, its
//      prefix args, the route and the version, on the launch-failure
//      record and after a completed run, so an operator can see when a
//      stale global shadowed the local install;
//   4. (gate P1, fix round) a completed report that cannot be stamped
//      with that record is never promoted: finalise stops before gate
//      evaluation, exits 1, names the failure and leaves the FBS as is.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main as finalise } from '../../src/cli/finalise.js';
import { detectVerify } from '../../src/finalise/detect.js';
import { main as verifyRun } from '../../src/verify/cli/run.js';
import { scaffoldChain } from '../verify/helpers/chain.js';
import { scratchDir } from '../_helpers/scratch.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..', '..');

function sink() { return { data: '', write(s) { this.data += s; } }; }

const URL = 'https://app.example.com';

async function packageVersion() {
  return JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).version;
}

// A foreign `rcf` executable (the "stale global") placed first on PATH.
async function foreignRcfOnPath() {
  const dir = await scratchDir('rcf-foreign-bin-');
  const bin = join(dir, 'rcf');
  await writeFile(bin, '#!/bin/sh\necho "rcf-lite 0.33.0"\nexit 2\n', 'utf8');
  await chmod(bin, 0o755);
  return { dir, bin };
}

function fbsDoc(fbsId, buildOrder, acIds) {
  return {
    fbsId,
    prdId: 'PRD-001',
    bsId: 'BS-001',
    buildOrder,
    executionStatus: 'complete',
    title: `${fbsId} fixture`,
    summary: `${fbsId} binds ${acIds.join(', ')}.`,
    acIds,
    dependsOnFbsIds: [],
    createdAt: '2026-10-13T00:00:00.000Z',
    updatedAt: '2026-10-13T00:00:00.000Z',
  };
}

async function statusOf(root, fbsId) {
  const doc = JSON.parse(await readFile(join(root, 'rcf', 'fbs', `${fbsId.toLowerCase()}.json`), 'utf8'));
  return doc.executionStatus;
}

async function readReport(root) {
  return JSON.parse(await readFile(join(root, '.rcf-verify-report.json'), 'utf8'));
}

// --- AC-16505-5 (resolution): package-local entry beats PATH ---------------

test('detectVerify prefers the verify entry of the package finalise runs from over a foreign rcf on PATH, and carries its version', async () => {
  const { dir, bin } = await foreignRcfOnPath();
  // A cwd with no rcf-lite installed nearby: the only package entry that
  // can resolve is the one finalise itself is running from.
  const emptyProject = await scratchDir('rcf-no-install-');

  const det = await detectVerify({ env: { PATH: `/nonexistent:${dir}` }, cwd: emptyProject });
  assert.equal(det.installed, true);
  assert.ok(det.invocation, 'an invocation is resolved');
  assert.notEqual(det.invocation.command, bin, 'the foreign PATH rcf must not win over the package entry');
  assert.notEqual(det.invocation.source, 'path');
  assert.equal(det.invocation.command, process.execPath, 'a package entry runs under the current node');
  const ownEntry = await realpath(join(packageRoot, 'bin', 'rcf.js'));
  assert.equal(await realpath(det.invocation.prefixArgs[0]), ownEntry, 'the entry is this package\'s own bin/rcf.js');
  assert.equal(det.invocation.version, await packageVersion(), 'the invocation carries the resolved binary\'s version');
});

// --- AC-16505-5 (resolution): PATH is the fallback, reached only after both
// package routes miss (gate P2, fix round) -----------------------------------

// An npm-global style layout: <prefix>/lib/node_modules/rcf-lite holding a
// package.json at the given version and its bin/rcf.js, with
// <prefix>/bin/rcf symlinked to that entry, exactly as `npm i -g` lays it
// out. The version of a PATH hit is read by following that symlink back
// to the package.
async function stagedGlobalRcf(version) {
  const prefix = await realpath(await scratchDir('rcf-global-'));
  const pkgDir = join(prefix, 'lib', 'node_modules', 'rcf-lite');
  await mkdir(join(pkgDir, 'bin'), { recursive: true });
  await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: 'rcf-lite', version, bin: { rcf: 'bin/rcf.js' } }), 'utf8');
  await writeFile(join(pkgDir, 'bin', 'rcf.js'), '#!/usr/bin/env node\n', 'utf8');
  await chmod(join(pkgDir, 'bin', 'rcf.js'), 0o755);
  await mkdir(join(prefix, 'bin'));
  const bin = join(prefix, 'bin', 'rcf');
  await symlink(join(pkgDir, 'bin', 'rcf.js'), bin);
  return { binDir: join(prefix, 'bin'), bin, entry: join(pkgDir, 'bin', 'rcf.js') };
}

test('detectVerify uses the rcf on PATH only when both package routes return null, records source path, and carries the version behind the PATH binary (null for a foreign script)', async () => {
  const none = async () => null;
  const global = await stagedGlobalRcf('0.33.0');
  const { dir: foreignDir, bin: foreignBin } = await foreignRcfOnPath();

  // Both package routes miss: the PATH hit is the invocation, run by its
  // own shebang (no prefix args), route 'path', version read through the
  // global symlink back to the installed package.
  const viaPath = await detectVerify({
    resolveSelfBin: none, resolvePackageBin: none, cwd: foreignDir, env: { PATH: `/nonexistent:${global.binDir}` },
  });
  assert.equal(viaPath.installed, true);
  assert.deepEqual(viaPath.invocation, { command: global.bin, prefixArgs: [], source: 'path', version: '0.33.0' });

  // A PATH hit that is not an rcf-lite package (a foreign script named
  // rcf) is still the fallback invocation, with version null: omit, never
  // guess.
  const viaForeign = await detectVerify({
    resolveSelfBin: none, resolvePackageBin: none, cwd: foreignDir, env: { PATH: foreignDir },
  });
  assert.equal(viaForeign.installed, true);
  assert.deepEqual(viaForeign.invocation, { command: foreignBin, prefixArgs: [], source: 'path', version: null });

  // Only when no package entry resolves: the project-local route winning
  // over a PATH hit that is also present, and the self route winning over
  // both, with the package version carried in each case.
  const viaProject = await detectVerify({
    resolveSelfBin: none, resolvePackageBin: async () => global.entry, cwd: foreignDir, env: { PATH: foreignDir },
  });
  assert.deepEqual(viaProject.invocation, { command: process.execPath, prefixArgs: [global.entry], source: 'package', version: '0.33.0' });
  const viaSelf = await detectVerify({
    resolveSelfBin: async () => global.entry, resolvePackageBin: async () => { throw new Error('the project route must not be consulted when the self route resolves'); },
    cwd: foreignDir, env: { PATH: foreignDir },
  });
  assert.deepEqual(viaSelf.invocation, { command: process.execPath, prefixArgs: [global.entry], source: 'package', version: '0.33.0' });

  // Nothing anywhere: not installed, no invocation (the install prompt path).
  const nothing = await detectVerify({ resolveSelfBin: none, resolvePackageBin: none, cwd: foreignDir, env: { PATH: '/nonexistent' } });
  assert.deepEqual(nothing, { installed: false, invocation: null });
});

// --- AC-16505-5 (disclosure): the report records what ran ------------------

// --- AC-16505-5 (disclosure): every completed report, not only a PASS ------

// --- AC-16505-5 (integrity): no run.verify record, no promotion ------------

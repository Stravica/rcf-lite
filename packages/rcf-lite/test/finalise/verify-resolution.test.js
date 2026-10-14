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
import { chmod, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { main as finalise } from '../../src/cli/finalise.js';
import { detectVerify } from '../../src/finalise/detect.js';
import { main as verifyRun } from '../../src/verify/cli/run.js';
import { scaffoldChain } from '../verify/helpers/chain.js';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..', '..');

function sink() { return { data: '', write(s) { this.data += s; } }; }

const URL = 'https://app.example.com';

async function packageVersion() {
  return JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8')).version;
}

// A foreign `rcf` executable (the "stale global") placed first on PATH.
async function foreignRcfOnPath() {
  const dir = await mkdtemp(join(tmpdir(), 'rcf-foreign-bin-'));
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
  const emptyProject = await mkdtemp(join(tmpdir(), 'rcf-no-install-'));

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
  const prefix = await realpath(await mkdtemp(join(tmpdir(), 'rcf-global-')));
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

test('finalise: the report records the resolved verify command and its version, launch failure and completed run included', async () => {
  // Launch failure: the detected binary is a PATH rcf at 0.33.0 that exits
  // 2 without writing a report (the issue 356 symptom). The aborted record
  // must say which binary ran and at what version.
  const stale = {
    installed: true,
    invocation: { command: '/opt/stale/bin/rcf', prefixArgs: [], source: 'path', version: '0.33.0' },
  };
  const { root } = await scaffoldChain({ fbsItems: [fbsDoc('FBS-001', 1, ['AC-101-3'])] });
  const stderr = sink();
  const seen = [];
  const code = await finalise(['FBS-001', '--url', URL, '--allow-pre-merge'], {
    stdout: sink(), stderr, cwd: root,
    detectVerify: async () => stale,
    spawnVerify: async ({ invocation }) => { seen.push(invocation); return { code: 2, signal: null, env: {} }; },
  });
  assert.equal(code, 2);
  assert.equal(seen[0].command, '/opt/stale/bin/rcf');
  assert.equal(await statusOf(root, 'FBS-001'), 'complete');
  const aborted = await readReport(root);
  assert.equal(aborted.launchFailure?.status, 'aborted');
  assert.deepEqual(aborted.run?.verify, {
    command: '/opt/stale/bin/rcf', prefixArgs: [], source: 'path', version: '0.33.0',
  });

  // Completed run: the package-route invocation is recorded on the report
  // verify wrote, so a promoted tree says which verifier produced it.
  const local = {
    installed: true,
    invocation: { command: process.execPath, prefixArgs: ['/proj/node_modules/rcf-lite/bin/rcf.js'], source: 'package', version: '0.34.0' },
  };
  const { root: root2 } = await scaffoldChain({ fbsItems: [fbsDoc('FBS-001', 1, ['AC-101-3'])] });
  const stderr2 = sink();
  const code2 = await finalise(['FBS-001', '--url', URL, '--allow-pre-merge'], {
    stdout: sink(), stderr: stderr2, cwd: root2,
    detectVerify: async () => local,
    spawnVerify: async ({ verifyArgs, cwd }) => {
      const rc = await verifyRun(verifyArgs.slice(2), {
        cwd,
        stdout: sink(),
        stderr: sink(),
        fetchImpl: async () => ({ status: 200, text: async () => '<html>ok</html>' }),
        launchAgent: async ({ brief }) => ({
          findings: brief.journeys.map((j) => ({ severity: 'PASS', acId: j.acId, journey: j.journey, reproSteps: ['drive'], evidence: { kind: 'note', detail: 'ok' } })),
        }),
      });
      return { code: rc, signal: null, env: {} };
    },
  });
  assert.equal(code2, 0, stderr2.data);
  assert.equal(await statusOf(root2, 'FBS-001'), 'verified');
  const completed = await readReport(root2);
  assert.equal(completed.verdict, 'PASS');
  assert.deepEqual(completed.run?.verify, {
    command: process.execPath, prefixArgs: ['/proj/node_modules/rcf-lite/bin/rcf.js'], source: 'package', version: '0.34.0',
  });
});

// --- AC-16505-5 (disclosure): every completed report, not only a PASS ------

// Gate P2 (fix round). The hand-1 report case covers the aborted record
// and a promoted PASS. A completed run that the gate refuses (blocked
// criteria under the default provisioning mode, or a PASS held for lack
// of ship authority) is a completed report too, and must carry the same
// full run.verify object.
test('finalise: a completed blocked run and a completed held run record the full run.verify object on the report (exit 4, FBS unchanged)', async () => {
  const local = {
    installed: true,
    invocation: { command: process.execPath, prefixArgs: ['/proj/node_modules/rcf-lite/bin/rcf.js'], source: 'package', version: '0.34.0' },
  };
  const expectedRecord = {
    command: process.execPath, prefixArgs: ['/proj/node_modules/rcf-lite/bin/rcf.js'], source: 'package', version: '0.34.0',
  };
  const inProcess = async ({ verifyArgs, cwd }) => {
    const rc = await verifyRun(verifyArgs.slice(2), {
      cwd,
      stdout: sink(),
      stderr: sink(),
      fetchImpl: async () => ({ status: 200, text: async () => '<html>ok</html>' }),
      launchAgent: async ({ brief }) => ({
        findings: brief.journeys.map((j) => ({ severity: 'PASS', acId: j.acId, journey: j.journey, reproSteps: ['drive'], evidence: { kind: 'note', detail: 'ok' } })),
      }),
    });
    return { code: rc, signal: null, env: {} };
  };

  // Blocked: FBS-001 binds the auth and payment-sandbox criteria, which
  // verify cannot provision under the default mode; the completed report
  // lists them on blockedAcs and the gate refuses.
  const { root } = await scaffoldChain({ fbsItems: [fbsDoc('FBS-001', 1, ['AC-101-1', 'AC-101-2'])] });
  const stderr = sink();
  const code = await finalise(['FBS-001', '--url', URL, '--allow-pre-merge'], {
    stdout: sink(), stderr, cwd: root,
    detectVerify: async () => local,
    spawnVerify: inProcess,
  });
  assert.equal(code, 4, stderr.data);
  assert.equal(await statusOf(root, 'FBS-001'), 'complete');
  const blockedReport = await readReport(root);
  assert.equal(blockedReport.launchFailure ?? null, null, 'a completed report, not the preseed or an aborted record');
  assert.deepEqual(blockedReport.blockedAcs.map((b) => b.acId), ['AC-101-1', 'AC-101-2']);
  assert.equal(blockedReport.provisioning?.mode, 'run');
  assert.deepEqual(blockedReport.run?.verify, expectedRecord);

  // Held: a ci-profile PASS carries correctness authority only, so the
  // gate holds instead of promoting; the completed report is stamped all
  // the same.
  const { root: root2 } = await scaffoldChain({ fbsItems: [fbsDoc('FBS-001', 1, ['AC-101-3'])] });
  const stderr2 = sink();
  const code2 = await finalise(['FBS-001', '--url', URL, '--allow-pre-merge', '--profile', 'ci'], {
    stdout: sink(), stderr: stderr2, cwd: root2,
    detectVerify: async () => local,
    spawnVerify: inProcess,
  });
  assert.equal(code2, 4, stderr2.data);
  assert.match(stderr2.data, /HOLD/);
  assert.equal(await statusOf(root2, 'FBS-001'), 'complete');
  const heldReport = await readReport(root2);
  assert.equal(heldReport.verdict, 'PASS');
  assert.notEqual(heldReport.verdictAuthority, 'ship');
  assert.deepEqual(heldReport.run?.verify, expectedRecord);
});

// --- AC-16505-5 (integrity): no run.verify record, no promotion ------------

// Issue 356 gate P1 (fix round, hand 1). The run.verify stamp is the only
// record of which verifier produced a completed report. A completed PASS
// report with ship authority must not promote the FBS when that record
// cannot be persisted: finalise stops before any gate evaluation, exits
// 1, names the failure and leaves the FBS as it found it. The writeFile
// seam below accepts the preseed stub (it carries run.verify already)
// and rejects every other write, which is exactly the stamp write after
// verify has replaced the stub with its real report.
test('finalise: a completed ship report that cannot be stamped with run.verify is refused before the gate (exit 1, FBS unchanged)', async () => {
  const local = {
    installed: true,
    invocation: { command: process.execPath, prefixArgs: ['/proj/node_modules/rcf-lite/bin/rcf.js'], source: 'package', version: '0.34.0' },
  };
  const { root } = await scaffoldChain({ fbsItems: [fbsDoc('FBS-001', 1, ['AC-101-3'])] });
  const outPath = join(root, '.rcf-verify-report.json');
  const rejected = [];
  const writeFileSeam = async (path, data, encoding) => {
    const parsed = JSON.parse(String(data));
    if (parsed?.launchFailure?.reason === 'preseed') return writeFile(path, data, encoding);
    rejected.push(path);
    throw new Error('EIO: simulated stamp write failure');
  };
  const stdout = sink();
  const stderr = sink();
  const code = await finalise(['FBS-001', '--url', URL, '--allow-pre-merge'], {
    stdout, stderr, cwd: root,
    detectVerify: async () => local,
    writeFile: writeFileSeam,
    spawnVerify: async ({ verifyArgs, cwd }) => {
      const rc = await verifyRun(verifyArgs.slice(2), {
        cwd,
        stdout: sink(),
        stderr: sink(),
        fetchImpl: async () => ({ status: 200, text: async () => '<html>ok</html>' }),
        launchAgent: async ({ brief }) => ({
          findings: brief.journeys.map((j) => ({ severity: 'PASS', acId: j.acId, journey: j.journey, reproSteps: ['drive'], evidence: { kind: 'note', detail: 'ok' } })),
        }),
      });
      return { code: rc, signal: null, env: {} };
    },
  });

  // The precondition the seam set up: verify wrote a valid ship report
  // and finalise's stamp write was the one refused, so the report on
  // disk carries no run.verify record.
  assert.deepEqual(rejected, [outPath], 'the refused write is the run.verify stamp on the report path');
  const onDisk = await readReport(root);
  assert.equal(onDisk.verdict, 'PASS');
  assert.equal(onDisk.verdictAuthority, 'ship');
  assert.equal(onDisk.run?.verify, undefined, 'the stamp never landed');

  // The contract: no record, no promotion, and the failure is named.
  assert.equal(code, 1, `finalise must exit 1 when run.verify cannot be persisted:\n${stderr.data}`);
  assert.equal(await statusOf(root, 'FBS-001'), 'complete', 'the FBS is left unchanged');
  assert.doesNotMatch(stdout.data, /gate passed|-> verified/, 'the gate must not be evaluated, let alone promote');
  assert.match(stderr.data, /run\.verify/, 'stderr names the record that could not be persisted');
  assert.ok(stderr.data.includes(outPath), 'stderr names the report path');
  assert.match(stderr.data, /FBS-001/, 'stderr names the FBS left unchanged');
});

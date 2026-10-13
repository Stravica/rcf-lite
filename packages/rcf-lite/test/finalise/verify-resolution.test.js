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
//      stale global shadowed the local install.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
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

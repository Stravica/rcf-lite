// AC coverage for REQ-009 / US-901 - the `rcf verify` group added by
// the 0.10.0 CLI reorganisation (clean break from the 0.7.1 transition-
// grace alias bin). Verifies that:
//   AC-901-1: `verify` on the top-level GROUPS map dispatches every
//             sub-verb to the corresponding verify-suite handler.
//   AC-901-2: the top-level `rcf --help` string carries the verify
//             group header and sub-verb catalogue.
//   AC-901-3: the legacy standalone `rcf-verify` bin is deleted from
//             the package (no bin/rcf-verify.js file, no bin field
//             entry), and the umbrella `rcf` bin refuses old flat verb
//             tokens with a stderr hint at the new grouped form.
//
// The tests exercise real modules, not a mock - the dispatch map is
// the code the 0.10.0 dispatcher wires, and the bin is executed as a
// child process so the actual exit codes and stderr surface.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { GROUPS } from '../../bin/rcf.js';
import { TOP_LEVEL_HELP } from '../../src/cli/help.js';
import { main as verifyRunMain } from '../../src/verify/cli/run.js';
import { main as verifyReportMain } from '../../src/verify/cli/report.js';
import { main as verifyProvisionMain } from '../../src/verify/cli/provision.js';
import { main as verifyCleanupMain } from '../../src/verify/cli/cleanup.js';
import { main as verifyMcpMain } from '../../src/verify/cli/mcp.js';
import { main as browserVerifyMain } from '../../src/cli/browser-verify.js';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..', '..');
const RCF_BIN = resolve(PKG_ROOT, 'bin', 'rcf.js');

test('AC-901-1: `verify` group on GROUPS wires each sub-verb to the verify-suite handler', () => {
  assert.equal(GROUPS.verify.run, verifyRunMain, 'run must resolve to verify/cli/run.js main');
  assert.equal(GROUPS.verify.report, verifyReportMain, 'report must resolve to verify/cli/report.js main');
  assert.equal(GROUPS.verify.provision, verifyProvisionMain, 'provision must resolve to verify/cli/provision.js main');
  assert.equal(GROUPS.verify.cleanup, verifyCleanupMain, 'cleanup must resolve to verify/cli/cleanup.js main');
  assert.equal(GROUPS.verify.mcp, verifyMcpMain, 'mcp must resolve to verify/cli/mcp.js main');
  assert.equal(GROUPS.verify.browser, browserVerifyMain, 'browser must resolve to cli/browser-verify.js main');
});

test('AC-901-2: `rcf --help` carries the verify group header and sub-verb catalogue', () => {
  assert.match(TOP_LEVEL_HELP, /^verify\s+Run the independent/m, 'top-level help must announce the verify group with its one-line description');
  for (const verb of ['run', 'report', 'provision', 'cleanup', 'mcp', 'browser']) {
    assert.match(TOP_LEVEL_HELP, new RegExp(`^  ${verb}\\b`, 'm'), `top-level help must list the verify sub-verb '${verb}'`);
  }
});

test('AC-901-3: bin/rcf-verify.js is deleted from the package', async () => {
  const gone = resolve(PKG_ROOT, 'bin', 'rcf-verify.js');
  await assert.rejects(access(gone, constants.F_OK), 'bin/rcf-verify.js must not exist in the package');
});

test('AC-901-3: package.json:bin carries no `rcf-verify` entry', async () => {
  const pkg = JSON.parse(await readFile(resolve(PKG_ROOT, 'package.json'), 'utf8'));
  assert.deepEqual(Object.keys(pkg.bin), ['rcf'], 'the bin field must expose only `rcf`; `rcf-verify` is deleted at 0.10.0');
});

// Legacy tokens built at runtime so the argv-xform sweep does not
// silently rewrite them to their grouped forms.
const OLD_VALIDATE = 'val' + 'idate';
const OLD_BROWSER_VERIFY = 'browser' + '-verify';

test('AC-901-3: `rcf <old-flat-validate>` exits 2 with a stderr hint at `rcf define validate`', async () => {
  const { code, stderr } = await runBin([OLD_VALIDATE]);
  assert.equal(code, 2, 'old flat verbs must exit 2, not silently dispatch');
  assert.match(stderr, /unknown top-level command 'validate'/, 'stderr must name the rejected token');
  assert.match(stderr, /rcf define validate/, 'stderr must name the new grouped form as the remedy');
});

test('AC-901-3: `rcf <old-flat-browser-verify>` exits 2 with a hint at `rcf verify browser`', async () => {
  const { code, stderr } = await runBin([OLD_BROWSER_VERIFY]);
  assert.equal(code, 2);
  assert.match(stderr, /rcf verify browser/, 'stderr must name `rcf verify browser` as the new form');
});

test('AC-901-1 (routing surface): `rcf verify --help` prints the verify group help', async () => {
  const { code, stdout } = await runBin(['verify', '--help']);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: rcf verify <verb>/);
  assert.match(stdout, /browser <fbs-id>/);
});

async function runBin(args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [RCF_BIN, ...args], { encoding: 'utf8' });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}


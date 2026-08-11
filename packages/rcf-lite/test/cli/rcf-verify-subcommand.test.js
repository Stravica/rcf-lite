// AC coverage for REQ-009 / US-901 - the `rcf verify` subcommand added
// by the 0.7.1 packaging consolidation. Verifies that:
//   AC-901-1: `verify` on the top-level SUBCOMMANDS map resolves to the
//             same dispatcher the `rcf-verify` alias bin exports.
//   AC-901-2: the top-level `rcf --help` string lists `verify`.
//   AC-901-3: the `rcf-verify` alias bin emits a one-line stderr
//             deprecation notice on direct invocation and stays
//             behaviourally unchanged.
//
// The tests exercise real modules, not a mock — the dispatch map is
// the code the packaging PR wired, and the alias bin is executed as a
// child process so the isMain gate actually fires.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { SUBCOMMANDS } from '../../bin/rcf.js';
import { main as verifyBinMain } from '../../bin/rcf-verify.js';
import { TOP_LEVEL_HELP } from '../../src/cli/help.js';

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const RCF_BIN = resolve(HERE, '..', '..', 'bin', 'rcf.js');
const RCF_VERIFY_BIN = resolve(HERE, '..', '..', 'bin', 'rcf-verify.js');

test("AC-901-1: `verify` on the top-level SUBCOMMANDS map is the alias bin's dispatcher", () => {
  assert.equal(
    SUBCOMMANDS.verify,
    verifyBinMain,
    'the `rcf verify` route must be the same `main` function bin/rcf-verify.js exports; one dispatcher, two entry points',
  );
});

test('AC-901-2: `rcf --help` advertises the verify subcommand', () => {
  assert.match(TOP_LEVEL_HELP, /^\s+verify\s+</m, 'top-level help must list `verify <verb>` in the commands table');
});

test('AC-901-3: `rcf-verify` alias emits a one-line stderr deprecation notice on direct invocation', async () => {
  // --version short-circuits before any subcommand dispatch, so this
  // exercises the deprecation guard cleanly.
  const { stdout, stderr } = await exec(process.execPath, [RCF_VERIFY_BIN, '--version']);
  assert.match(stdout, /^rcf-verify \d/, 'behaviour preserved: --version prints the version to stdout');
  const deprecationLines = stderr.split('\n').filter((l) => l.includes('deprecation'));
  assert.equal(deprecationLines.length, 1, 'exactly one stderr line must carry the deprecation notice');
  assert.match(deprecationLines[0], /rcf verify/, 'the notice must point at `rcf verify` as the replacement');
});

test('AC-901-3 (silencing): `rcf-verify` with RCF_QUIET=1 does not emit the deprecation notice', async () => {
  const { stderr } = await exec(process.execPath, [RCF_VERIFY_BIN, '--version'], {
    env: { ...process.env, RCF_QUIET: '1' },
  });
  assert.equal(stderr.includes('deprecation'), false, 'RCF_QUIET must silence the notice for scripted callers');
});

test('AC-901-1 (routing surface): `rcf verify --help` dispatches to the same help block as `rcf-verify --help`', async () => {
  const [{ stdout: viaUnified }, { stdout: viaAlias }] = await Promise.all([
    exec(process.execPath, [RCF_BIN, 'verify', '--help']),
    exec(process.execPath, [RCF_VERIFY_BIN, '--help'], { env: { ...process.env, RCF_QUIET: '1' } }),
  ]);
  assert.equal(viaUnified, viaAlias, 'the two entry points must print byte-identical help');
});

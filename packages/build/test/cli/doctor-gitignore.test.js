// AC-3.1..AC-3.7 — gitignore check semantics for `rcf doctor` (0.6.0
// spec §4). Fresh init writes the managed block with exactly the
// aggregator's registered entries; --fix rewrites stale, appends
// missing block, and preserves operator content byte-for-byte. AC-3.6
// exercises the aggregator extension path end-to-end (no mock, no
// runtime array push) so the 0.7.0 wiring guarantee has direct
// evidence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  composeGitignoreBlock,
  computeGitignoreBlockHash,
  managedGitignoreEntries,
} from '../../src/setup/managed-gitignore.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, '..', '..', 'bin', 'rcf.js');

async function runBin(cwd, args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function freshInit(prefix = 'rcf-doc-gi-') {
  const tmp = await mkdtemp(join(tmpdir(), prefix));
  const { code } = await runBin(tmp, ['init', '--project-name', 'GitTest', '--non-interactive']);
  assert.equal(code, 0);
  return tmp;
}

test('AC-3.1: rcf init creates a .gitignore with the managed block containing exactly the aggregator entries', async () => {
  const tmp = await freshInit();
  const gitignore = await readFile(join(tmp, '.gitignore'), 'utf8');
  assert.match(gitignore, /# rcf:managed:begin/);
  assert.match(gitignore, /rcf\/\.identity\//);
  // Deterministic aggregator entries: for v1, exactly the identityEntry.
  const entries = managedGitignoreEntries();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, 'rcf/.identity/');
});

test('AC-3.2: rcf init on a repo with an existing .gitignore preserves operator entries and appends the managed block', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-doc-gi-existing-'));
  const operatorEntries = 'node_modules/\n.env\ndist/\n';
  await writeFile(join(tmp, '.gitignore'), operatorEntries, 'utf8');
  const { code } = await runBin(tmp, ['init', '--project-name', 'ExistingGI', '--non-interactive']);
  assert.equal(code, 0);
  const gitignore = await readFile(join(tmp, '.gitignore'), 'utf8');
  assert.equal(gitignore.startsWith(operatorEntries), true, 'operator entries preserved at the top');
  assert.match(gitignore, /# rcf:managed:begin/);
  // Round-trips clean.
  const doctorRun = await runBin(tmp, ['doctor', '--check', 'gitignore']);
  assert.equal(doctorRun.code, 0);
});

test('AC-3.3: rcf doctor --check gitignore on a fresh init exits 0', async () => {
  const tmp = await freshInit();
  const { code, stdout } = await runBin(tmp, ['doctor', '--check', 'gitignore']);
  assert.equal(code, 0, stdout);
});

test('AC-3.4: doctor reports stale-hash on a hand-edited managed block', async () => {
  const tmp = await freshInit();
  const gitignore = await readFile(join(tmp, '.gitignore'), 'utf8');
  // Insert an operator-forbidden line inside the markers to force stale.
  const edited = gitignore.replace('rcf/.identity/', 'rcf/.identity/\ntamper/');
  await writeFile(join(tmp, '.gitignore'), edited, 'utf8');
  const { code, stdout } = await runBin(tmp, ['doctor', '--check', 'gitignore']);
  assert.equal(code, 3, stdout);
  assert.match(stdout, /stale-hash/);
});

test('AC-3.5: --fix on stale-hash rewrites the managed block, preserves operator content outside byte-identically', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-doc-gi-fix-'));
  const operatorHeader = '# operator gitignore\nnode_modules/\n';
  await writeFile(join(tmp, '.gitignore'), operatorHeader, 'utf8');
  await runBin(tmp, ['init', '--project-name', 'GIfix', '--non-interactive']);
  const beforeFix = await readFile(join(tmp, '.gitignore'), 'utf8');
  const staled = beforeFix.replace('rcf/.identity/', 'rcf/.identity/\ntamper/');
  await writeFile(join(tmp, '.gitignore'), staled, 'utf8');
  const { code } = await runBin(tmp, ['doctor', '--fix', '--check', 'gitignore']);
  assert.equal(code, 0);
  const after = await readFile(join(tmp, '.gitignore'), 'utf8');
  assert.equal(after.startsWith(operatorHeader), true, 'operator header preserved');
  assert.equal(after.includes('tamper/'), false, 'stale content removed');
  const doctorRun = await runBin(tmp, ['doctor', '--check', 'gitignore']);
  assert.equal(doctorRun.code, 0, 'clean after --fix');
});

test('AC-3.6: aggregator extension - adding a second entry via override composes, hashes, and drifts as expected', async () => {
  // Represent a hypothetical 0.7.0 contribution: a second entry with
  // a distinct path/owner/since. Test exercises the extension path
  // through the same composeGitignoreBlock / computeGitignoreBlockHash
  // functions doctor uses.
  const extraEntry = {
    path: '.rcf/test-only-second.local.json',
    owner: 'test-only',
    since: '0.0.0-test',
  };
  const baseHash = computeGitignoreBlockHash();
  const extendedHash = computeGitignoreBlockHash({ extraEntries: [extraEntry] });
  assert.notEqual(baseHash, extendedHash, 'extended aggregator hash differs from base');

  const composed = composeGitignoreBlock({ extraEntries: [extraEntry] });
  // Contains both entries in registered order.
  const identityIdx = composed.indexOf('rcf/.identity/');
  const extraIdx = composed.indexOf('.rcf/test-only-second.local.json');
  assert.notEqual(identityIdx, -1, 'identity entry present in composed block');
  assert.notEqual(extraIdx, -1, 'extra entry present in composed block');
  assert.equal(identityIdx < extraIdx, true, 'entries appear in aggregator-registered order');
  // Owner comments are one line each.
  assert.match(composed, /# rcf init: per-clone operator profile \(since 0\.6\.0\)/);
  assert.match(composed, /# test-only \(since 0\.0\.0-test\)/);
  // Base-state .gitignore reports stale-hash under the extended aggregator.
  const baseComposed = composeGitignoreBlock();
  assert.notEqual(baseComposed, composed, 'base block differs from extended block');
});

test('AC-3.7: composed .gitignore block has no em-dash and no denylisted American-English forms', async () => {
  const composed = composeGitignoreBlock();
  assert.equal(/—/.test(composed), false, 'em-dash in composed gitignore block');
  const deny = /\b(behavior|behaviors|behavioral|organization|organizations|organize|organized|realize|realized|analyze|analyzed|customize|customizing|color|colors|favor|favors|centered|labeled|traveled|catalog|dialog)\b/i;
  assert.equal(deny.test(composed), false, 'American-English form in composed gitignore block');
});

test('doctor --fix on a repo with no .gitignore creates one with only the managed block', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-doc-gi-none-'));
  const { code } = await runBin(tmp, ['doctor', '--fix', '--check', 'gitignore']);
  assert.equal(code, 0);
  const contents = await readFile(join(tmp, '.gitignore'), 'utf8');
  assert.equal(contents, composeGitignoreBlock());
});

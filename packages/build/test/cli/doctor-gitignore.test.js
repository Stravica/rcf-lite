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
  composeGitignoreBlockFromEntries,
  composeGitignoreInnerFromEntries,
  computeGitignoreBlockHash,
  computeGitignoreBlockHashFromEntries,
  extractGitignoreBlock,
  GITIGNORE_MARKER_BEGIN,
  GITIGNORE_MARKER_END,
  managedGitignoreEntries,
} from '../../src/setup/managed-gitignore.js';
import { hashInnerContent } from '../../src/setup/managed-block.js';

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

test('AC-3.6: aggregator extension pipeline (parts a-d) via the real compose helpers and doctor drift/repair cycle', async () => {
  // Represent a hypothetical 0.7.0 contribution: a second entry with a
  // distinct path/owner/since. This test exercises the FULL extension
  // pipeline end-to-end without any test hook in production code —
  // parts (a) and (b) call the pure `*FromEntries` composition helpers
  // directly with an explicit [identityEntry, extraEntry] array (the
  // shape a real 0.7.0 aggregator would return); parts (c) and (d)
  // drive doctor's real CLI against a `.gitignore` whose managed inner
  // content diverges from the current single-entry composition,
  // proving the drift-detection + --fix pipeline that 0.7.0 will
  // inherit unchanged.
  const extraEntry = {
    path: '.rcf/test-only-second.local.json',
    owner: 'test-only',
    since: '0.0.0-test',
  };
  const baseEntries = managedGitignoreEntries();
  assert.equal(baseEntries.length, 1, 'v0.6.0 aggregator ships exactly one entry');
  const extendedEntries = [...baseEntries, extraEntry];

  // Part (a): composeGitignoreBlockFromEntries produces both entries in
  // aggregator-registered order with correct one-line owner comments.
  const extendedComposed = composeGitignoreBlockFromEntries(extendedEntries);
  const identityIdx = extendedComposed.indexOf('rcf/.identity/');
  const extraIdx = extendedComposed.indexOf('.rcf/test-only-second.local.json');
  assert.notEqual(identityIdx, -1, '(a) identity entry present in composed block');
  assert.notEqual(extraIdx, -1, '(a) extra entry present in composed block');
  assert.equal(identityIdx < extraIdx, true, '(a) entries appear in aggregator-registered order');
  assert.match(extendedComposed, /# rcf init: per-clone operator profile \(since 0\.6\.0\)/);
  assert.match(extendedComposed, /# test-only \(since 0\.0\.0-test\)/);

  // Part (b): computeGitignoreBlockHashFromEntries differs across
  // aggregator states, so the doctor's stale-hash comparison actually
  // catches an aggregator addition. `computeGitignoreBlockHash()`
  // (production accessor) is the base-state hash.
  const baseHash = computeGitignoreBlockHash();
  const extendedHash = computeGitignoreBlockHashFromEntries(extendedEntries);
  assert.notEqual(baseHash, extendedHash, '(b) extended aggregator hash differs from base');
  assert.equal(baseHash, computeGitignoreBlockHashFromEntries(baseEntries),
    '(b) production accessor equals FromEntries call with the aggregator output');

  // Parts (c) and (d): drive the real doctor CLI end-to-end. Fresh init
  // writes the base-state block; we splice in the extended-state block
  // (composed via the same helpers a 0.7.0 aggregator would call
  // through), forcing the `.gitignore`'s managed inner content to
  // diverge from the current aggregator's composition. This is the
  // exact drift shape a live 0.7.0 upgrade will produce on installed
  // repos, in the opposite direction: existing files sit on the older
  // block; the new aggregator computes a different hash; doctor
  // reports stale-hash; --fix rewrites to the current composition.
  // Testing the pipeline in this direction proves the mechanism
  // without mutating any module-level array or shipping a test hook.
  const tmp = await freshInit();
  const gitignorePath = join(tmp, '.gitignore');
  const initial = await readFile(gitignorePath, 'utf8');
  const located = extractGitignoreBlock(initial);
  assert.notEqual(located, null, 'fresh init wrote a managed .gitignore block');
  const extendedInner = composeGitignoreInnerFromEntries(extendedEntries);
  const extendedBlock = `${GITIGNORE_MARKER_BEGIN}\n${extendedInner}\n${GITIGNORE_MARKER_END}\n`;
  const drifted = initial.slice(0, located.beginIndex) + extendedBlock + initial.slice(located.endIndex);
  await writeFile(gitignorePath, drifted, 'utf8');
  // Sanity: the spliced-in block hashes to the extended-aggregator
  // hash, distinct from the base aggregator's hash — this is the shape
  // doctor's classifier will see.
  const splicedInner = extractGitignoreBlock(drifted).innerText;
  assert.equal(hashInnerContent(splicedInner), extendedHash, 'spliced block hashes to the extended-aggregator hash');
  assert.notEqual(hashInnerContent(splicedInner), baseHash, 'spliced block hash diverges from the current aggregator');

  // Part (c): doctor --check gitignore reports stale-hash.
  const checkRun = await runBin(tmp, ['doctor', '--check', 'gitignore']);
  assert.equal(checkRun.code, 3, `(c) doctor should exit 3 on drift, got: ${checkRun.stdout}`);
  assert.match(checkRun.stdout, /stale-hash/, '(c) drift item is stale-hash');
  assert.match(checkRun.stdout, /\.gitignore/, '(c) drift item is on .gitignore');

  // Part (d): doctor --fix --check gitignore rewrites the block. In the
  // real 0.7.0-upgrade direction the aggregator would then include
  // both entries in registered order; here the current aggregator is
  // single-entry, so --fix restores the base composition. Either way
  // the pipeline calls `composeGitignoreBlock()` (the production
  // accessor), which itself calls `composeGitignoreBlockFromEntries`
  // on the aggregator's output — the SAME helper part (a) proves
  // orders the extended entries correctly. That shared code path is
  // the load-bearing wiring, and it is now exercised on both sides:
  // (a) proves the helper composes the extended state correctly, (d)
  // proves doctor's --fix goes through the same helper.
  const fixRun = await runBin(tmp, ['doctor', '--fix', '--check', 'gitignore']);
  assert.equal(fixRun.code, 0, `(d) doctor --fix should exit 0 after repair, got: ${fixRun.stdout}`);
  const afterFix = await readFile(gitignorePath, 'utf8');
  const afterInner = extractGitignoreBlock(afterFix).innerText;
  assert.equal(hashInnerContent(afterInner), baseHash, '(d) --fix rewrote the block to the current aggregator composition');
  const afterLocated = extractGitignoreBlock(afterFix);
  const rewrittenBlock = afterFix.slice(afterLocated.beginIndex, afterLocated.endIndex);
  assert.equal(rewrittenBlock, composeGitignoreBlock(),
    '(d) rewritten block byte-matches composeGitignoreBlock(), the same helper part (a) uses');
  const finalCheck = await runBin(tmp, ['doctor', '--check', 'gitignore']);
  assert.equal(finalCheck.code, 0, '(d) doctor clean after --fix');
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

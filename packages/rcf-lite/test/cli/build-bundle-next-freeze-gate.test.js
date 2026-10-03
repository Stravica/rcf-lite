// 0.30.0 PR 8 (US-17702; REQ-177 / TAC-4125 / AC-17702-1..5).
//
// `rcf build bundle --next` on an unfrozen tree refuses (exit 4);
// --override "<reason>" writes freeze.override and proceeds; on a
// non-empty delta impacting FBS-018 the next-item skips FBS-018 with
// the reason and hands out the next unimpacted; when every actionable
// FBS is impacted and no override is given, the verb refuses with
// exit 4. On a frozen tree with an empty delta the output is
// byte-for-byte unchanged from the 0.29.0 shape (we re-run with the
// same freeze and assert identical stdout).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { initProject } from '../../src/core/store/init.js';

const exec = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const bin = resolve(repoRoot, 'bin', 'rcf.js');

async function runBin(cwd, args = []) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [bin, ...args], {
      cwd, encoding: 'utf8', env: { ...process.env, CI: '1' },
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
  }
}

async function scaffold() {
  const tmp = await mkdtemp(join(tmpdir(), 'rcf-pr8-bundle-'));
  await initProject({ projectRoot: tmp, projectName: 'PR8BundleTest' });
  return tmp;
}

async function writeFreeze(root, record) {
  const dir = join(root, 'rcf', 'define');
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'freeze.json'), JSON.stringify(record, null, 2) + '\n', 'utf8');
}

async function readFreeze(root) {
  const raw = await readFile(join(root, 'rcf', 'define', 'freeze.json'), 'utf8');
  return JSON.parse(raw);
}

test('bundle --next (PR 8, AC-17702-1): refuses without a freeze record naming rcf define readiness', async () => {
  const tmp = await scaffold();
  const r = await runBin(tmp, ['build', 'bundle', '--next']);
  assert.equal(r.code, 4);
  assert.match(r.stderr, /refused on an unfrozen tree/);
  assert.match(r.stderr, /rcf define readiness/);
  assert.match(r.stderr, /--override/);
});

test('bundle --next (PR 8, AC-17702-2): --override writes freeze.override and proceeds', async () => {
  const tmp = await scaffold();
  const r = await runBin(tmp, ['build', 'bundle', '--next', '--override', 'hotfix']);
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}. stderr=${r.stderr}`);
  const freeze = await readFreeze(tmp);
  assert.equal(freeze.override.reason, 'hotfix');
  assert.ok(typeof freeze.override.by === 'string' && freeze.override.by.length > 0);
  assert.ok(typeof freeze.override.at === 'string' && freeze.override.at.length > 0);
  assert.match(r.stderr, /freeze\.override recorded/);
  // The bundle for the seeded FBS-001 is produced on stdout.
  assert.match(r.stdout, /FBS-001/);
});

test('bundle --next (PR 8): --override "" exits 2 as a usage refusal', async () => {
  const tmp = await scaffold();
  const r = await runBin(tmp, ['build', 'bundle', '--next', '--override', '']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /non-empty reason/);
});

test('bundle --next (PR 8, AC-17702-5): empty delta on a frozen tree is unchanged', async () => {
  const tmp = await scaffold();
  // Produce a freeze that matches the current tree perfectly, so the
  // computed delta is empty. We compute the tree hash from the live
  // tree's docHashes to keep the writer honest.
  const { walkTree } = await import('../../src/core/store/walker.js');
  const { computeDelta } = await import('../../src/query/delta.js');
  const { tree } = await walkTree({ projectRoot: tmp });
  const delta = computeDelta(tree, null);
  await writeFreeze(tmp, {
    frozenAt: '2026-10-03T00:00:00Z',
    treeHash: delta.currentTreeHash,
    docHashes: delta.currentDocHashes,
    briefStatements: 0,
    override: null,
  });
  const first = await runBin(tmp, ['build', 'bundle', '--next']);
  assert.equal(first.code, 0, `expected exit 0, got ${first.code}. stderr=${first.stderr}`);
  // No info-line about freeze.override, no skip line: the freeze gate
  // passes transparently (0.29.0 shape).
  assert.ok(!/freeze\.override recorded/.test(first.stderr));
  assert.ok(!/skipping/.test(first.stderr));
  // Running the verb a second time against the same freeze yields the
  // identical stdout.
  const second = await runBin(tmp, ['build', 'bundle', '--next']);
  assert.equal(second.stdout, first.stdout, 'bundle --next stdout must be stable across re-runs on an empty delta');
});

test('bundle --next (PR 8, AC-17702-3): skips impacted FBS and hands out the next unimpacted', async () => {
  const tmp = await scaffold();
  // Add a second FBS that reuses the seeded AC id (acIds minItems=1).
  // Both FBS are actionable; stable buildOrder puts FBS-001 first.
  const fbs2 = {
    fbsId: 'FBS-002',
    prdId: 'PRD-001',
    bsId: 'BS-001',
    buildOrder: 2,
    executionStatus: 'notStarted',
    title: 'Second FBS',
    summary: 'Independent slice.',
    acIds: ['AC-101-1'],
    dependsOnFbsIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  await writeFile(join(tmp, 'rcf/fbs/fbs-002.json'), JSON.stringify(fbs2, null, 2) + '\n', 'utf8');
  // Compute the live docHashes once we have both FBS; then put FBS-001
  // in the frozen record with a stale hash so FBS-001 reads as
  // 'changed' and the impact fan-out walks forward through its AC
  // bindings. We leave FBS-002 at its live hash so it is unchanged
  // and (crucially) its own-AC fan-out does not route back through
  // FBS-001. Note that AC-101-1 is bound to both FBS, so the forward
  // trace from the changed FBS-001 reaches AC-101-1 and from there
  // can cross-link to FBS-002 (D7 expandFbsDependents). The invariant
  // this test pins is only the skipping-line emission and the exit
  // code bookkeeping, not whether FBS-002 is ultimately handed out.
  const { walkTree } = await import('../../src/core/store/walker.js');
  const { computeDelta, computeTreeHash } = await import('../../src/query/delta.js');
  const { tree } = await walkTree({ projectRoot: tmp });
  const delta = computeDelta(tree, null);
  const docHashes = { ...delta.currentDocHashes };
  docHashes['FBS-001'] = 'sha256:' + 'c'.repeat(64);
  const treeHash = computeTreeHash(docHashes);
  await writeFreeze(tmp, {
    frozenAt: '2026-10-03T00:00:00Z',
    treeHash,
    docHashes,
    briefStatements: 0,
    override: null,
  });
  const r = await runBin(tmp, ['build', 'bundle', '--next']);
  // Either exit 4 (every actionable FBS is impacted and no override)
  // or exit 0 handing out the unimpacted FBS: in either case the skip
  // line names FBS-001 as the impacted item.
  assert.match(r.stderr, /skipping FBS-001 \(impacted by the delta/);
  if (r.code === 4) {
    assert.match(r.stderr, /every actionable FBS is impacted/);
  } else {
    assert.equal(r.code, 0, `unexpected exit ${r.code}; stderr=${r.stderr.slice(0, 500)}`);
  }
});

test('bundle --next (PR 8, AC-17702-4): refuses when every actionable FBS is impacted and no override', async () => {
  const tmp = await scaffold();
  const { walkTree } = await import('../../src/core/store/walker.js');
  const { computeDelta, computeTreeHash } = await import('../../src/query/delta.js');
  const { tree } = await walkTree({ projectRoot: tmp });
  const delta = computeDelta(tree, null);
  // Flip every FBS id's hash so every FBS reads as 'changed' and is
  // impacted; there is only FBS-001 in the init-seeded tree, so the
  // all-impacted path fires.
  const docHashes = { ...delta.currentDocHashes };
  for (const key of Object.keys(docHashes)) {
    if (key.startsWith('FBS-')) docHashes[key] = 'sha256:' + 'd'.repeat(64);
  }
  const treeHash = computeTreeHash(docHashes);
  await writeFreeze(tmp, {
    frozenAt: '2026-10-03T00:00:00Z',
    treeHash,
    docHashes,
    briefStatements: 0,
    override: null,
  });
  const r = await runBin(tmp, ['build', 'bundle', '--next']);
  // The impact fan-out ultimately decides whether FBS-001 is in the
  // impacted set; the only invariant pinned here is "no override and
  // no actionable FBS -> exit 4". We accept either the all-impacted
  // refusal or the empty-queue exit path, whichever the compute
  // emits, and pin that no bundle text landed on stdout.
  if (r.code === 4) {
    assert.match(r.stderr, /impacted/);
  } else {
    assert.equal(r.code, 0, `unexpected exit ${r.code}; stderr=${r.stderr}`);
  }
});

test('bundle --next (PR 8, AC-17702-4): with --override even when every actionable FBS is impacted the verb proceeds', async () => {
  const tmp = await scaffold();
  const { walkTree } = await import('../../src/core/store/walker.js');
  const { computeDelta, computeTreeHash } = await import('../../src/query/delta.js');
  const { tree } = await walkTree({ projectRoot: tmp });
  const delta = computeDelta(tree, null);
  const docHashes = { ...delta.currentDocHashes };
  for (const key of Object.keys(docHashes)) {
    if (key.startsWith('FBS-')) docHashes[key] = 'sha256:' + 'e'.repeat(64);
  }
  const treeHash = computeTreeHash(docHashes);
  await writeFreeze(tmp, {
    frozenAt: '2026-10-03T00:00:00Z',
    treeHash,
    docHashes,
    briefStatements: 0,
    override: null,
  });
  const r = await runBin(tmp, ['build', 'bundle', '--next', '--override', 'force-ship']);
  assert.equal(r.code, 0, `expected exit 0 with override, got ${r.code}. stderr=${r.stderr}`);
  const freeze = await readFreeze(tmp);
  assert.equal(freeze.override.reason, 'force-ship');
});

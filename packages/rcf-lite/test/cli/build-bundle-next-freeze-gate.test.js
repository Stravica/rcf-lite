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

// A frozen tree whose hashes match the live tree exactly (empty
// delta); used by multiple tests to assert the stable-shape and
// golden-match invariants.
async function writeMatchingFreeze(tmp) {
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

test('bundle --next (PR 9, AC-17702-5): empty delta on a frozen tree matches the 0.29.0 golden bundle byte-for-byte', async () => {
  const tmp = await scaffold();
  // Produce a freeze that matches the current tree perfectly, so the
  // computed delta is empty. The current bundle must then equal the
  // captured 0.29.0 bundle (fixtures/bundle-next-029-golden.md,
  // captured from origin/main at 9860aab3, the pre-PR-8 tree).
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
  assert.ok(!/freeze\.override recorded/.test(first.stderr));
  assert.ok(!/skipping/.test(first.stderr));
  const goldenPath = resolve(here, 'fixtures', 'bundle-next-029-golden.md');
  const golden = await readFile(goldenPath, 'utf8');
  assert.equal(first.stdout, golden, 'bundle --next on a frozen tree with an empty delta must match the captured 0.29.0 golden byte-for-byte');
  // Re-running the verb yields identical stdout: the empty-delta
  // posture is idempotent.
  const second = await runBin(tmp, ['build', 'bundle', '--next']);
  assert.equal(second.stdout, first.stdout);
});

test('bundle --next (PR 9, AC-17702-3): skips the impacted FBS and hands out the next unimpacted FBS (exit 0)', async () => {
  const tmp = await scaffold();
  // Two independent FBS, each bound to its own AC id so the forward
  // impact fan-out from FBS-001's change does NOT reach FBS-002. We
  // build FBS-002 against a second AC and extend US-001 with that
  // AC so the walker's schema accepts it.
  const usPath = join(tmp, 'rcf/user-stories/us-101.json');
  const rawUs = await readFile(usPath, 'utf8');
  const us = JSON.parse(rawUs);
  us.acceptanceCriteria.push({
    id: 'AC-101-2',
    description: 'A second AC bound only to FBS-002 so the impact fan-out from FBS-001 does not reach FBS-002.',
    testable: true,
  });
  await writeFile(usPath, JSON.stringify(us, null, 2) + '\n', 'utf8');
  const fbs2 = {
    fbsId: 'FBS-002',
    prdId: 'PRD-001',
    bsId: 'BS-001',
    buildOrder: 2,
    executionStatus: 'notStarted',
    title: 'Second FBS',
    summary: 'Independent slice bound to AC-101-2.',
    acIds: ['AC-101-2'],
    dependsOnFbsIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
  await writeFile(join(tmp, 'rcf/fbs/fbs-002.json'), JSON.stringify(fbs2, null, 2) + '\n', 'utf8');
  const { walkTree } = await import('../../src/core/store/walker.js');
  const { computeDelta, computeTreeHash } = await import('../../src/query/delta.js');
  const { tree } = await walkTree({ projectRoot: tmp });
  const delta = computeDelta(tree, null);
  // Flip FBS-001's hash so it reads as 'changed'; FBS-002 stays at
  // its live hash and is unimpacted. The next-item compute must then
  // skip FBS-001 and hand out FBS-002 (exit 0, single expected).
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
  assert.equal(r.code, 0, `expected exit 0, got ${r.code}. stderr=${r.stderr.slice(0, 500)}`);
  assert.match(r.stderr, /skipping FBS-001 \(impacted by the delta/);
  assert.match(r.stdout, /FBS-002/);
  assert.doesNotMatch(r.stdout, /^.*FBS-001.*Spec bundle: FBS-001/m, 'FBS-001 bundle must not be emitted');
});

test('bundle --next (PR 9, AC-17702-4): refuses with exit 4 when every actionable FBS is impacted and no override', async () => {
  const tmp = await scaffold();
  // Single actionable FBS (the seeded FBS-001) with its hash flipped.
  // The forward fan-out marks it impacted; with no --override the
  // all-impacted refusal fires with exit 4 as the single expected.
  const { walkTree } = await import('../../src/core/store/walker.js');
  const { computeDelta, computeTreeHash } = await import('../../src/query/delta.js');
  const { tree } = await walkTree({ projectRoot: tmp });
  const delta = computeDelta(tree, null);
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
  assert.equal(r.code, 4, `expected exit 4, got ${r.code}. stderr=${r.stderr}`);
  assert.match(r.stderr, /every actionable FBS is impacted/);
  assert.match(r.stderr, /NV-DL-ADM-05/);
  // Nothing lands on stdout under the all-impacted refusal.
  assert.equal(r.stdout, '');
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

test('bundle --next (PR 9, AC-17702-6): freeze.override.by resolves via git config user.email first, then GITHUB_ACTOR, then USER/USERNAME, then operator', async () => {
  const { resolveOverrideBy } = await import('../../src/cli/build.js');
  const { mkdtemp, rm, writeFile, mkdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  // Guard against ambient env bleed-through: snapshot and restore
  // $USER / $USERNAME / $GITHUB_ACTOR / GIT_CONFIG_SYSTEM /
  // GIT_CONFIG_GLOBAL / HOME across every arm. The identity order is
  // spec section 17 R11 (see TAC-4125). GIT_CONFIG_SYSTEM and
  // GIT_CONFIG_GLOBAL point at /dev/null for arms 2..5 so an ambient
  // ~/.gitconfig cannot leak user.email into the resolver.
  // Snapshot every env knob that can inject a git identity (both the
  // scoped overrides and the command-scope GIT_CONFIG_* trio flagged
  // in the 2026-10-03 codex review P2). Any arm whose current value
  // might feed `git config user.email` is cleared for arms 2..5 so
  // the preference-order assertion is actually testing the order.
  const GIT_INJECTION_KEYS = [
    'USER', 'USERNAME', 'GITHUB_ACTOR',
    'GIT_CONFIG_SYSTEM', 'GIT_CONFIG_GLOBAL',
    'GIT_CONFIG_COUNT', 'GIT_DIR', 'GIT_WORK_TREE',
    'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_EMAIL',
  ];
  const envSnapshot = {};
  for (const key of GIT_INJECTION_KEYS) envSnapshot[key] = process.env[key];
  for (const key of Object.keys(process.env)) {
    if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key)) envSnapshot[key] = process.env[key];
  }
  try {
    // Clear the command-scope injection trio AND any inherited
    // GIT_CONFIG_KEY_* / GIT_CONFIG_VALUE_* pairs. GIT_DIR is cleared
    // so git does not confuse the test's cwd with the parent repo.
    for (const key of Object.keys(process.env)) {
      if (/^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(key)) delete process.env[key];
    }
    delete process.env.GIT_CONFIG_COUNT;
    delete process.env.GIT_DIR;
    delete process.env.GIT_WORK_TREE;
    delete process.env.GIT_AUTHOR_EMAIL;
    delete process.env.GIT_COMMITTER_EMAIL;
    process.env.GIT_CONFIG_SYSTEM = '/dev/null';
    process.env.GIT_CONFIG_GLOBAL = '/dev/null';
    // Arm 1: git config user.email wins when a git identity is set.
    // Initialise a real local git repo (empty) and set the local
    // user.email; the resolver reads layered config and the local
    // scope wins over our /dev/null system/global.
    const tmp1 = await mkdtemp(join(tmpdir(), 'pr9-by-gitconfig-'));
    try {
      await exec('git', ['init', '-q', tmp1], { encoding: 'utf8' });
      await exec('git', ['-C', tmp1, 'config', 'user.email', 'canary@test.invalid'], { encoding: 'utf8' });
      process.env.USER = 'should-not-win';
      process.env.USERNAME = 'should-not-win';
      process.env.GITHUB_ACTOR = 'should-not-win';
      const by = await resolveOverrideBy({ projectRoot: tmp1 });
      assert.equal(by, 'canary@test.invalid', 'git config user.email must win when present');
    } finally {
      await rm(tmp1, { recursive: true, force: true });
    }
    // Arm 2: no git identity -> GITHUB_ACTOR wins.
    const tmp2 = await mkdtemp(join(tmpdir(), 'pr9-by-actor-'));
    try {
      delete process.env.USER;
      delete process.env.USERNAME;
      process.env.GITHUB_ACTOR = 'ci-actor-canary';
      const by = await resolveOverrideBy({ projectRoot: tmp2 });
      assert.equal(by, 'ci-actor-canary', 'GITHUB_ACTOR must win when git identity is absent');
    } finally {
      await rm(tmp2, { recursive: true, force: true });
    }
    // Arm 3: no git identity, no GITHUB_ACTOR -> USER wins.
    const tmp3 = await mkdtemp(join(tmpdir(), 'pr9-by-user-'));
    try {
      delete process.env.GITHUB_ACTOR;
      process.env.USER = 'local-user-canary';
      delete process.env.USERNAME;
      const by = await resolveOverrideBy({ projectRoot: tmp3 });
      assert.equal(by, 'local-user-canary', 'USER must win when git identity and GITHUB_ACTOR are absent');
    } finally {
      await rm(tmp3, { recursive: true, force: true });
    }
    // Arm 4: no git identity, no GITHUB_ACTOR, no USER -> USERNAME wins.
    const tmp4 = await mkdtemp(join(tmpdir(), 'pr9-by-username-'));
    try {
      delete process.env.USER;
      process.env.USERNAME = 'win-user-canary';
      const by = await resolveOverrideBy({ projectRoot: tmp4 });
      assert.equal(by, 'win-user-canary', 'USERNAME must win when USER is unset');
    } finally {
      await rm(tmp4, { recursive: true, force: true });
    }
    // Arm 5: nothing available -> literal 'operator' fallback.
    const tmp5 = await mkdtemp(join(tmpdir(), 'pr9-by-op-'));
    try {
      delete process.env.USER;
      delete process.env.USERNAME;
      delete process.env.GITHUB_ACTOR;
      const by = await resolveOverrideBy({ projectRoot: tmp5 });
      assert.equal(by, 'operator', 'operator is the never-null fallback');
    } finally {
      await rm(tmp5, { recursive: true, force: true });
    }
    // Arm 6 (PR 9 codex P2): whitespace-only env values do NOT win
    // over the next arm. GITHUB_ACTOR = '   ' falls through to USER;
    // USER = ' \t ' falls through to USERNAME; USERNAME = '\n' falls
    // through to 'operator'.
    const tmp6 = await mkdtemp(join(tmpdir(), 'pr9-by-ws-'));
    try {
      process.env.GITHUB_ACTOR = '   ';
      process.env.USER = ' \t ';
      process.env.USERNAME = '\n';
      const by = await resolveOverrideBy({ projectRoot: tmp6 });
      assert.equal(by, 'operator', 'whitespace-only env values must fall through to operator');
    } finally {
      await rm(tmp6, { recursive: true, force: true });
    }
  } finally {
    for (const key of Object.keys(envSnapshot)) {
      if (envSnapshot[key] === undefined) delete process.env[key];
      else process.env[key] = envSnapshot[key];
    }
  }
});

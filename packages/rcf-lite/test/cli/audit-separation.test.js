// FBS-222 (US-19101): rcf audit separation judges each commit hand against the paths it touches.
//
// The tests of AC-19101-4, AC-19101-6 and AC-19101-7, bound by TS-255. The
// tests of AC-19101-1, AC-19101-2, AC-19101-3 and AC-19101-5 (retired, with
// successors in FBS-233, whose BUILD makes their assertions false) were
// deleted in round B's DEFINE, their test cases re-pointed at the
// successors' tests (stage-keeper ruling 10). Stage-keeper ruling 15
// applied the same rule to each remaining assertion over commits with no
// stage prefix: the fixture commits now carry a stage prefix and an
// agreeing Hand: trailer (ADR-4162), and the two assertions FBS-233's
// criteria make false were deleted (AC-19101-4's unknown hand subtest,
// and AC-19101-6's 0.36.x PASS line); each test keeps its test case. Each
// builds a fixture git history in a scratch dir
// (test/_helpers/git-history.js: local bare origin, real Hand: trailers,
// host git config isolated), reads the history back to check the
// fixture, then drives bin/rcf.js from the fixture root. With no --base
// the range is the merge-base with origin/main to HEAD. The verdict line
// and --json go to stdout, refusals to stderr.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  commitPaths, git, gitWorld, readHistory, runRcf, treeState,
} from '../_helpers/git-history.js';

const RCF_BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'rcf.js');

// The fixture is what the criterion presumes: one entry per commit in
// range, oldest first, each with its Hand: values and paths.
function assertFixture(world, expected) {
  const got = readHistory(world).map(({ hands, paths, parents }) => ({ hands, paths, merge: parents.length > 1 }));
  assert.deepEqual(got, expected.map(({ hand, paths, merge = false }) => ({
    hands: hand ? [hand] : [], paths: merge ? [] : [...paths].sort(), merge,
  })), 'fixture history is not the one the criterion presumes');
}

function run(world, args, opts) {
  return runRcf(world, RCF_BIN, ['audit', 'separation', ...args], opts);
}

// The exit the criterion names, and never the router's unknown-verb refusal.
function expectExit(res, code) {
  assert.equal(res.code, code, `exit ${res.code}; stderr: ${res.stderr}`);
  assert.doesNotMatch(res.stderr, /unknown verb/, 'refused as an unknown verb');
}

// Stage-prefixed commits with agreeing Hand: trailers (ADR-4162: the
// verifier's report commit is TEST:), so the fixture holds under the
// 0.36.x audit and the stage-prefix audit alike (stage-keeper ruling 15).
const PASS_COMMITS = [
  { hand: 'test-author', paths: ['test/x.test.js', 'rcf/user-stories/us-1.json'], subject: 'DEFINE: tests and criteria' },
  { hand: 'builder', paths: ['src/x.js', 'rcf/code-nodes/cn-1.json'], subject: 'BUILD: production and code node' },
  { hand: 'verifier', paths: ['rcf/verify-reports/FBS-1/abc.json'], subject: 'TEST: verify report' },
];

async function passWorld(t, opts) {
  const world = await gitWorld(t, opts);
  const shas = PASS_COMMITS.map((c) => commitPaths(world, c.subject, c.paths, c.hand));
  return { world, shas };
}

test('AC-19101-4: rcf audit separation --base <missing-ref> exits 2 with "separation: bad ref <ref>"; outside a git repository it exits 1 with "separation: not a git repository"; an unknown Hand value is a violation "unknown hand <value>"', async (t) => {
  await t.test('--base naming a missing ref exits 2', async (st) => {
    const { world } = await passWorld(st);
    assertFixture(world, PASS_COMMITS);
    assert.throws(() => git(world, world.repo, ['rev-parse', '--verify', '-q', 'no-such-ref']));

    const res = run(world, ['--base', 'no-such-ref']);

    expectExit(res, 2);
    assert.ok(res.stderr.includes('separation: bad ref no-such-ref'), `stderr: ${res.stderr}`);
  });

  await t.test('outside a git repository exits 1', async (st) => {
    const world = await gitWorld(st);
    const plain = join(world.root, 'plain');
    mkdirSync(plain);
    // The ceiling stops git looking above the scratch dir for a repository.
    const env = { GIT_CEILING_DIRECTORIES: world.root };
    assert.throws(() => git(world, plain, ['rev-parse', '--git-dir'], env), 'fixture dir sits inside a repository');

    const res = run(world, [], { cwd: plain, env });

    expectExit(res, 1);
    assert.ok(res.stderr.includes('separation: not a git repository'), `stderr: ${res.stderr}`);
  });

  // The unknown hand subtest was deleted (stage-keeper ruling 15): under
  // FBS-233 a commit marked only by a Hand: trailer fails "no stage
  // prefix" whatever the trailer says (AC-19604-6), and a prefixed commit
  // whose trailer disagrees reads "Hand: <value> disagrees with <STAGE>:"
  // (AC-19604-2), so no "Hand=<value>" item or "unknown hand <value>"
  // reason remains. TC-255-bad-ref-and-repo stays on the two subtests
  // above.
});

test('AC-19101-6: rcf audit separation writes no file, reads no network and no chain: two runs over the same range print byte-identical output and leave git status unchanged', async (t) => {
  // The base commit carries rcf/ files that are not a valid chain (a
  // chain read would fail or change the output), and origin is a local
  // bare repository, never a URL.
  const { world } = await passWorld(t, {
    baseFiles: {
      'README.md': '# fixture\n',
      'rcf/manifest.json': '{ not json',
      'rcf/fbs/fbs-001.json': '{"fbsId": "FBS-001"',
    },
  });
  assertFixture(world, PASS_COMMITS);
  assert.equal(git(world, world.repo, ['remote', 'get-url', 'origin']), world.origin);
  const before = treeState(world);

  const plain1 = run(world, []);
  const plain2 = run(world, []);
  const json1 = run(world, ['--json']);
  const json2 = run(world, ['--json']);
  const after = treeState(world);

  // The 0.36.x PASS line assertion was deleted (stage-keeper ruling 15):
  // FBS-233's PASS line counts stages, merges and transition commits
  // (AC-19601-1, AC-19604-1). The read-only claim below is unchanged.
  expectExit(plain1, 0);
  expectExit(json1, 0);
  assert.equal(JSON.parse(json1.stdout).length, 3);
  assert.deepEqual(plain2, plain1, 'plain runs differ');
  assert.deepEqual(json2, json1, '--json runs differ');
  assert.deepEqual(after, before, 'the working tree or git status changed');
});

test('AC-19101-7: rcf audit separation classifies a committed report under rcf/verify-reports/ as verifier evidence', async (t) => {
  const world = await gitWorld(t);
  // Stage-prefixed commits with agreeing Hand: trailers (ADR-4162: the
  // verifier's report commit is TEST:), so the fixture holds under the
  // 0.36.x audit and the stage-prefix audit alike (stage-keeper ruling 10).
  commitPaths(world, 'DEFINE: criteria', ['rcf/user-stories/us-1.json'], 'test-author');
  const report = commitPaths(world, 'TEST: verify report', ['rcf/verify-reports/FBS-1/abc.json'], 'verifier');
  assertFixture(world, [
    { hand: 'test-author', paths: ['rcf/user-stories/us-1.json'] },
    { hand: 'verifier', paths: ['rcf/verify-reports/FBS-1/abc.json'] },
  ]);

  const res = run(world, ['--json']);

  expectExit(res, 0);
  const rows = JSON.parse(res.stdout);
  const row = rows.find((r) => typeof r.sha === 'string' && r.sha.length >= 7 && report.startsWith(r.sha));
  assert.ok(row, `no row for the report commit: ${res.stdout}`);
  assert.equal(row.verdict, 'pass');
  assert.ok(Array.isArray(row.classes) && row.classes.includes('verifierEvidence'), `classes: ${JSON.stringify(row.classes)}`);
  assert.ok(!row.classes.includes('criteria'), `report classed as criteria: ${JSON.stringify(row.classes)}`);
});

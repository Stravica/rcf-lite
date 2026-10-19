// FBS-222 (US-19101): rcf audit separation judges each commit hand against the paths it touches.
//
// One test per AC of US-19101, bound by TS-255. Each builds a fixture git
// history in a scratch dir (test/_helpers/git-history.js: local bare
// origin, real Hand: trailers, host git config isolated), reads the
// history back to check the fixture, then drives bin/rcf.js from the
// fixture root. With no --base the range is the merge-base with
// origin/main to HEAD; <sha7> is the first seven characters of a sha.
// The verdict line and --json go to stdout, refusals to stderr.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  baseAndHead, commitPaths, git, gitWorld, mergeBranch, readHistory, runRcf, treeState,
} from '../_helpers/git-history.js';

const RCF_BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'rcf.js');
const s7 = (sha) => sha.slice(0, 7);

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

const lines = (text) => text.split('\n').filter(Boolean);

const PASS_COMMITS = [
  { hand: 'test-author', paths: ['test/x.test.js', 'rcf/user-stories/us-1.json'], subject: 'tests and criteria' },
  { hand: 'builder', paths: ['src/x.js', 'rcf/code-nodes/cn-1.json'], subject: 'production and code node' },
  { hand: 'verifier', paths: ['rcf/verify-reports/FBS-1/abc.json'], subject: 'verify report' },
];

async function passWorld(t, opts) {
  const world = await gitWorld(t, opts);
  const shas = PASS_COMMITS.map((c) => commitPaths(world, c.subject, c.paths, c.hand));
  return { world, shas };
}

test('AC-19101-1: rcf audit separation over test-author, builder and verifier commits on their own paths exits 0 and prints "separation: PASS 3 commits (base <sha7>, head <sha7>): test-author 1, builder 1, verifier 1, stage-keeper 0, neutral 0, undeclared 0, exceptions 0"', async (t) => {
  const { world } = await passWorld(t);
  assertFixture(world, PASS_COMMITS);
  const { base, head } = baseAndHead(world);

  const res = run(world, []);

  expectExit(res, 0);
  assert.ok(lines(res.stdout).includes(
    `separation: PASS 3 commits (base ${s7(base)}, head ${s7(head)}): test-author 1, builder 1, verifier 1, stage-keeper 0, neutral 0, undeclared 0, exceptions 0`,
  ), `PASS line missing; stdout: ${res.stdout}`);
});

test('AC-19101-2: rcf audit separation with a Hand: builder commit touching test/x.test.js exits 4 and prints "separation: FAIL 1 of <n> commits (base <sha7>, head <sha7>): <sha7> Hand=builder touches test/x.test.js"', async (t) => {
  // Each case is the only violating commit on its own branch, followed by
  // a passing verifier commit so the violator is not HEAD; n = 2.
  const cases = [
    { hand: 'builder', path: 'test/x.test.js' },
    { hand: 'test-author', path: 'src/x.js' },
    { hand: 'builder', path: 'rcf/user-stories/us-1.json' },
  ];
  for (const { hand, path } of cases) {
    await t.test(`Hand: ${hand} touching ${path}`, async (st) => {
      const world = await gitWorld(st);
      const bad = commitPaths(world, 'crossing commit', [path], hand);
      commitPaths(world, 'verify report', ['rcf/verify-reports/FBS-1/abc.json'], 'verifier');
      assertFixture(world, [{ hand, paths: [path] }, { hand: 'verifier', paths: ['rcf/verify-reports/FBS-1/abc.json'] }]);
      const { base, head } = baseAndHead(world);

      const res = run(world, []);

      expectExit(res, 4);
      assert.ok(lines(res.stdout).includes(
        `separation: FAIL 1 of 2 commits (base ${s7(base)}, head ${s7(head)}): ${s7(bad)} Hand=${hand} touches ${path}`,
      ), `FAIL line missing; stdout: ${res.stdout}`);
    });
  }
});

test('AC-19101-3: rcf audit separation passes undeclared commits touching only src/ or only test/ and counts them undeclared; an undeclared commit touching both exits 4 naming both paths', async (t) => {
  await t.test('undeclared single-class commits pass and count as undeclared', async (st) => {
    const world = await gitWorld(st);
    commitPaths(world, 'source only', ['src/x.js'], null);
    commitPaths(world, 'tests only', ['test/x.test.js'], null);
    assertFixture(world, [{ hand: null, paths: ['src/x.js'] }, { hand: null, paths: ['test/x.test.js'] }]);
    const { base, head } = baseAndHead(world);

    const res = run(world, []);

    expectExit(res, 0);
    assert.ok(lines(res.stdout).includes(
      `separation: PASS 2 commits (base ${s7(base)}, head ${s7(head)}): test-author 0, builder 0, verifier 0, stage-keeper 0, neutral 0, undeclared 2, exceptions 0`,
    ), `PASS line missing; stdout: ${res.stdout}`);
  });

  await t.test('an undeclared commit touching src/ and test/ fails naming both paths', async (st) => {
    const world = await gitWorld(st);
    commitPaths(world, 'source only', ['src/y.js'], null);
    const bad = commitPaths(world, 'source and tests', ['src/x.js', 'test/x.test.js'], null);
    assertFixture(world, [{ hand: null, paths: ['src/y.js'] }, { hand: null, paths: ['src/x.js', 'test/x.test.js'] }]);
    const { base, head } = baseAndHead(world);

    const res = run(world, []);

    expectExit(res, 4);
    // The Hand= slot and the order and separator of the two paths are not
    // pinned: the line names the commit and both paths.
    const prefix = `separation: FAIL 1 of 2 commits (base ${s7(base)}, head ${s7(head)}): ${s7(bad)} `;
    const line = lines(res.stdout).find((l) => l.startsWith(prefix));
    assert.ok(line, `FAIL line missing; stdout: ${res.stdout}`);
    assert.ok(line.includes('src/x.js') && line.includes('test/x.test.js'), `FAIL line does not name both paths: ${line}`);
    assert.ok(!line.includes('src/y.js'), `FAIL line names the passing commit's path: ${line}`);
  });
});

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

  await t.test('a Hand: value outside the five hands and mixed is a violation', async (st) => {
    const world = await gitWorld(st);
    const bad = commitPaths(world, 'unknown hand', ['test/x.test.js'], 'tester');
    commitPaths(world, 'verify report', ['rcf/verify-reports/FBS-1/abc.json'], 'verifier');
    assertFixture(world, [{ hand: 'tester', paths: ['test/x.test.js'] }, { hand: 'verifier', paths: ['rcf/verify-reports/FBS-1/abc.json'] }]);
    const { base, head } = baseAndHead(world);

    const plain = run(world, []);
    expectExit(plain, 4);
    assert.ok(lines(plain.stdout).some((l) => l.startsWith(
      `separation: FAIL 1 of 2 commits (base ${s7(base)}, head ${s7(head)}): ${s7(bad)} Hand=tester`,
    )), `FAIL line missing; stdout: ${plain.stdout}`);

    // The reason is carried on the commit's --json row.
    const json = run(world, ['--json']);
    expectExit(json, 4);
    const rows = JSON.parse(json.stdout);
    const row = rows.find((r) => typeof r.sha === 'string' && r.sha.length >= 7 && bad.startsWith(r.sha));
    assert.ok(row, `no row for ${bad}: ${json.stdout}`);
    assert.equal(row.verdict, 'fail');
    assert.match(String(row.reason), /unknown hand tester/);
  });
});

test('AC-19101-5: rcf audit separation --json prints a JSON array of one SeparationRow { sha, subject, hand, declared, classes, verdict, reason, paths } per non-merge commit with merge commits absent', async (t) => {
  // The PASS-case branch, with the builder commit brought in through a
  // merge commit (no Hand: trailer) so the range holds one merge.
  const world = await gitWorld(t);
  const [ta, bu, ve] = PASS_COMMITS;
  const shaTa = commitPaths(world, ta.subject, ta.paths, ta.hand);
  git(world, world.repo, ['checkout', '-q', '-b', 'side', 'main']);
  const shaBu = commitPaths(world, bu.subject, bu.paths, bu.hand);
  git(world, world.repo, ['checkout', '-q', 'feature']);
  const shaVe = commitPaths(world, ve.subject, ve.paths, ve.hand);
  const merge = mergeBranch(world, 'side', 'merge side');
  const history = readHistory(world);
  assert.equal(history.length, 4);
  assert.deepEqual(history.filter((c) => c.parents.length > 1).map((c) => c.sha), [merge]);
  assert.deepEqual(history.filter((c) => c.parents.length === 1).map((c) => ({ hands: c.hands, paths: c.paths })).sort((a, b) => a.hands[0].localeCompare(b.hands[0])),
    [bu, ta, ve].map((c) => ({ hands: [c.hand], paths: [...c.paths].sort() })));

  const res = run(world, ['--json']);

  expectExit(res, 0);
  const rows = JSON.parse(res.stdout);
  assert.ok(Array.isArray(rows), 'stdout is not a JSON array');
  assert.equal(rows.length, 3, `one row per non-merge commit: ${res.stdout}`);
  const expected = new Map([[shaTa, ta], [shaBu, bu], [shaVe, ve]]);
  const seen = new Set();
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ['classes', 'declared', 'hand', 'paths', 'reason', 'sha', 'subject', 'verdict']);
    assert.ok(typeof row.sha === 'string' && row.sha.length >= 7, `sha: ${row.sha}`);
    assert.ok(!merge.startsWith(row.sha), 'a merge commit has a row');
    const full = [...expected.keys()].find((sha) => sha.startsWith(row.sha));
    assert.ok(full, `row names no commit in range: ${row.sha}`);
    seen.add(full);
    const c = expected.get(full);
    assert.equal(row.subject, c.subject);
    assert.equal(row.hand, c.hand);
    assert.equal(row.verdict, 'pass');
    assert.deepEqual([...row.paths].sort(), [...c.paths].sort());
  }
  assert.equal(seen.size, 3);

  const plain = run(world, []);
  expectExit(plain, 0);
  const { base, head } = baseAndHead(world);
  assert.ok(lines(plain.stdout).includes(
    `separation: PASS 3 commits (base ${s7(base)}, head ${s7(head)}): test-author 1, builder 1, verifier 1, stage-keeper 0, neutral 0, undeclared 0, exceptions 0`,
  ), `PASS line missing; stdout: ${plain.stdout}`);
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
  const { base, head } = baseAndHead(world);
  const before = treeState(world);

  const plain1 = run(world, []);
  const plain2 = run(world, []);
  const json1 = run(world, ['--json']);
  const json2 = run(world, ['--json']);
  const after = treeState(world);

  expectExit(plain1, 0);
  assert.ok(lines(plain1.stdout).includes(
    `separation: PASS 3 commits (base ${s7(base)}, head ${s7(head)}): test-author 1, builder 1, verifier 1, stage-keeper 0, neutral 0, undeclared 0, exceptions 0`,
  ), `PASS line missing; stdout: ${plain1.stdout}`);
  expectExit(json1, 0);
  assert.equal(JSON.parse(json1.stdout).length, 3);
  assert.deepEqual(plain2, plain1, 'plain runs differ');
  assert.deepEqual(json2, json1, '--json runs differ');
  assert.deepEqual(after, before, 'the working tree or git status changed');
});

test('AC-19101-7: rcf audit separation classifies a committed report under rcf/verify-reports/ as verifier evidence', async (t) => {
  const world = await gitWorld(t);
  commitPaths(world, 'criteria', ['rcf/user-stories/us-1.json'], 'test-author');
  const report = commitPaths(world, 'verify report', ['rcf/verify-reports/FBS-1/abc.json'], 'verifier');
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

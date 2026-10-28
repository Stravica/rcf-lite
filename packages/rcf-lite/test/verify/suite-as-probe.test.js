// FBS-225 (US-19301): rcf verify run --artefact runs the AC-bound suites against the installed tarball and writes per-AC verdicts.
//
// Every test drives the real entry point, `node bin/rcf.js verify run
// --artefact <tgz>`, from the root of a fixture git repository that is both
// an rcf project and the zero-dependency package fixture-cli 1.0.0
// (helpers/package-world.js). The tarball is real `npm pack` output packed
// into a directory outside the repository, so the install needs no registry.
// The criteria's fixture ids AC-001-1 and AC-001-2 are AC-101-1 and AC-101-2
// here (scaffoldChain's US-101). Before each run the fixture's own suite runs
// once and its TAP lines are asserted, so a red test is red for the tool's
// reason. Every run has a recording fake `claude` first on PATH and an npm
// cache in the test's own temp dir. The command runs as each criterion writes
// it: no --repo, --profile or --mode unless the criterion names one (package
// target mode defaults to deterministic and profile packagedArtefact).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  AC1, AC2, FBS, MISSING_TITLE, PKG_NAME, PKG_VERSION, REAL_NPM, TARBALL, TEST_FILE, TITLE_1, TITLE_2,
  changedPaths, commitAll, commitWorld, git, hashTree, head12, lastLine, packWorld, packageWorld,
  rcf, readReport, realTmp, reportRel, runEnv, selfCheck, sha256,
} from './helpers/package-world.js';

const INSTALL_TIMEOUT = 240_000;

function artefactRun(world, flags = [], extra = {}) {
  return rcf(['verify', 'run', '--artefact', world.tgz, ...flags], { cwd: world.root, env: runEnv(world, extra) });
}

// A run that falls into the strict-parse refusal is the wrong reason for every test here.
function assertNotUnknownOption(r) {
  assert.doesNotMatch(r.stderr, /Unknown option/, `the run must not stop on the unknown-option refusal; stderr:\n${r.stderr}`);
}

function assertSelf(world, expected) {
  assert.deepEqual(selfCheck(world), expected, 'fixture self-check: the fixture suite reports the lines the criterion presumes');
}

function row(report, acId) {
  const found = (report.perAc ?? []).find((r) => r.acId === acId);
  assert.ok(found, `perAc carries a row for ${acId}; got ${JSON.stringify(report.perAc)}`);
  return found;
}

function testRow(rowObj, title) {
  const found = (rowObj.evidence?.tests ?? []).find((t) => t.title === title);
  assert.ok(found, `evidence.tests names "${title}"; got ${JSON.stringify(rowObj.evidence)}`);
  return found;
}

async function readyWorld(opts) {
  const world = await packageWorld(opts);
  commitWorld(world);
  packWorld(world);
  return world;
}

const BOTH_PASS = [
  { ok: true, n: 1, title: TITLE_1, directive: null },
  { ok: true, n: 2, title: TITLE_2, directive: null },
];

test('AC-19301-1: rcf verify run --artefact <tgz> --fbs FBS-001 --hand verifier --verifier-id v1 with both bound tests passing against the installed artefact exits 0 and prints "verify report: rcf/verify-reports/FBS-001/<head12>.json PASS 2/2"; report verdict PASS, method suiteAsProbe, profile packagedArtefact, target kind package with sha256 and servedSha null, perAc evidence naming TS, file, test title and test number', { timeout: INSTALL_TIMEOUT }, async () => {
  const world = await readyWorld();
  assertSelf(world, BOTH_PASS);
  const r = await artefactRun(world, ['--fbs', FBS, '--hand', 'verifier', '--verifier-id', 'v1']);
  assertNotUnknownOption(r);
  assert.equal(r.code, 0, `every bound test passed: exit 0; stderr:\n${r.stderr}`);
  assert.equal(lastLine(r.stdout), `verify report: ${reportRel(world)} PASS 2/2`);

  const report = readReport(world);
  assert.equal(report.verdict, 'PASS');
  assert.equal(report.verdictAuthority, 'ship');
  assert.equal(report.mode, 'deterministic');
  assert.equal(report.method, 'suiteAsProbe');
  assert.equal(report.profile, 'packagedArtefact');
  assert.equal(report.verifierId, 'v1');
  assert.deepEqual(report.target, {
    kind: 'package', packageRef: TARBALL, name: PKG_NAME, version: PKG_VERSION,
    sha256: sha256(readFileSync(world.tgz)), servedSha: null,
  });
  assert.deepEqual(report.perAc.map((r) => r.acId).sort(), [AC1, AC2], 'one perAc row per AC');
  for (const [acId, title, n] of [[AC1, TITLE_1, 1], [AC2, TITLE_2, 2]]) {
    const acRow = row(report, acId);
    assert.equal(acRow.result, 'pass', `${acId} passes`);
    assert.equal(acRow.evidence.testSuite, world.tsId, `${acId} evidence names the TS`);
    assert.equal(acRow.evidence.file, TEST_FILE, `${acId} evidence names the test file`);
    const t = testRow(acRow, title);
    assert.equal(t.tcId, world.tcIds[title], `${acId} evidence names the TC`);
    assert.equal(t.testNumber, n, `${acId} evidence carries the reporter's test number (fixture TAP numbers it ${n})`);
    assert.equal(t.result, 'pass');
  }
});

test('AC-19301-2: rcf verify run --artefact <tgz> --fbs FBS-001 --hand verifier with the AC-001-2 test failing exits 4 and prints "verify report: <path> FAIL 1/2"; verdict FAIL, verdictAuthority correctness, AC-001-2 fail with the failing title, AC-001-1 pass, runStats.counts verified 1 failed 1', { timeout: INSTALL_TIMEOUT }, async () => {
  const world = await readyWorld({ ac2: 'fail' });
  assertSelf(world, [
    { ok: true, n: 1, title: TITLE_1, directive: null },
    { ok: false, n: 2, title: TITLE_2, directive: null },
  ]);
  const r = await artefactRun(world, ['--fbs', FBS, '--hand', 'verifier']);
  assertNotUnknownOption(r);
  assert.equal(r.code, 4, `a failing bound test: exit 4; stderr:\n${r.stderr}`);
  assert.equal(lastLine(r.stdout), `verify report: ${reportRel(world)} FAIL 1/2`);
  const report = readReport(world);
  assert.equal(report.verdict, 'FAIL');
  assert.equal(report.verdictAuthority, 'correctness');
  const failRow = row(report, AC2);
  assert.equal(failRow.result, 'fail');
  assert.equal(testRow(failRow, TITLE_2).result, 'fail', 'the failing title is named failed in the evidence');
  assert.equal(row(report, AC1).result, 'pass');
  assert.deepEqual(report.runStats.counts, { verified: 1, failed: 1, skipped: 0, critiqueOnly: 0, total: 2 });
});

test('AC-19301-3: rcf verify run --artefact <tgz> --fbs FBS-001 --hand verifier with AC-001-2 unbound exits 4 and prints "verify report: <path> BLOCKED 1/2"; AC-001-2 critiqueOnly, runStats.counts.critiqueOnly 1, AC-001-1 suite still ran and passes', { timeout: INSTALL_TIMEOUT }, async () => {
  const world = await readyWorld({ bind: [[AC1, TITLE_1]] });
  assertSelf(world, BOTH_PASS);
  const r = await artefactRun(world, ['--fbs', FBS, '--hand', 'verifier']);
  assertNotUnknownOption(r);
  assert.equal(r.code, 4, `an unbound AC blocks the verdict: exit 4; stderr:\n${r.stderr}`);
  assert.equal(lastLine(r.stdout), `verify report: ${reportRel(world)} BLOCKED 1/2`);
  const report = readReport(world);
  assert.equal(report.verdict, 'BLOCKED');
  assert.equal(report.verdictAuthority, 'correctness');
  assert.equal(row(report, AC2).result, 'critiqueOnly');
  assert.equal(report.runStats.counts.critiqueOnly, 1);
  const ran = row(report, AC1);
  assert.equal(ran.result, 'pass', 'the bound suite for AC-101-1 still ran');
  assert.equal(testRow(ran, TITLE_1).testNumber, 1, 'AC-101-1 evidence carries the reported test number');
});

test('AC-19301-4: rcf verify run --artefact <tgz> --fbs FBS-001 --hand verifier with the AC-001-1 test to-do or skip and an AC-001-2 title absent from the run exits 4; AC-001-1 skipped, AC-001-2 fail listing the title under notRun, verdict not PASS', { timeout: 2 * INSTALL_TIMEOUT }, async (t) => {
  for (const mark of ['todo', 'skip']) {
    await t.test(`AC-101-1 test marked ${mark}`, async () => {
      const world = await readyWorld({ ac1: mark, bind: [[AC1, TITLE_1], [AC2, TITLE_2], [AC2, MISSING_TITLE]] });
      assertSelf(world, [
        { ok: true, n: 1, title: TITLE_1, directive: mark.toUpperCase() },
        { ok: true, n: 2, title: TITLE_2, directive: null },
      ]);
      const r = await artefactRun(world, ['--fbs', FBS, '--hand', 'verifier']);
      assertNotUnknownOption(r);
      assert.equal(r.code, 4, `a ${mark} test and a not-run title: exit 4; stderr:\n${r.stderr}`);
      const report = readReport(world);
      assert.equal(row(report, AC1).result, 'skipped', `a bound test marked ${mark} leaves its AC skipped`);
      const notRun = row(report, AC2);
      assert.equal(notRun.result, 'fail', 'a bound title absent from the run fails its AC even though its other test passed');
      assert.deepEqual(notRun.evidence.notRun, [MISSING_TITLE]);
      assert.notEqual(report.verdict, 'PASS');
    });
  }
});

test('AC-19301-5: rcf verify run --artefact <tgz> --fbs FBS-001 --hand verifier with an HTTP probe on AC-001-1 and no --url resolves AC-001-1 pass with probeNotRun "package target has no served URL"; suites[] rows, <TS id>.tap and install.log under rcf/verify-reports/FBS-001/<head12>/, install { command, exitCode 0, logPath }, define validate exits 0', { timeout: INSTALL_TIMEOUT }, async () => {
  const world = await readyWorld({ catalog: { [AC1]: { path: '/health', expectStatus: 200 } } });
  assertSelf(world, BOTH_PASS);
  const r = await artefactRun(world, ['--fbs', FBS, '--hand', 'verifier']);
  assertNotUnknownOption(r);
  assert.equal(r.code, 0, `the probe AC resolves through its bound test: exit 0; stderr:\n${r.stderr}`);
  const report = readReport(world);
  const probed = row(report, AC1);
  assert.equal(probed.result, 'pass');
  assert.equal(probed.evidence.probeNotRun, 'package target has no served URL');

  const dir = `rcf/verify-reports/${FBS}/${head12(world)}`;
  assert.deepEqual(report.suites, [{
    testSuite: world.tsId, file: TEST_FILE, tests: 2, pass: 2, fail: 0, skipped: 0, todos: 0,
    outputPath: `${dir}/${world.tsId}.tap`,
  }]);
  const tap = join(world.root, dir, `${world.tsId}.tap`);
  assert.ok(existsSync(tap), `${dir}/${world.tsId}.tap exists`);
  assert.match(readFileSync(tap, 'utf8'), new RegExp(`^ok 1 - ${TITLE_1}$`, 'm'), 'the .tap file is the raw reporter output');
  assert.ok(existsSync(join(world.root, dir, 'install.log')), `${dir}/install.log exists`);
  assert.equal(typeof report.install?.command, 'string');
  assert.match(report.install.command, /npm .*install/, 'install.command is the npm install it ran');
  assert.equal(report.install.exitCode, 0);
  assert.equal(report.install.logPath, `${dir}/install.log`);

  const v = await rcf(['define', 'validate'], { cwd: world.root });
  assert.equal(v.code, 0, `rcf define validate still exits 0 after the run\n${v.stdout}${v.stderr}`);
});

test('AC-19301-6: rcf verify run --artefact <tgz> with --url, --mode agentScreenshotCritique, a --profile other than packagedArtefact, or a missing or non-gzip path exits 2 with a stderr line naming the flag and writes nothing under rcf/verify-reports/', { timeout: INSTALL_TIMEOUT }, async () => {
  const world = await readyWorld();
  const notGzip = join(world.out, 'x.tgz');
  await writeFile(notGzip, 'this is a text file, not a gzip tarball\n', 'utf8');
  const hand = ['--fbs', FBS, '--hand', 'verifier'];
  const cases = [
    { flag: '--url', args: ['--artefact', world.tgz, ...hand, '--url', 'http://127.0.0.1:9/'] },
    { flag: '--mode', args: ['--artefact', world.tgz, ...hand, '--mode', 'agentScreenshotCritique'] },
    { flag: '--profile', args: ['--artefact', world.tgz, ...hand, '--profile', 'ci'] },
    { flag: '--artefact', args: ['--artefact', join(world.out, 'missing-1.0.0.tgz'), ...hand] },
    { flag: '--artefact', args: ['--artefact', notGzip, ...hand] },
  ];
  const reports = join(world.root, 'rcf', 'verify-reports');
  for (const c of cases) {
    assert.equal(existsSync(reports), false, 'fixture: no rcf/verify-reports/ before the run');
    const r = await rcf(['verify', 'run', ...c.args], { cwd: world.root, env: runEnv(world) });
    assertNotUnknownOption(r);
    assert.equal(r.code, 2, `${c.args.join(' ')}: usage refusal exit 2; stderr:\n${r.stderr}`);
    // The refusal line itself, not an indented line of the help text.
    const named = r.stderr.split('\n').filter((l) => /^\S/.test(l) && l.includes(c.flag));
    assert.ok(named.length > 0, `a stderr line names ${c.flag}; got:\n${r.stderr}`);
    assert.equal(existsSync(reports), false, `${c.flag}: nothing written under rcf/verify-reports/`);
  }
});

test('AC-19301-8: rcf verify run --artefact <tgz> --fbs FBS-001 --hand verifier leaves every file outside rcf/verify-reports/FBS-001/ byte-identical and git status clean beyond it, installs under the OS temporary directory, and never spawns a claude executable on PATH', { timeout: INSTALL_TIMEOUT }, async () => {
  const world = await readyWorld();
  assertSelf(world, BOTH_PASS);
  // A recording npm first on PATH: logs cwd and argv, then runs the real npm.
  const wrapDir = join(world.aux, 'npm-wrap');
  const npmLog = join(world.aux, 'npm-calls.log');
  const tmp = join(world.aux, 'os-tmp');
  await mkdir(wrapDir, { recursive: true });
  await mkdir(tmp, { recursive: true });
  await writeFile(join(wrapDir, 'npm'), `#!/bin/sh\nprintf '%s\\t%s\\n' "$(pwd -P)" "$*" >> '${npmLog}'\nexec '${REAL_NPM}' "$@"\n`, 'utf8');
  await chmod(join(wrapDir, 'npm'), 0o755);

  const exempt = `rcf/verify-reports/${FBS}/`;
  const before = hashTree(world.root, exempt);
  const r = await artefactRun(world, ['--fbs', FBS, '--hand', 'verifier'], { prependPath: wrapDir, tmpdir: tmp });
  assertNotUnknownOption(r);
  assert.equal(r.code, 0, `the run passes; stderr:\n${r.stderr}`);
  assert.deepEqual(hashTree(world.root, exempt), before, 'every file outside rcf/verify-reports/FBS-001/ is byte-identical');
  const changed = changedPaths(world.root);
  assert.ok(changed.length > 0, 'the run wrote its report');
  assert.deepEqual(changed.filter((p) => !p.startsWith(exempt)), [], 'git status lists nothing outside the report directory');

  const calls = existsSync(npmLog) ? (await readFile(npmLog, 'utf8')).split('\n').filter(Boolean) : [];
  const installs = calls.filter((l) => /\binstall\b/.test(l.split('\t')[1] ?? ''));
  assert.ok(installs.length > 0, `npm install ran through PATH; npm calls:\n${calls.join('\n')}`);
  const tmpReal = realTmp(tmp);
  for (const call of installs) {
    assert.ok(call.split('\t')[0].startsWith(`${tmpReal}/`), `the scratch install project lives under the OS temp dir (${tmpReal}); got ${call}`);
  }
  assert.equal(existsSync(world.claudeMarker), false, 'no agent CLI was spawned');
});

// The raw blob bytes (the git helper trims its output).
function execGitBlob(root, spec) {
  return execFileSync('git', ['show', spec], { cwd: root });
}

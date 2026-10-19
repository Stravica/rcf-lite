// FBS-226 (US-19302): rcf verify run --package <dir> packs the artefact from HEAD and installs it under a declared store policy.
//
// Every test drives the real entry point, `node bin/rcf.js verify run`, from
// the root of FBS-225's fixture world (helpers/package-world.js): a git
// repository that is both an rcf project and the zero-dependency package
// fixture-cli 1.0.0. helpers/pack-world.js adds a recording npm, a version
// move (the 0.9.0 tarball of AC-19302-2) and a declared dependency that
// resolves nowhere (AC-19302-3). The criteria's fixture ids AC-001-1 and
// AC-001-2 are AC-101-1 and AC-101-2 here (scaffoldChain's US-101). Before
// each run the fixture's own suite runs once and its TAP lines are asserted,
// so a red test is red for the tool's reason. Every run has a recording fake
// `claude` first on PATH and an npm cache in the test's own temp dir; the
// AC-19302-3 fixture runs only with --offline, so no install here reaches a
// registry. The command runs as each criterion writes it: no --repo,
// --profile or --mode (package target mode defaults to deterministic and
// profile packagedArtefact).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  AC1, AC2, FBS, PKG_NAME, PKG_VERSION, TARBALL, TITLE_1, TITLE_2,
  changedPaths, commitAll, commitWorld, git, hashTree, head12, lastLine, packWorld, packageWorld,
  rcf, readReport, realTmp, reportRel, runEnv, selfCheck, sha256,
} from './helpers/package-world.js';
import { addDependency, npmRecorder, packAs, setVersion, subcommand, tarballsIn } from './helpers/pack-world.js';

// test/verify/suite-as-probe.test.js's INSTALL_TIMEOUT.
const INSTALL_TIMEOUT = 240_000;
const HAND = ['--fbs', FBS, '--hand', 'verifier'];
const DIRTY_LINE = 'verify report refused: working tree is dirty; the report must name a committed head';

const BOTH_PASS = [
  { ok: true, n: 1, title: TITLE_1, directive: null },
  { ok: true, n: 2, title: TITLE_2, directive: null },
];

function run(world, args, extra = {}) {
  return rcf(['verify', 'run', ...args], { cwd: world.root, env: runEnv(world, extra) });
}

// Today's refusals are the wrong reason for every test here: the strict-parse
// refusal of --offline, and FBS-219's record-only path asking for a profile.
function assertNotTodaysRefusal(r) {
  assert.doesNotMatch(r.stderr, /Unknown option/, `the run must not stop on the unknown-option refusal; stderr:\n${r.stderr}`);
  assert.doesNotMatch(r.stderr, /--profile is required/, `the run must not take the record-only path; stderr:\n${r.stderr}`);
}

function assertSelf(world, expected) {
  assert.deepEqual(selfCheck(world), expected, 'fixture self-check: the fixture suite reports the lines the criterion presumes');
}

function assertNoClaude(world) {
  assert.equal(existsSync(world.claudeMarker), false, 'no agent CLI was spawned');
}

async function tmpFor(world) {
  const tmp = join(world.aux, 'os-tmp');
  await mkdir(tmp, { recursive: true });
  return tmp;
}

// The value after a flag in a recorded argv.
function flagValue(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

test('AC-19302-1: rcf verify run --package . --fbs FBS-001 --hand verifier at clean head H packs with npm pack into the scratch directory, exits 0 and prints "verify report: rcf/verify-reports/FBS-001/<head12>.json PASS 2/2"; target sha256 equals a separate npm pack of H, servedSha H, pack { command, exitCode 0 }', { timeout: INSTALL_TIMEOUT }, async () => {
  const world = await packageWorld();
  commitWorld(world);
  // The separate npm pack of H, outside the repository.
  packWorld(world);
  const separate = sha256(readFileSync(world.tgz));
  assertSelf(world, BOTH_PASS);
  const npm = await npmRecorder(world, 'run');
  const tmp = await tmpFor(world);

  const r = await run(world, ['--package', '.', ...HAND], { prependPath: npm.dir, tmpdir: tmp });
  assertNotTodaysRefusal(r);
  assert.equal(r.code, 0, `both bound tests pass against the packed artefact: exit 0; stderr:\n${r.stderr}`);
  assert.equal(lastLine(r.stdout), `verify report: ${reportRel(world)} PASS 2/2`);

  const report = readReport(world);
  assert.deepEqual(report.target, {
    kind: 'package', packageRef: TARBALL, name: PKG_NAME, version: PKG_VERSION, sha256: separate, servedSha: world.head,
  });
  assert.equal(typeof report.pack?.command, 'string', `the report carries pack { command, exitCode }; got ${JSON.stringify(report.pack)}`);
  assert.match(report.pack.command, /npm .*pack/, 'pack.command is the npm pack it ran');
  assert.equal(report.pack.exitCode, 0);
  assert.equal(report.profile, 'packagedArtefact');
  assert.equal(report.method, 'suiteAsProbe');

  // "packs ... into the scratch directory": the pack ran in the fixture root,
  // its destination under the OS temp dir, never inside the repository.
  const packs = (await npm.calls()).filter((c) => subcommand(c) === 'pack');
  assert.equal(packs.length, 1, `exactly one npm pack ran; npm calls:\n${(await npm.calls()).map((c) => c.line).join('\n')}`);
  const [pack] = packs;
  assert.equal(pack.cwd, realTmp(world.root), 'npm pack ran in the package directory');
  const dest = flagValue(pack.argv, '--pack-destination');
  assert.ok(dest, `npm pack was given --pack-destination; argv ${pack.argv.join(' ')}`);
  const destReal = realTmp(dest);
  assert.ok(destReal.startsWith(`${realTmp(tmp)}/`), `the pack destination ${destReal} is under the OS temp dir ${realTmp(tmp)}`);
  assert.ok(!destReal.startsWith(`${realTmp(world.root)}/`), 'the pack destination is not inside the repository');
  assertNoClaude(world);
});

test('AC-19302-2: rcf verify run --artefact fixture-cli-0.9.0.tgz --fbs FBS-001 --hand verifier at head H records target.version 0.9.0, the tarball sha256, servedSha null and no pack object, and an npm wrapper on PATH logs install and never pack', { timeout: INSTALL_TIMEOUT }, async () => {
  const world = await packageWorld();
  // The earlier commit: the package at 0.9.0, packed outside the repository.
  await setVersion(world, '0.9.0');
  git(world.root, 'init', '-q', '-b', 'main');
  commitAll(world.root, 'fixture: fixture-cli 0.9.0');
  const old = packAs(world, '0.9.0');
  // Head H: the package moved on to 1.0.0.
  await setVersion(world, PKG_VERSION);
  world.head = commitAll(world.root, 'fixture: fixture-cli 1.0.0');
  assertSelf(world, BOTH_PASS);
  const npm = await npmRecorder(world, 'run');

  const r = await run(world, ['--artefact', old, ...HAND], { prependPath: npm.dir });
  assertNotTodaysRefusal(r);
  // The 0.9.0 artefact prints its own version, so H's 1.0.0 banner test fails
  // against it: the run verified the given bytes, not H's.
  assert.equal(r.code, 4, `the given 0.9.0 bytes fail H's 1.0.0 banner test: exit 4; stderr:\n${r.stderr}`);
  assert.equal(lastLine(r.stdout), `verify report: ${reportRel(world)} FAIL 1/2`);
  const report = readReport(world);
  assert.equal(report.target.version, '0.9.0');
  assert.equal(report.target.sha256, sha256(readFileSync(old)), 'target.sha256 is the given tarball\'s bytes');
  assert.equal(report.target.servedSha, null);
  assert.equal('pack' in report, false, 'a given --artefact carries no pack object');

  const calls = await npm.calls();
  const subs = calls.map(subcommand);
  assert.ok(subs.includes('install'), `npm install ran through PATH; npm calls:\n${calls.map((c) => c.line).join('\n')}`);
  assert.ok(!subs.includes('pack'), `no npm pack ran; npm calls:\n${calls.map((c) => c.line).join('\n')}`);
  assertNoClaude(world);
});

test('AC-19302-3: rcf verify run --artefact <tgz> --fbs FBS-001 --hand verifier --offline with an unresolvable dependency exits 1 with stderr "verify run: install failed (npm exit <n>); log rcf/verify-reports/FBS-001/<head12>/install.log", the log exists and no report JSON is written', { timeout: INSTALL_TIMEOUT }, async () => {
  const world = await packageWorld();
  // A dependency no registry or cache holds; the npm cache is the world's own, empty.
  await addDependency(world, 'rcf-fixture-unresolvable-dependency', '1.0.0');
  commitWorld(world);
  packWorld(world);
  assertSelf(world, BOTH_PASS);
  const npm = await npmRecorder(world, 'run');

  const r = await run(world, ['--artefact', world.tgz, ...HAND, '--offline'], { prependPath: npm.dir });
  assertNotTodaysRefusal(r);
  assert.equal(r.code, 1, `a failed install: exit 1; stderr:\n${r.stderr}`);
  const calls = await npm.calls();
  const installs = calls.filter((c) => subcommand(c) === 'install');
  assert.equal(installs.length, 1, `one npm install ran; npm calls:\n${calls.map((c) => c.line).join('\n')}`);
  assert.ok(installs[0].argv.includes('--offline'), `the install ran offline (no registry); argv ${installs[0].argv.join(' ')}`);
  const n = installs[0].exitCode;
  assert.notEqual(n, 0, 'fixture: npm install of the unresolvable dependency fails');
  const logRel = `rcf/verify-reports/${FBS}/${head12(world)}/install.log`;
  assert.ok(r.stderr.includes(`verify run: install failed (npm exit ${n}); log ${logRel}`),
    `stderr names the npm exit and the log path; got:\n${r.stderr}`);
  assert.ok(existsSync(join(world.root, logRel)), `${logRel} exists`);
  assert.equal(existsSync(join(world.root, reportRel(world))), false, 'no report JSON is written for the head');
  assertNoClaude(world);
});

test('AC-19302-4: rcf verify run --artefact <tgz> --fbs FBS-001 --hand verifier with --offline then without exits 0 both times; install.command carries --offline only on the first, install.registry offline then default; rcf build finalise never installs or reaches the network', { timeout: 2 * INSTALL_TIMEOUT }, async (t) => {
  // One world per report: Finalise ingests the newest report of a merged
  // head, so each run is carried through AC-19301-9's end-to-end shape.
  const cases = [
    { name: 'with --offline', flags: ['--offline'], offline: true, registry: 'offline' },
    { name: 'without --offline', flags: [], offline: false, registry: 'default' },
  ];
  for (const c of cases) {
    await t.test(c.name, async () => {
      const world = await packageWorld({ fbsStatus: 'notStarted' });
      const { root } = world;
      const cn = await rcf(['define', 'create', 'cn', '--path', `bin/${PKG_NAME}.js#banner`, '--acs', `${AC1},${AC2}`], { cwd: root });
      assert.equal(cn.code, 0, `fixture: create cn\n${cn.stderr}`);
      const ip = await rcf(['build', 'mark', FBS, 'inProgress'], { cwd: root });
      assert.equal(ip.code, 0, `fixture: mark inProgress\n${ip.stderr}`);
      git(root, 'init', '-q', '-b', 'main');
      commitAll(root, 'chore: base');
      git(root, 'checkout', '-q', '-b', 'feature');
      const binPath = join(root, 'bin', `${PKG_NAME}.js`);
      await writeFile(binPath, `${await readFile(binPath, 'utf8')}// built\n`, 'utf8');
      world.head = commitAll(root, 'feat: fixture-cli banner', { Hand: 'builder', 'Hand-Id': 'build-hand-7' });
      packWorld(world);
      assertSelf(world, BOTH_PASS);

      const r = await run(world, ['--artefact', world.tgz, ...HAND, ...c.flags]);
      assertNotTodaysRefusal(r);
      assert.equal(r.code, 0, `the zero-dependency fixture installs ${c.name}: exit 0; stderr:\n${r.stderr}`);
      assert.equal(lastLine(r.stdout), `verify report: ${reportRel(world)} PASS 2/2`);
      const report = readReport(world);
      assert.equal(typeof report.install?.command, 'string');
      if (c.offline) assert.ok(report.install.command.split(' ').includes('--offline'), `install.command carries --offline: ${report.install.command}`);
      else assert.ok(!report.install.command.includes('--offline'), `install.command carries no --offline: ${report.install.command}`);
      assert.equal(report.install.registry, c.registry);

      commitAll(root, 'test: verify report', { Hand: 'verifier' });
      git(root, 'checkout', '-q', 'main');
      git(root, 'merge', '-q', '--no-ff', '-m', 'Merge feature', 'feature');
      const done = await rcf(['build', 'mark', FBS, 'complete'], { cwd: root });
      assert.equal(done.code, 0, `fixture: mark complete\n${done.stderr}`);
      commitAll(root, 'chain: mark FBS-001 complete');

      // Finalise with a recording npm first on PATH: npm is the only
      // installer and the only registry client in the verify path, so no npm
      // call is the observable for "never installs or reaches the network".
      const npm = await npmRecorder(world, 'finalise');
      const fin = await rcf(['build', 'finalise', FBS, '--ci-run', 'run-1'], { cwd: root, env: runEnv(world, { prependPath: npm.dir }) });
      assert.equal(fin.code, 0, `Finalise ingests the ${c.registry} report: exit 0\nstderr:\n${fin.stderr}`);
      assert.ok(fin.stdout.includes(`finalise: ${FBS} verified from ${reportRel(world)} (head ${world.head.slice(0, 7)}, ci run-1)`), fin.stdout);
      assert.deepEqual((await npm.calls()).map((x) => x.line), [], 'rcf build finalise spawns no npm');
      assertNoClaude(world);
    });
  }
});

test('AC-19302-5: rcf verify run --package . --fbs FBS-001 --hand verifier leaves no *.tgz, node_modules or package-lock.json change in git status, new paths only under rcf/verify-reports/FBS-001/, and a dirty tree outside rcf/verify-reports/ refuses exit 4 before packing', { timeout: INSTALL_TIMEOUT }, async () => {
  const world = await packageWorld();
  commitWorld(world);
  assertSelf(world, BOTH_PASS);
  const npm = await npmRecorder(world, 'run');
  const tmp = await tmpFor(world);
  const exempt = `rcf/verify-reports/${FBS}/`;
  const lockAndModules = () => ['node_modules', 'package-lock.json'].map((p) => existsSync(join(world.root, p)));
  assert.deepEqual(lockAndModules(), [false, false], 'fixture: no node_modules or package-lock.json before the run');
  const before = hashTree(world.root, exempt);

  const r = await run(world, ['--package', '.', ...HAND], { prependPath: npm.dir, tmpdir: tmp });
  assertNotTodaysRefusal(r);
  assert.equal(r.code, 0, `the packed run passes: exit 0; stderr:\n${r.stderr}`);
  assert.equal(lastLine(r.stdout), `verify report: ${reportRel(world)} PASS 2/2`);
  assert.ok(existsSync(join(world.root, reportRel(world))), 'the run wrote its report');
  assert.ok((await npm.calls()).some((c) => subcommand(c) === 'pack'), 'the clean run packed');

  const changed = changedPaths(world.root);
  assert.ok(changed.includes(reportRel(world)), `git status lists the report; got ${JSON.stringify(changed)}`);
  assert.deepEqual(changed.filter((p) => !p.startsWith(exempt)), [], 'the only new paths are under rcf/verify-reports/FBS-001/');
  assert.deepEqual(tarballsIn(world.root), [], 'no *.tgz anywhere in the project');
  assert.deepEqual(lockAndModules(), [false, false], 'no node_modules or package-lock.json after the run');
  assert.deepEqual(hashTree(world.root, exempt), before, 'every file outside rcf/verify-reports/FBS-001/ is byte-identical');

  // Regression guard (green today on FBS-219's record-only path): a change
  // outside rcf/verify-reports/ refuses exit 4 before packing.
  await writeFile(join(world.root, 'notes.txt'), 'uncommitted\n', 'utf8');
  const packsBefore = (await npm.calls()).filter((c) => subcommand(c) === 'pack').length;
  const dirty = await run(world, ['--package', '.', ...HAND], { prependPath: npm.dir, tmpdir: tmp });
  assert.equal(dirty.code, 4, `dirty tree: exit 4; stderr:\n${dirty.stderr}`);
  assert.ok(dirty.stderr.includes(DIRTY_LINE), dirty.stderr);
  assert.equal((await npm.calls()).filter((c) => subcommand(c) === 'pack').length, packsBefore, 'the refused run never packs');
  assertNoClaude(world);
});

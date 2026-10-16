// FBS-219 (US-19001): the verifier records a Test-stage verify report before merge.
//
// Every test drives the real entry point, `node bin/rcf.js`, as a child
// process inside a fixture project that is a real git repository with a
// committed head (git init + commit in a scratch dir, never the live
// checkout). Probes resolve against a real HTTP target served from this
// test process on 127.0.0.1, through rcf/verify-catalog.json, as in the
// FBS-218 probe-catalog tests. The report shape asserted is VerifyReport
// v1 as TAC-4148 names it: reportVersion, fbsId, headSha, target { kind,
// url | packageRef }, mode, hand, verifierId, startedAt, finishedAt,
// rcfLiteVersion, verdict, verdictAuthority, runStats.counts, perAc[].

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scaffoldChain } from './helpers/chain.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = resolve(HERE, '..', '..');
const RCF_BIN = join(PKG_ROOT, 'bin', 'rcf.js');
const RCF_LITE_VERSION = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8')).version;
const FBS_218_REPORT = join(HERE, 'fixtures', 'verify-report-hand', 'FBS-218-aebff5f39e5c.json');

const HANDS = ['test-author', 'builder', 'reviewer', 'verifier', 'stage-keeper'];
const PER_AC_RESULTS = ['pass', 'fail', 'skipped', 'critiqueOnly', 'critiqued'];

// Run bin/rcf.js as a child; never rejects, returns the exit code.
function rcf(args, { cwd } = {}) {
  return new Promise((res) => {
    execFile(process.execPath, [RCF_BIN, ...args], {
      cwd, env: process.env, encoding: 'utf8', timeout: 60000,
    }, (err, stdout, stderr) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

function git(root, args) {
  return execFileSync('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args],
  { cwd: root, encoding: 'utf8' }).trim();
}

// `git status --porcelain` paths, untracked files listed one by one.
function changedPaths(root) {
  return git(root, ['status', '--porcelain', '--untracked-files=all'])
    .split('\n').filter(Boolean).map((line) => line.slice(3));
}

// A real HTTP target answering 200 'ok' on every path.
async function startTarget(t) {
  const hits = [];
  const server = createServer((req, res) => {
    hits.push(new URL(req.url, 'http://x').pathname);
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return { url: `http://127.0.0.1:${server.address().port}`, hits };
}

function ac(id) {
  return {
    id,
    description: `${id}: the deployed service answers its declared probe`,
    given: 'the service is deployed',
    when: 'the verifier probes it',
    then: 'the declared expectation holds',
    testable: true,
  };
}

function fbsDoc(fbsId, buildOrder, acIds) {
  return {
    fbsId, prdId: 'PRD-001', bsId: 'BS-001', buildOrder,
    executionStatus: 'inProgress', title: `${fbsId} fixture`,
    summary: `${fbsId} binds ${acIds.join(', ')}.`, acIds, dependsOnFbsIds: [],
    createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z',
  };
}

// Fixture project: FBS-001 binds AC-101-1 and AC-101-2, each with a
// catalog probe on /health; a src/ and a test/ file sit beside rcf/. The
// whole tree is committed, so the working tree is clean at head H.
async function fixtureRepo() {
  const { root } = await scaffoldChain({
    acceptanceCriteria: [ac('AC-101-1'), ac('AC-101-2')],
    fbsItems: [fbsDoc('FBS-001', 1, ['AC-101-1', 'AC-101-2'])],
  });
  await writeFile(join(root, 'rcf', 'verify-catalog.json'), `${JSON.stringify({
    catalogVersion: 1,
    probes: {
      'AC-101-1': { path: '/health', expectStatus: 200 },
      'AC-101-2': { path: '/ready', expectStatus: 200 },
    },
  }, null, 2)}\n`, 'utf8');
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'test'), { recursive: true });
  await writeFile(join(root, 'src', 'app.js'), 'export const app = 1;\n', 'utf8');
  await writeFile(join(root, 'test', 'app.test.js'), '// fixture test\n', 'utf8');
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'fixture: initial chain']);
  const head = git(root, ['rev-parse', 'HEAD']);
  return { root, head };
}

function reportsDir(root, fbsId = 'FBS-001') {
  return join(root, 'rcf', 'verify-reports', fbsId);
}

function reportPath(root, head, fbsId = 'FBS-001') {
  return join(reportsDir(root, fbsId), `${head.slice(0, 12)}.json`);
}

// The Test-stage invocation: deterministic, scoped to FBS-001, stamped
// by a hand. No --out: the report goes to its default path.
function verifyRun(root, flags) {
  return rcf(['verify', 'run', '--repo', root, '--profile', 'ci', '--provision-mode', 'skip',
    '--mode', 'deterministic', ...flags], { cwd: root });
}

// VerifyReport v1 (TAC-4148 recordShape).
function assertVerifyReportV1(report) {
  assert.equal(report.reportVersion, 1, 'reportVersion is 1');
  assert.equal(typeof report.fbsId, 'string');
  assert.match(report.headSha ?? '', /^[0-9a-f]{40}$/, 'headSha is a full commit sha');
  assert.ok(report.target && ['url', 'package'].includes(report.target.kind), 'target.kind is url or package');
  assert.equal(typeof report.mode, 'string');
  assert.ok(HANDS.includes(report.hand), `hand is one of ${HANDS.join(' | ')}`);
  assert.equal(typeof report.verifierId, 'string');
  for (const k of ['startedAt', 'finishedAt']) {
    assert.ok(typeof report[k] === 'string' && !Number.isNaN(Date.parse(report[k])), `${k} is an ISO timestamp`);
  }
  assert.ok(Date.parse(report.startedAt) <= Date.parse(report.finishedAt), 'startedAt <= finishedAt');
  assert.equal(typeof report.rcfLiteVersion, 'string');
  assert.equal(typeof report.verdict, 'string');
  assert.equal(typeof report.verdictAuthority, 'string');
  const counts = report.runStats?.counts;
  assert.ok(counts, 'runStats.counts is present');
  for (const k of ['verified', 'failed', 'skipped', 'total']) {
    assert.equal(typeof counts[k], 'number', `runStats.counts.${k} is a number`);
  }
  assert.ok(Array.isArray(report.perAc), 'perAc[] is present');
  for (const row of report.perAc) {
    assert.equal(typeof row.acId, 'string');
    assert.ok(PER_AC_RESULTS.includes(row.result), `perAc result ${row.result} is one of ${PER_AC_RESULTS.join(' | ')}`);
  }
}

async function readReport(path) {
  const raw = await readFile(path, 'utf8');
  assert.ok(raw.endsWith('\n'), 'report ends with a trailing newline');
  const report = JSON.parse(raw);
  assert.equal(raw, `${JSON.stringify(report, null, 2)}\n`, 'report is two-space indented JSON');
  return report;
}

test('AC-19001-1: rcf verify run --url <preview-url> --fbs <fbs-id> --mode deterministic --hand verifier --verifier-id <id> writes rcf/verify-reports/<fbs-id>/<head12>.json valid as VerifyReport v1 and stdout ends "verify report: <path> <verdict> <verified>/<total>"', async (t) => {
  const target = await startTarget(t);
  const { root, head } = await fixtureRepo();
  const { code, stdout, stderr } = await verifyRun(root, ['--url', target.url, '--fbs', 'FBS-001',
    '--hand', 'verifier', '--verifier-id', 'verifier-ac-19001-1']);
  assert.equal(code, 0, `both probes pass, so the run exits 0; stderr:\n${stderr}`);

  const path = reportPath(root, head);
  assert.ok(existsSync(path), `rcf/verify-reports/FBS-001/${head.slice(0, 12)}.json exists`);
  const report = await readReport(path);
  assertVerifyReportV1(report);
  assert.equal(report.fbsId, 'FBS-001');
  assert.equal(report.headSha, head, 'headSha is the checkout head H');
  assert.deepEqual(report.target, { kind: 'url', url: target.url });
  assert.equal(report.hand, 'verifier');
  assert.equal(report.verifierId, 'verifier-ac-19001-1');
  assert.equal(report.mode, 'deterministic');
  assert.equal(report.rcfLiteVersion, RCF_LITE_VERSION);
  assert.equal(report.verdict, 'PASS');
  assert.deepEqual(report.perAc.map((r) => r.acId).sort(), ['AC-101-1', 'AC-101-2'], 'one perAc row per bound AC');
  assert.ok(report.perAc.every((r) => r.result === 'pass'));
  assert.equal(report.runStats.counts.verified, 2);
  assert.equal(report.runStats.counts.total, 2);
  assert.ok(target.hits.includes('/health') && target.hits.includes('/ready'), 'both probes reached the target');

  const last = stdout.trimEnd().split('\n').at(-1);
  const rel = `rcf/verify-reports/FBS-001/${head.slice(0, 12)}.json`;
  assert.ok([`verify report: ${rel} PASS 2/2`, `verify report: ${path} PASS 2/2`].includes(last),
    `stdout ends with "verify report: <path> PASS 2/2"; got: ${last}`);
});

test('AC-19001-2: rcf verify run --hand verifier --fbs <fbs-id> on a dirty working tree exits 4 with "verify report refused: working tree is dirty; the report must name a committed head" and writes no report', async (t) => {
  const target = await startTarget(t);
  const { root, head } = await fixtureRepo();
  await writeFile(join(root, 'src', 'app.js'), 'export const app = 2;\n', 'utf8');

  const dirty = await verifyRun(root, ['--url', target.url, '--fbs', 'FBS-001',
    '--hand', 'verifier', '--verifier-id', 'verifier-ac-19001-2']);
  assert.equal(dirty.code, 4, `a dirty tree refuses exit 4; stderr:\n${dirty.stderr}`);
  assert.ok(dirty.stderr.includes('verify report refused: working tree is dirty; the report must name a committed head'),
    `stderr names the refusal; got:\n${dirty.stderr}`);
  assert.equal(existsSync(join(root, 'rcf', 'verify-reports')), false, 'no report is written');

  // Control: uncommitted files inside rcf/verify-reports/ only are not a
  // dirty tree. A report for another FBS sits there uncommitted.
  git(root, ['checkout', '--', 'src/app.js']);
  await mkdir(reportsDir(root, 'FBS-002'), { recursive: true });
  await writeFile(join(reportsDir(root, 'FBS-002'), 'aaaaaaaaaaaa.json'), '{}\n', 'utf8');
  const clean = await verifyRun(root, ['--url', target.url, '--fbs', 'FBS-001',
    '--hand', 'verifier', '--verifier-id', 'verifier-ac-19001-2']);
  assert.equal(clean.code, 0, `changes only under rcf/verify-reports/ do not refuse; stderr:\n${clean.stderr}`);
  assert.ok(existsSync(reportPath(root, head)), 'the clean run writes its report');
});

test('AC-19001-3: rcf verify run with --hand outside the five hands, or --hand without --fbs, exits 2 naming the flag and writes no report', async (t) => {
  const target = await startTarget(t);
  const { root } = await fixtureRepo();

  const badHand = await verifyRun(root, ['--url', target.url, '--fbs', 'FBS-001',
    '--hand', 'pilot', '--verifier-id', 'verifier-ac-19001-3']);
  assert.equal(badHand.code, 2, `an unknown hand is a usage error; stderr:\n${badHand.stderr}`);
  assert.ok(badHand.stderr.includes('--hand'), 'stderr names --hand');

  const noFbs = await verifyRun(root, ['--url', target.url,
    '--hand', 'verifier', '--verifier-id', 'verifier-ac-19001-3']);
  assert.equal(noFbs.code, 2, `--hand without --fbs is a usage error; stderr:\n${noFbs.stderr}`);
  assert.ok(noFbs.stderr.includes('--fbs'), 'stderr names --fbs');
  assert.equal(existsSync(join(root, 'rcf', 'verify-reports')), false, 'no report is written on a usage error');

  // Control: each of the five hands is accepted with --fbs (never exit 2).
  for (const hand of HANDS) {
    const ok = await verifyRun(root, ['--url', target.url, '--fbs', 'FBS-001',
      '--hand', hand, '--verifier-id', 'verifier-ac-19001-3', '--replace', 'AC-19001-3 control rerun']);
    assert.notEqual(ok.code, 2, `--hand ${hand} --fbs FBS-001 is not a usage error; stderr:\n${ok.stderr}`);
  }
});

test('AC-19001-4: rcf verify run --package <name@version|tarball> --fbs <fbs-id> --hand verifier writes a report with target.kind "package" and target.packageRef and no target.url', async () => {
  for (const packageRef of ['fixture-cli@1.2.3', 'fixture-cli-1.2.3.tgz']) {
    const { root, head } = await fixtureRepo();
    const { code, stderr } = await verifyRun(root, ['--package', packageRef, '--fbs', 'FBS-001',
      '--hand', 'verifier', '--verifier-id', 'verifier-ac-19001-4']);
    assert.ok(code === 0 || code === 4, `a package target writes a report (exit 0 or 4); got ${code}; stderr:\n${stderr}`);
    const path = reportPath(root, head);
    assert.ok(existsSync(path), `the report for ${packageRef} is written`);
    const report = await readReport(path);
    assertVerifyReportV1(report);
    assert.equal(report.target.kind, 'package');
    assert.equal(report.target.packageRef, packageRef);
    assert.equal(Object.hasOwn(report.target, 'url'), false, 'target.url is absent');
    assert.equal(report.headSha, head);
  }
});

test('AC-19001-5: with a committed report under rcf/verify-reports/, rcf define validate exits 0 with no unknown-document error and rcf audit separation classifies the path as verifier evidence', async () => {
  const { root, head: base } = await fixtureRepo();
  // The FBS-218 Test-stage report, committed under a Hand: verifier trailer.
  await mkdir(reportsDir(root, 'FBS-218'), { recursive: true });
  await writeFile(join(reportsDir(root, 'FBS-218'), 'aebff5f39e5c.json'), await readFile(FBS_218_REPORT, 'utf8'), 'utf8');
  git(root, ['add', '-A']);
  git(root, ['commit', '-q', '-m', 'test(FBS-218): Test-stage verify report', '-m', 'Hand: verifier']);

  const validate = await rcf(['define', 'validate'], { cwd: root });
  assert.equal(validate.code, 0, `validate exits 0; output:\n${validate.stdout}${validate.stderr}`);
  const out = `${validate.stdout}${validate.stderr}`;
  assert.doesNotMatch(out, /verify-reports/, 'validate does not name the report as a chain document');
  assert.doesNotMatch(out, /Unknown document kind|unclassified/i, 'no unknown-document error');

  // The tree walker behind read and coverage stays silent on it too.
  const coverage = await rcf(['audit', 'coverage', '--json'], { cwd: root });
  assert.doesNotMatch(`${coverage.stdout}${coverage.stderr}`, /verify-reports|aebff5f39e5c/,
    'the walker does not load the report');

  const sep = await rcf(['audit', 'separation', '--base', base, '--head', 'HEAD', '--json'], { cwd: root });
  assert.equal(sep.code, 0, `a Hand: verifier commit touching rcf/verify-reports/ passes; stderr:\n${sep.stderr}`);
  const rows = JSON.parse(sep.stdout);
  const list = Array.isArray(rows) ? rows : rows.rows ?? rows.commits;
  assert.ok(Array.isArray(list) && list.length === 1, 'one SeparationRow for the one commit');
  assert.equal(list[0].hand, 'verifier');
  assert.equal(list[0].verdict, 'pass');
  assert.deepEqual(list[0].classes, ['verifierEvidence'], 'rcf/verify-reports/ is classed as verifier evidence');
});

test('AC-19001-6: rcf verify run --hand verifier writes only under rcf/verify-reports/<fbs-id>/; a second run for the same head exits 4 with "verify report exists for head <sha7>; pass --replace" and never overwrites', async (t) => {
  const target = await startTarget(t);
  const { root, head } = await fixtureRepo();
  const flags = ['--url', target.url, '--fbs', 'FBS-001', '--hand', 'verifier', '--verifier-id', 'verifier-ac-19001-6'];

  const first = await verifyRun(root, flags);
  assert.equal(first.code, 0, `first run writes its report; stderr:\n${first.stderr}`);
  const rel = `rcf/verify-reports/FBS-001/${head.slice(0, 12)}.json`;
  assert.deepEqual(changedPaths(root), [rel], 'git status lists only the new report: nothing under src/, test/ or the chain directories');
  const before = await readFile(reportPath(root, head), 'utf8');

  const second = await verifyRun(root, flags);
  assert.equal(second.code, 4, `a second run for the same head refuses exit 4; stderr:\n${second.stderr}`);
  assert.ok(second.stderr.includes(`verify report exists for head ${head.slice(0, 7)}; pass --replace "<reason>"`),
    `stderr names the head and --replace; got:\n${second.stderr}`);
  assert.equal(await readFile(reportPath(root, head), 'utf8'), before, 'the existing report is never overwritten');
  assert.deepEqual(changedPaths(root), [rel], 'the refused run writes nothing');
});

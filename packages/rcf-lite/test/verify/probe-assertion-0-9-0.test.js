// FBS-227 and FBS-228 (US-19401): the rcf-schemas 0.9.0 pin bump with assertion-required probes (FBS-227, AC-19401-1 to -4), and deterministic verify skipping a retired criterion's probe (FBS-228, AC-19401-12).
//
// Declared skeletons, one per AC, bound by the US-19401 test suite. The
// owning spec's Define fill round (test-author hand; FBS-227 for AC-19401-1 to -4, FBS-228 for AC-19401-12) turns each todo into a test
// that drives bin/rcf.js in the test/verify/probe-catalog.test.js world (scaffoldChain, a local target server)
// and is red for the right reason before Build starts. The supersession
// fixtures validate only once the pin reads rcf-schemas 0.9.0. These
// fixtures use initProject in-process; a body that runs rcf init or rcf
// doctor must pin claudeFreePath as test/guidance/stage-contract.test.js does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scaffoldChain } from './helpers/chain.js';
import { scratchDir } from '../_helpers/scratch.js';
import { rcf as harnessRcf } from '../_harness/spawn.js';
import { criterion, editFbs, editStory, project as harnessProject, scratch as harnessScratch } from '../_harness/fixture.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// The package under test: in the clone packages/rcf-lite, inside
// `rcf verify run --artefact` the installed artefact copied to <scratch>/run.
const PKG_ROOT = resolve(HERE, '..', '..');
const RCF_BIN = join(PKG_ROOT, 'bin', 'rcf.js');
const SCHEMAS = '@stravica-ai/rcf-schemas';
const ASSERTION_FIELDS = ['expectStatus', 'expectHeader', 'expectBody', 'selector'];

// The Given every FBS-227 criterion shares: the package under test pins
// rcf-schemas 0.9.0 and the copy bin/rcf.js resolves reads 0.9.0. Both
// are read relative to this file, so inside the artefact run they are
// the artefact's own pin and its own installed dependency.
async function assertPinGiven() {
  const pkg = JSON.parse(await readFile(join(PKG_ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies?.[SCHEMAS], '0.9.0', `${PKG_ROOT}/package.json pins ${SCHEMAS} 0.9.0`);
  const schemasPkg = createRequire(RCF_BIN).resolve(`${SCHEMAS}/package.json`);
  const installed = JSON.parse(await readFile(schemasPkg, 'utf8')).version;
  assert.equal(installed, '0.9.0', `the ${SCHEMAS} that bin/rcf.js resolves (${schemasPkg}) is 0.9.0`);
}

// This repository's packages/rcf-lite, the directory AC-19401-1 runs its
// commands from. In the clone it is PKG_ROOT. Inside `rcf verify run
// --artefact` this file runs from a scratch copy of the installed package,
// whose chain names Code Node paths the tarball does not ship (blueprints/,
// scripts/, the root README.md), so the walk also starts from the shell's
// working directory the run inherited (PWD, or INIT_CWD under a package
// manager): the verifier's shell sits in the clone. The first directory
// holding README.md and packages/rcf-lite/rcf/ wins, and its package must be
// the package under test by name and version; the installed copy never
// stands in.
async function repoPackage() {
  const own = JSON.parse(await readFile(join(PKG_ROOT, 'package.json'), 'utf8'));
  const starts = [HERE, process.env.PWD, process.env.INIT_CWD].filter(Boolean);
  for (const start of starts) {
    let dir = resolve(start);
    for (;;) {
      const pkgDir = join(dir, 'packages', 'rcf-lite');
      if (existsSync(join(dir, 'README.md')) && existsSync(join(pkgDir, 'package.json')) && existsSync(join(pkgDir, 'rcf'))) {
        const pkg = JSON.parse(await readFile(join(pkgDir, 'package.json'), 'utf8'));
        assert.equal(`${pkg.name}@${pkg.version}`, `${own.name}@${own.version}`,
          `${pkgDir} is the repository of the package under test`);
        return pkgDir;
      }
      const up = dirname(dir);
      if (up === dir) break;
      dir = up;
    }
  }
  return assert.fail(`no repository root with README.md and packages/rcf-lite/rcf/ above ${starts.join(', ')}`);
}

// Run bin/rcf.js as a child; never rejects, returns the exit code.
function rcf(args, { cwd } = {}) {
  return new Promise((res) => {
    execFile(process.execPath, [RCF_BIN, ...args], {
      cwd, env: { ...process.env }, encoding: 'utf8', timeout: 60000,
    }, (err, stdout, stderr) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

// A real HTTP target on 127.0.0.1 answering every path 200 'ok'.
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

function ac(id, extra = {}) {
  return {
    id,
    description: `${id}: the deployed service answers its declared probe`,
    given: 'the service is deployed',
    when: 'the verifier probes it',
    then: 'the declared expectation holds',
    testable: true,
    ...extra,
  };
}

// US-101 carries `acs` (written to disk verbatim by scaffoldChain, never
// through the CLI); FBS-001 scopes all of them; `catalog` is written to
// rcf/verify-catalog.json at catalogVersion 1 when given.
async function fixtureChain({ acs, catalog }) {
  const acIds = acs.map((a) => a.id);
  const fbs = {
    fbsId: 'FBS-001', prdId: 'PRD-001', bsId: 'BS-001', buildOrder: 1,
    executionStatus: 'inProgress', title: 'FBS-001 fixture',
    summary: `FBS-001 binds ${acIds.join(', ')}.`, acIds, dependsOnFbsIds: [],
    createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z',
  };
  const { root } = await scaffoldChain({ acceptanceCriteria: acs, fbsItems: [fbs] });
  if (catalog) {
    await writeFile(join(root, 'rcf', 'verify-catalog.json'),
      `${JSON.stringify({ catalogVersion: 1, probes: catalog }, null, 2)}\n`, 'utf8');
  }
  return root;
}

async function verifyRun(root, url) {
  const out = join(await scratchDir('rcf-probe-0-9-0-report-'), 'report.json');
  const result = await rcf(['verify', 'run', '--repo', root, '--profile', 'ci', '--url', url,
    '--out', out, '--provision-mode', 'skip', '--mode', 'deterministic', '--fbs', 'FBS-001'], { cwd: root });
  let report = null;
  try { report = JSON.parse(await readFile(out, 'utf8')); } catch { report = null; }
  return { ...result, report };
}

function perAc(report, acId) {
  assert.ok(report, 'a report must be written');
  assert.ok(Array.isArray(report.perAc), 'report.perAc[] must list the per-AC results');
  const entry = report.perAc.find((e) => e.acId === acId);
  assert.ok(entry, `report.perAc must carry ${acId}`);
  return entry;
}

// The assertion-free probe fails as "missing assertion", exactly, and
// never as one assertion field (the first 0.9.0 anyOf arm's error).
function assertMissingAssertionFail(report, acId) {
  const entry = perAc(report, acId);
  assert.notEqual(entry.result, 'pass', `${acId}: an assertion-free probe is never "pass"`);
  assert.equal(entry.result, 'fail', `${acId}: an assertion-free probe resolves "fail"`);
  const failed = entry.evidence?.failedExpectation;
  assert.ok(!ASSERTION_FIELDS.includes(failed), `${acId}: failedExpectation is not a single assertion field (got ${JSON.stringify(failed)})`);
  assert.equal(failed, 'missing assertion', `${acId}: failedExpectation is exactly "missing assertion"`);
}

test('AC-19401-1: with @stravica-ai/rcf-schemas 0.9.0 pinned and installed, node bin/rcf.js define validate over the chain of this repository exits 0 with no "[error]" line and node bin/rcf.js audit coverage --strict exits 0', async (t) => {
  await t.test('Given: the package under test pins and installs @stravica-ai/rcf-schemas 0.9.0', assertPinGiven);

  // The package under test's bin/rcf.js runs from this repository's
  // packages/rcf-lite in both worlds, full validation included.
  const repoPkg = await repoPackage();

  // Guard (green at Define under 0.8.0): the own chain validates clean.
  await t.test('guard: node bin/rcf.js define validate over the own chain exits 0 with no "[error]" line', async () => {
    const r = await rcf(['define', 'validate'], { cwd: repoPkg });
    const errorLines = `${r.stdout}\n${r.stderr}`.split('\n').filter((l) => l.includes('[error]'));
    assert.deepEqual(errorLines, [], 'no "[error]" line on stdout or stderr');
    assert.equal(r.code, 0, `define validate exits 0; stderr:\n${r.stderr.slice(-2000)}`);
  });

  // Guard (green at Define under 0.8.0): every criterion stays covered.
  await t.test('guard: node bin/rcf.js audit coverage --strict over the own chain exits 0', async () => {
    const r = await rcf(['audit', 'coverage', '--strict'], { cwd: repoPkg });
    assert.equal(r.code, 0, `audit coverage --strict exits 0; stdout tail:\n${r.stdout.slice(-1500)}\nstderr:\n${r.stderr.slice(-1500)}`);
  });
});

test('AC-19401-2: rcf define update US-101 --ac AC-101-1 --probe {"path":"/"} at rcf-schemas 0.9.0 exits 3 with a stderr line naming AC-101-1 and "missing assertion" and the four assertion fields, and leaves rcf/user-stories/us-101.json byte-identical', async (t) => {
  await t.test('Given: the package under test pins and installs @stravica-ai/rcf-schemas 0.9.0', assertPinGiven);

  await t.test('a path-only --probe is refused with exit 3, one stderr line naming AC-101-1, "missing assertion" and the four fields, and the story bytes unchanged', async () => {
    const root = await fixtureChain({ acs: [ac('AC-101-1'), ac('AC-101-2')] });
    const usPath = join(root, 'rcf', 'user-stories', 'us-101.json');
    const before = await readFile(usPath);
    assert.equal(JSON.parse(before.toString('utf8')).acceptanceCriteria[0].probe, undefined, 'AC-101-1 starts with no probe');

    const r = await rcf(['define', 'update', 'US-101', '--ac', 'AC-101-1', '--probe', '{"path":"/"}'], { cwd: root });
    const after = await readFile(usPath);
    assert.ok(before.equals(after), 'rcf/user-stories/us-101.json is byte-identical to its state before the command');
    assert.equal(r.code, 3, `a path-only probe is refused with exit 3; stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    const line = r.stderr.split('\n').find((l) => l.includes('AC-101-1') && l.includes('missing assertion')
      && ASSERTION_FIELDS.every((f) => l.includes(f)));
    assert.ok(line, `one stderr line names AC-101-1, "missing assertion" and ${ASSERTION_FIELDS.join(', ')}; stderr:\n${r.stderr}`);
  });
});

test('AC-19401-3: at rcf-schemas 0.9.0 an rcf/verify-catalog.json entry { "path": "/" } resolves "fail" with failedExpectation "missing assertion" (never "expectStatus"), never "pass", counted under runStats.counts.failed, rcf verify run --mode deterministic exits 4, and rcf define validate exits 3 naming the key', async (t) => {
  await t.test('Given: the package under test pins and installs @stravica-ai/rcf-schemas 0.9.0', assertPinGiven);

  const target = await startTarget(t);
  const root = await fixtureChain({
    acs: [ac('AC-101-1'), ac('AC-101-2')],
    catalog: {
      'AC-101-1': { path: '/' },
      // Control: the asserting entry passes in the same run.
      'AC-101-2': { path: '/', expectStatus: 200 },
    },
  });

  // Guard at 0.8.0 (the shape check reaches "missing assertion"); the
  // red proof is the bumped pin, where the subschema's first error would
  // name "expectStatus".
  await t.test('guard at 0.8.0, red under the bump: verify run --mode deterministic exits 4, AC-101-1 "fail" with failedExpectation exactly "missing assertion", failed counts it, verified counts AC-101-2 only', async () => {
    const { code, stderr, report } = await verifyRun(root, target.url);
    assertMissingAssertionFail(report, 'AC-101-1');
    assert.equal(perAc(report, 'AC-101-2').result, 'pass', 'the control probe with expectStatus passes');
    assert.equal(report.run.runStats.counts.failed, 1, 'runStats.counts.failed counts AC-101-1');
    assert.equal(report.run.runStats.counts.verified, 1, 'runStats.counts.verified counts AC-101-2 only');
    assert.equal(code, 4, `the run exits 4; stderr:\n${stderr}`);
  });

  // Guard (green at Define): validate already names the catalog key.
  await t.test('guard: rcf define validate exits 3 naming the key AC-101-1', async () => {
    const r = await rcf(['define', 'validate'], { cwd: root });
    assert.equal(r.code, 3, `validate refuses the assertion-free entry; stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    assert.match(`${r.stdout}${r.stderr}`, /AC-101-1/, 'validate names the key AC-101-1');
  });
});

test('AC-19401-4: at rcf-schemas 0.9.0 an AC-level probe { "path": "/" } already on disk fails rcf define validate with exit 3 naming AC-101-1, and rcf verify run --mode deterministic records it "fail" with failedExpectation "missing assertion", never "pass", exit 4', async (t) => {
  await t.test('Given: the package under test pins and installs @stravica-ai/rcf-schemas 0.9.0', assertPinGiven);

  const target = await startTarget(t);
  // Written to disk by the scaffold, never through rcf define update.
  const root = await fixtureChain({ acs: [ac('AC-101-1', { probe: { path: '/' } })] });

  await t.test('rcf define validate exits 3 with a line naming AC-101-1 and its probe', async () => {
    const r = await rcf(['define', 'validate'], { cwd: root });
    assert.equal(r.code, 3, `validate refuses the assertion-free AC-level probe; stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
    const line = `${r.stdout}\n${r.stderr}`.split('\n').find((l) => l.includes('AC-101-1') && /probe/.test(l));
    assert.ok(line, `one output line names AC-101-1 and its probe; stdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
  });

  // Guard at 0.8.0 (the AC-level case already resolves "fail"); the red
  // proof is the bumped pin.
  await t.test('guard at 0.8.0, red under the bump: verify run --mode deterministic records AC-101-1 "fail" with failedExpectation exactly "missing assertion" and exits 4', async () => {
    const { code, stderr, report } = await verifyRun(root, target.url);
    assertMissingAssertionFail(report, 'AC-101-1');
    assert.equal(code, 4, `the run exits 4; stderr:\n${stderr}`);
  });
});

// FBS-228 (US-19401), AC-19401-12: written in place (FBS-228's notes keep
// this declaration here so TC-260-verify-skips-retired-probe does not
// move; the stage-keeper's ruling before part B1). Todo until FBS-228's
// round DEFINE (GR-35). Its body uses only the shared harness
// (test/_harness/, GR-40): the bin's rcf init fixture and a recording
// HTTP target.
test('AC-19401-12: rcf verify run --mode deterministic never requests the probe path of retired AC-101-1, records it "retired" with evidence.supersededBy "AC-101-2", never "pass" or "fail", counts it under neither verified nor failed, and exits 0 when AC-101-2 passes', { todo: 'FBS-228 round DEFINE' }, async (t) => {
  const dir = await harnessProject(t, { name: 'verify-retired' });
  editStory(dir, 'US-101', (us) => {
    us.acceptanceCriteria = [
      criterion('AC-101-1', '[happy] the retired page answers', {
        supersededBy: 'AC-101-2', supersededOn: '2026-10-20', supersessionNote: 'replaced by AC-101-2',
        probe: { path: '/retired', expectStatus: 200 },
      }),
      criterion('AC-101-2', '[happy] the home page answers', { probe: { path: '/', expectStatus: 200 } }),
    ];
  });
  editFbs(dir, 'FBS-001', (f) => { f.acIds = ['AC-101-1', 'AC-101-2']; f.executionStatus = 'inProgress'; });
  const target = await startTarget(t);
  const out = join(harnessScratch(t, 'rcf-verify-retired-out-'), 'report.json');
  const r = await harnessRcf(['verify', 'run', '--repo', dir, '--profile', 'ci', '--url', target.url,
    '--out', out, '--provision-mode', 'skip', '--mode', 'deterministic', '--fbs', 'FBS-001'], { cwd: dir });
  assert.ok(!target.hits.includes('/retired'), `the server never receives a request for /retired; hits: ${target.hits.join(', ')}`);
  const report = JSON.parse(await readFile(out, 'utf8'));
  const one = perAc(report, 'AC-101-1');
  assert.equal(one.result, 'retired', 'AC-101-1 is recorded "retired", never "pass" or "fail"');
  assert.equal(one.evidence?.supersededBy, 'AC-101-2');
  const two = perAc(report, 'AC-101-2');
  assert.equal(two.result, 'pass', 'AC-101-2 passes');
  assert.equal(report.runStats.counts.verified, 1, 'runStats.counts.verified counts AC-101-2 only, never AC-101-1');
  assert.equal(report.runStats.counts.failed, 0, 'runStats.counts.failed never counts AC-101-1');
  assert.equal(r.code, 0, `with AC-101-2 passing the command exits 0\nstdout:\n${r.stdout}\nstderr:\n${r.stderr}`);
});

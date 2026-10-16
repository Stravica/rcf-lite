// FBS-218 (US-19201): per-AC probes resolve URL-verifiable criteria in deterministic verify.
//
// Every test drives the real entry point: `node bin/rcf.js verify run
// --mode deterministic` (or `rcf define update` / `rcf define validate`)
// as a child process against a scaffolded fixture chain, with a real HTTP
// target served from this test process on 127.0.0.1. Probes live either
// on the AC (`probe`, the rcf-schemas minor) or in the fixture tree's
// `rcf/verify-catalog.json { catalogVersion: 1, probes: { <acId>: Probe } }`.
// The per-AC outcome is read from the written report's `perAc[]`
// ({ acId, result, evidence }, the VerifyReport perAc shape of TAC-4148)
// and the tallies from `run.runStats.counts`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { scaffoldChain } from './helpers/chain.js';
import { scratchDir } from '../_helpers/scratch.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const RCF_BIN = resolve(HERE, '..', '..', 'bin', 'rcf.js');
const SPAWN_TRACE_PRELOAD = pathToFileURL(join(HERE, 'fixtures', 'probe-catalog', 'trace-spawn.mjs')).href;

// Run bin/rcf.js as a child; never rejects, returns the exit code.
function rcf(args, { cwd, env } = {}) {
  return new Promise((res) => {
    execFile(process.execPath, [RCF_BIN, ...args], {
      cwd, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60000,
    }, (err, stdout, stderr) => {
      res({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

// A real HTTP target. `routes` maps a path to { status, body } or to
// 'reset' (the socket is destroyed: a transport error for the client).
// Unlisted paths answer 200 'ok'. `hits` records every requested path.
async function startTarget(t, routes = {}) {
  const hits = [];
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    hits.push(path);
    const route = routes[path];
    if (route === 'reset') { req.socket.destroy(); return; }
    res.writeHead(route?.status ?? 200, { 'content-type': 'text/plain' });
    res.end(route?.body ?? 'ok');
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

function fbsDoc(fbsId, buildOrder, acIds) {
  return {
    fbsId, prdId: 'PRD-001', bsId: 'BS-001', buildOrder,
    executionStatus: 'inProgress', title: `${fbsId} fixture`,
    summary: `${fbsId} binds ${acIds.join(', ')}.`, acIds, dependsOnFbsIds: [],
    createdAt: '2026-10-16T00:00:00.000Z', updatedAt: '2026-10-16T00:00:00.000Z',
  };
}

// Fixture tree: US-101 carries `acs`; FBS-001 binds `inScope`, FBS-002
// binds the rest. `catalog` (probes keyed by acId) is written to
// rcf/verify-catalog.json when given.
async function fixtureChain({ acs, inScope, catalog }) {
  const ids = acs.map((a) => a.id);
  const scoped = inScope ?? ids;
  const rest = ids.filter((id) => !scoped.includes(id));
  const fbsItems = [fbsDoc('FBS-001', 1, scoped)];
  if (rest.length > 0) fbsItems.push(fbsDoc('FBS-002', 2, rest));
  const { root } = await scaffoldChain({ acceptanceCriteria: acs, fbsItems });
  if (catalog) {
    await writeFile(join(root, 'rcf', 'verify-catalog.json'),
      `${JSON.stringify({ catalogVersion: 1, probes: catalog }, null, 2)}\n`, 'utf8');
  }
  return root;
}

async function verifyRun(root, url, extra = [], opts = {}) {
  const out = join(await scratchDir('rcf-probe-report-'), 'report.json');
  const result = await rcf(['verify', 'run', '--repo', root, '--profile', 'ci', '--url', url,
    '--out', out, '--provision-mode', 'skip', '--mode', 'deterministic', '--fbs', 'FBS-001', ...extra],
  { cwd: root, ...opts });
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

test('AC-19201-1: rcf verify run --url <target> --fbs <fbs-id> --mode deterministic with an AC probe { path: "/health", expectStatus: 200 } served 200 exits 0; report records the AC "pass" with observed status and elapsed time and runStats.counts.verified incremented', async (t) => {
  const target = await startTarget(t, { '/health': { status: 200, body: 'up' } });
  // AC-101-2 has no probe but sits outside the --fbs scope, so it must not
  // hold the in-scope run back from exit 0.
  const root = await fixtureChain({
    acs: [ac('AC-101-1'), ac('AC-101-2')],
    inScope: ['AC-101-1'],
    catalog: { 'AC-101-1': { path: '/health', expectStatus: 200 } },
  });
  const { code, stderr, report } = await verifyRun(root, target.url);
  assert.equal(code, 0, `every in-scope AC passed, so verify exits 0; stderr:\n${stderr}`);
  const entry = perAc(report, 'AC-101-1');
  assert.equal(entry.result, 'pass');
  assert.equal(entry.evidence.status, 200, 'evidence carries the observed status');
  assert.equal(typeof entry.evidence.elapsedMs, 'number', 'evidence carries the elapsed time');
  assert.ok(entry.evidence.elapsedMs >= 0);
  assert.ok(target.hits.includes('/health'), 'the probe path was actually requested');
  assert.equal(report.run.runStats.counts.verified, 1);
  assert.equal(report.run.runStats.counts.total, 1);
  assert.equal(report.verdict, 'PASS');
  assert.equal(report.perAc.some((e) => e.acId === 'AC-101-2'), false, 'out-of-scope AC is not in perAc');
});

test('AC-19201-2: rcf verify run --mode deterministic with a probe expecting 200 and body "ready" against a body without "ready" exits 4; report records the AC "fail" naming the failed expectation and observed value, runStats.counts.failed at least 1', async (t) => {
  const target = await startTarget(t, {
    '/status': { status: 200, body: 'warming up' },
    '/down': { status: 503, body: 'ready' },
  });
  const root = await fixtureChain({
    acs: [ac('AC-101-1'), ac('AC-101-2')],
    catalog: {
      'AC-101-1': { path: '/status', expectStatus: 200, expectBody: { contains: 'ready' } },
      'AC-101-2': { path: '/down', expectStatus: 200, expectBody: { contains: 'ready' } },
    },
  });
  const { code, stderr, report } = await verifyRun(root, target.url);
  assert.equal(code, 4, `a failed probe exits 4; stderr:\n${stderr}`);

  const body = perAc(report, 'AC-101-1');
  assert.equal(body.result, 'fail');
  assert.match(body.evidence.failedExpectation, /expectBody/, 'evidence names the failed expectation');
  assert.match(String(body.evidence.observed), /warming up/, 'evidence carries the observed body');

  const status = perAc(report, 'AC-101-2');
  assert.equal(status.result, 'fail');
  assert.match(status.evidence.failedExpectation, /expectStatus/, 'evidence names the failed expectation');
  assert.equal(status.evidence.observed, 503, 'evidence carries the observed status');

  assert.ok(report.run.runStats.counts.failed >= 1);
  assert.equal(report.run.runStats.counts.failed, 2);
  assert.equal(report.run.runStats.counts.verified, 0);
  assert.notEqual(report.verdict, 'PASS');
});

test('AC-19201-3: rcf verify run --mode deterministic on an AC with no probe and no catalog entry exits 4 recording "critiqueOnly" counted in runStats.counts.critiqueOnly, verdict not PASS; an unreachable probe path is recorded "skipped" with the error kind, never "pass"', async (t) => {
  // No probe anywhere for the one in-scope AC.
  const plainTarget = await startTarget(t);
  const plainRoot = await fixtureChain({ acs: [ac('AC-101-1')] });
  const plain = await verifyRun(plainRoot, plainTarget.url);
  assert.equal(plain.code, 4, `a critique-only AC exits 4; stderr:\n${plain.stderr}`);
  assert.equal(perAc(plain.report, 'AC-101-1').result, 'critiqueOnly');
  assert.equal(plain.report.run.runStats.counts.critiqueOnly, 1);
  assert.equal(plain.report.run.runStats.counts.verified, 0);
  assert.notEqual(plain.report.verdict, 'PASS');

  // A probe whose path drops the connection: transport error, skipped.
  const target = await startTarget(t, { '/health': 'reset' });
  const root = await fixtureChain({
    acs: [ac('AC-101-1')],
    catalog: { 'AC-101-1': { path: '/health', expectStatus: 200 } },
  });
  const { code, stderr, report } = await verifyRun(root, target.url);
  assert.equal(code, 4, `an unreachable probe exits 4; stderr:\n${stderr}`);
  const entry = perAc(report, 'AC-101-1');
  assert.equal(entry.result, 'skipped');
  assert.equal(entry.evidence.error.kind, 'network', 'evidence carries the transport error kind');
  assert.ok(target.hits.includes('/health'), 'the probe path was attempted');
  assert.equal(report.run.runStats.counts.skipped, 1);
  assert.equal(report.run.runStats.counts.verified, 0);
  assert.notEqual(report.verdict, 'PASS');
});

test('AC-19201-4: rcf verify run --mode deterministic uses the AC-level probe over rcf/verify-catalog.json with evidence source "ac", a catalog-only probe with source "catalog"; a catalog key naming no AC makes rcf define validate exit 3', async (t) => {
  const target = await startTarget(t, {
    '/from-ac': { status: 200, body: 'ac' },
    '/from-catalog': { status: 200, body: 'catalog' },
    '/shadowed': { status: 500, body: 'the catalog entry must lose to the AC probe' },
  });

  // Catalog only: source "catalog".
  const catalogRoot = await fixtureChain({
    acs: [ac('AC-101-2')],
    catalog: { 'AC-101-2': { path: '/from-catalog', expectStatus: 200 } },
  });
  const viaCatalog = await verifyRun(catalogRoot, target.url);
  assert.equal(viaCatalog.code, 0, `catalog probe passes; stderr:\n${viaCatalog.stderr}`);
  const catalogEntry = perAc(viaCatalog.report, 'AC-101-2');
  assert.equal(catalogEntry.result, 'pass');
  assert.equal(catalogEntry.evidence.source, 'catalog');

  // A catalog key naming no AC in the tree: validate reports it, exit 3.
  const strayRoot = await fixtureChain({
    acs: [ac('AC-101-1')],
    catalog: { 'AC-101-1': { path: '/from-catalog', expectStatus: 200 }, 'AC-999-9': { path: '/' } },
  });
  const stray = await rcf(['define', 'validate'], { cwd: strayRoot });
  assert.equal(stray.code, 3, `stray catalog key fails validate; stdout:\n${stray.stdout}`);
  assert.match(`${stray.stdout}${stray.stderr}`, /AC-999-9/, 'validate names the stray catalog key');

  // AC-level probe and a catalog entry for the same AC: the AC wins.
  const bothRoot = await fixtureChain({
    acs: [ac('AC-101-1', { probe: { path: '/from-ac', expectStatus: 200 } })],
    catalog: { 'AC-101-1': { path: '/shadowed', expectStatus: 200 } },
  });
  const both = await verifyRun(bothRoot, target.url);
  assert.equal(both.code, 0, `AC-level probe passes; stderr:\n${both.stderr}`);
  const acEntry = perAc(both.report, 'AC-101-1');
  assert.equal(acEntry.result, 'pass');
  assert.equal(acEntry.evidence.source, 'ac');
  assert.ok(target.hits.includes('/from-ac'));
  assert.equal(target.hits.includes('/shadowed'), false, 'the shadowed catalog probe is never requested');
});

test('AC-19201-5: rcf verify run --mode deterministic --parity-env staging resolves a probe with parityEnv "staging"; with --parity-env production the same probe is recorded "skipped" with reason "parityEnv mismatch"', async (t) => {
  const target = await startTarget(t, { '/health': { status: 200, body: 'up' } });
  const root = await fixtureChain({
    acs: [ac('AC-101-1')],
    catalog: { 'AC-101-1': { path: '/health', expectStatus: 200, parityEnv: 'staging' } },
  });

  const staging = await verifyRun(root, target.url, ['--parity-env', 'staging']);
  assert.equal(staging.code, 0, `staging-scoped probe resolves; stderr:\n${staging.stderr}`);
  assert.equal(perAc(staging.report, 'AC-101-1').result, 'pass');
  assert.equal(target.hits.filter((p) => p === '/health').length, 1);

  const production = await verifyRun(root, target.url, ['--parity-env', 'production']);
  assert.equal(production.code, 4, `a skipped probe is not a pass; stderr:\n${production.stderr}`);
  const entry = perAc(production.report, 'AC-101-1');
  assert.equal(entry.result, 'skipped');
  assert.equal(entry.evidence.reason, 'parityEnv mismatch');
  assert.equal(target.hits.filter((p) => p === '/health').length, 1, 'the out-of-scope probe is never requested');
  assert.equal(production.report.run.runStats.counts.verified, 0);
  assert.equal(production.report.run.runStats.counts.skipped, 1);
});

test('AC-19201-6: rcf define update <us-id> --ac <ac-id> --probe {"path":"/","expectStatus":200} stores the probe and rcf define validate exits 0; an unknown probe key or a non-integer expectStatus is refused with exit 3 naming the key', async () => {
  const root = await fixtureChain({ acs: [ac('AC-101-1'), ac('AC-101-2')] });
  const usPath = join(root, 'rcf', 'user-stories', 'us-101.json');
  const readAc = async (id) => JSON.parse(await readFile(usPath, 'utf8')).acceptanceCriteria.find((a) => a.id === id);

  const stored = await rcf(['define', 'update', 'US-101', '--ac', 'AC-101-1', '--probe', '{"path":"/","expectStatus":200}'], { cwd: root });
  assert.equal(stored.code, 0, `probe update succeeds; stderr:\n${stored.stderr}`);
  assert.deepEqual((await readAc('AC-101-1')).probe, { path: '/', expectStatus: 200 });
  assert.equal((await readAc('AC-101-2')).probe, undefined, 'only the named AC carries the probe');

  const valid = await rcf(['define', 'validate'], { cwd: root });
  assert.equal(valid.code, 0, `the stored probe validates; stdout:\n${valid.stdout}${valid.stderr}`);

  const unknownKey = await rcf(['define', 'update', 'US-101', '--ac', 'AC-101-2', '--probe', '{"path":"/","expectStauts":200}'], { cwd: root });
  assert.equal(unknownKey.code, 3, 'an unknown probe key is refused with exit 3');
  assert.match(`${unknownKey.stdout}${unknownKey.stderr}`, /expectStauts/, 'the refusal names the unknown key');

  const badStatus = await rcf(['define', 'update', 'US-101', '--ac', 'AC-101-2', '--probe', '{"path":"/","expectStatus":"200"}'], { cwd: root });
  assert.equal(badStatus.code, 3, 'a non-integer expectStatus is refused with exit 3');
  assert.match(`${badStatus.stdout}${badStatus.stderr}`, /expectStatus/, 'the refusal names the key');

  assert.equal((await readAc('AC-101-2')).probe, undefined, 'refused probes are never written');
});

test('AC-19201-7: rcf verify run --mode deterministic on a chain with no in-scope probe exits 4 with runStats.counts.verified 0, never records "pass" for an AC without a probe and spawns no child process', async (t) => {
  const traceDir = await scratchDir('rcf-spawn-trace-');
  const env = (name) => ({
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import ${SPAWN_TRACE_PRELOAD}`.trim(),
    RCF_SPAWN_TRACE: join(traceDir, name),
  });
  const readTrace = async (name) => {
    try { return (await readFile(join(traceDir, name), 'utf8')).split('\n').filter(Boolean); } catch { return []; }
  };

  // Control: the preload does record a spawn, so an empty trace below means
  // no spawn rather than a dead hook.
  await new Promise((res) => execFile(process.execPath,
    ['--input-type=module', '-e', "import { spawnSync } from 'node:child_process'; spawnSync(process.execPath, ['--version']);"],
    { env: { ...process.env, ...env('control.jsonl') } }, () => res()));
  assert.equal((await readTrace('control.jsonl')).length, 1, 'the spawn-trace preload records a spawn');

  // A catalog exists, but its only probe is for an AC outside the scope.
  const target = await startTarget(t, { '/health': { status: 200, body: 'up' } });
  const root = await fixtureChain({
    acs: [ac('AC-101-1'), ac('AC-101-2'), ac('AC-101-3')],
    inScope: ['AC-101-1', 'AC-101-2'],
    catalog: { 'AC-101-3': { path: '/health', expectStatus: 200 } },
  });
  const { code, stderr, report } = await verifyRun(root, target.url, [], { env: env('run.jsonl') });
  assert.equal(code, 4, `no in-scope probe means nothing verified: exit 4; stderr:\n${stderr}`);
  assert.equal(report.run.runStats.counts.verified, 0);
  assert.equal(report.run.runStats.counts.critiqueOnly, 2);
  for (const id of ['AC-101-1', 'AC-101-2']) {
    assert.equal(perAc(report, id).result, 'critiqueOnly', `${id} has no probe and is never "pass"`);
  }
  assert.equal(report.perAc.some((e) => e.result === 'pass'), false);
  assert.equal(target.hits.includes('/health'), false, 'an out-of-scope probe is never requested');
  assert.deepEqual(await readTrace('run.jsonl'), [], 'deterministic verify spawns no child process');
});

// Gate finding BH-1 (PR 370): a probe that carries no response assertion
// (no expectStatus, expectHeader, expectBody or selector) is an invalid
// catalog entry. Verify never resolves it to "pass"; validate refuses it.

test('AC-19201-8: rcf verify run --mode deterministic records an assertion-free probe (catalog { path: "/" } or AC-level) as "fail" with evidence naming the missing assertion, counts it under runStats.counts.failed never verified, and exits 4', async (t) => {
  const target = await startTarget(t, { '/': { status: 200, body: 'ok' } });
  const root = await fixtureChain({
    acs: [
      ac('AC-101-1'),
      ac('AC-101-2'),
      ac('AC-101-3', { probe: { path: '/' } }),
    ],
    catalog: {
      'AC-101-1': { path: '/' },
      // Control: a probe with an assertion still passes in the same run.
      'AC-101-2': { path: '/', expectStatus: 200 },
    },
  });
  const { code, stderr, report } = await verifyRun(root, target.url);
  assert.equal(code, 4, `an assertion-free probe fails the run, exit 4; stderr:\n${stderr}`);

  for (const acId of ['AC-101-1', 'AC-101-3']) {
    const entry = perAc(report, acId);
    assert.equal(entry.result, 'fail', `${acId}: an assertion-free probe is never "pass"`);
    assert.match(String(entry.evidence?.failedExpectation), /assertion/i,
      `${acId}: evidence names the missing assertion`);
  }
  assert.equal(perAc(report, 'AC-101-2').result, 'pass', 'the control probe with expectStatus passes');

  assert.equal(report.run.runStats.counts.failed, 2, 'both assertion-free probes count under failed');
  assert.equal(report.run.runStats.counts.verified, 1, 'only the control probe counts as verified');
  assert.notEqual(report.verdict, 'PASS');
});

test('AC-19201-8: rcf define validate exits 3 naming the key for an rcf/verify-catalog.json probe with no assertion, and exits 3 when catalogVersion is missing or not 1', async () => {
  // Control: catalogVersion 1 with asserting probes validates clean.
  const okRoot = await fixtureChain({
    acs: [ac('AC-101-1')],
    catalog: { 'AC-101-1': { path: '/', expectStatus: 200 } },
  });
  const ok = await rcf(['define', 'validate'], { cwd: okRoot });
  assert.equal(ok.code, 0, `a valid catalog validates; stdout:\n${ok.stdout}\nstderr:\n${ok.stderr}`);

  // An assertion-free probe: refused, naming the key.
  const bareRoot = await fixtureChain({
    acs: [ac('AC-101-1'), ac('AC-101-2')],
    catalog: {
      'AC-101-1': { path: '/', expectStatus: 200 },
      'AC-101-2': { path: '/' },
    },
  });
  const bare = await rcf(['define', 'validate'], { cwd: bareRoot });
  assert.equal(bare.code, 3, `an assertion-free catalog probe fails validate; stdout:\n${bare.stdout}`);
  assert.match(`${bare.stdout}${bare.stderr}`, /AC-101-2/, 'validate names the assertion-free key');
  assert.doesNotMatch(`${bare.stdout}${bare.stderr}`, /AC-101-1/, 'validate does not flag the asserting probe');

  // catalogVersion missing, then catalogVersion 2: both refused.
  for (const [label, doc] of [
    ['missing', { probes: { 'AC-101-1': { path: '/', expectStatus: 200 } } }],
    ['2', { catalogVersion: 2, probes: { 'AC-101-1': { path: '/', expectStatus: 200 } } }],
  ]) {
    const root = await fixtureChain({ acs: [ac('AC-101-1')] });
    await writeFile(join(root, 'rcf', 'verify-catalog.json'), `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
    const res = await rcf(['define', 'validate'], { cwd: root });
    assert.equal(res.code, 3, `catalogVersion ${label} fails validate; stdout:\n${res.stdout}`);
    assert.match(`${res.stdout}${res.stderr}`, /catalogVersion/, `validate names catalogVersion (${label})`);
  }
});

// Gate finding BH-2 (PR 370 gate 2): an EMPTY or malformed assertion is no
// assertion. A probe counts only when it satisfies the acProbe subschema of
// @stravica-ai/rcf-schemas: expectStatus an integer status code,
// expectHeader { name, match } both non-empty, expectBody exactly one
// non-empty contains or matches, selector a non-empty string.

const MALFORMED_PROBES = [
  ['expectBody', { path: '/', expectBody: {} }],
  ['selector', { path: '/', selector: '' }],
  ['expectBody', { path: '/', expectBody: { contains: '' } }],
  ['expectHeader', { path: '/', expectHeader: { name: 'content-type', match: '' } }],
  ['expectStatus', { path: '/', expectStatus: '200' }],
];

test('AC-19201-8: rcf verify run --mode deterministic records a catalog probe with an empty or malformed assertion (expectBody {}, selector "", expectBody { contains: "" }, expectHeader match "", expectStatus "200") as "fail" with evidence naming the field, counts it under runStats.counts.failed never verified, and exits 4', async (t) => {
  const target = await startTarget(t, { '/': { status: 200, body: 'ok' } });
  const malformedIds = MALFORMED_PROBES.map((_, i) => `AC-101-${i + 1}`);
  const controlId = `AC-101-${MALFORMED_PROBES.length + 1}`;
  const catalog = Object.fromEntries(MALFORMED_PROBES.map(([, probe], i) => [malformedIds[i], probe]));
  // Control: a well-formed asserting probe still passes in the same run.
  catalog[controlId] = { path: '/', expectStatus: 200 };
  const root = await fixtureChain({ acs: [...malformedIds, controlId].map((id) => ac(id)), catalog });

  const { code, stderr, report } = await verifyRun(root, target.url);
  assert.equal(code, 4, `an empty or malformed assertion fails the run, exit 4; stderr:\n${stderr}`);
  MALFORMED_PROBES.forEach(([field, probe], i) => {
    const entry = perAc(report, malformedIds[i]);
    assert.equal(entry.result, 'fail', `${malformedIds[i]} ${JSON.stringify(probe)}: an empty or malformed assertion is never "pass"`);
    assert.match(JSON.stringify(entry.evidence ?? null), new RegExp(field),
      `${malformedIds[i]} ${JSON.stringify(probe)}: evidence names the malformed field ${field}`);
  });
  assert.equal(perAc(report, controlId).result, 'pass', 'the well-formed control probe passes');
  assert.equal(report.run.runStats.counts.failed, MALFORMED_PROBES.length, 'every malformed probe counts under failed');
  assert.equal(report.run.runStats.counts.verified, 1, 'only the control probe counts as verified');
  assert.notEqual(report.verdict, 'PASS');
});

test('AC-19201-8: rcf define validate exits 3 naming the key and the field for an rcf/verify-catalog.json probe with an empty or malformed assertion', async () => {
  for (const [field, probe] of MALFORMED_PROBES) {
    const root = await fixtureChain({
      acs: [ac('AC-101-1'), ac('AC-101-2')],
      catalog: {
        'AC-101-1': { path: '/', expectStatus: 200 },
        'AC-101-2': probe,
      },
    });
    const res = await rcf(['define', 'validate'], { cwd: root });
    const out = `${res.stdout}${res.stderr}`;
    assert.equal(res.code, 3, `${JSON.stringify(probe)} fails validate; stdout:\n${res.stdout}`);
    assert.match(out, /AC-101-2/, `validate names the malformed key for ${JSON.stringify(probe)}`);
    assert.match(out, new RegExp(field), `validate names the malformed field ${field} for ${JSON.stringify(probe)}`);
    assert.doesNotMatch(out, /AC-101-1/, 'validate does not flag the well-formed probe');
  }
});

test('AC-19201-8: an AC-level probe with an empty assertion (expectBody {}, selector "") is refused with exit 3 naming the field, by rcf define update --probe and by rcf verify run --mode deterministic on a tree that already carries one', async (t) => {
  const root = await fixtureChain({ acs: [ac('AC-101-1')] });
  const usPath = join(root, 'rcf', 'user-stories', 'us-101.json');
  for (const [field, probe] of MALFORMED_PROBES.slice(0, 2)) {
    const res = await rcf(['define', 'update', 'US-101', '--ac', 'AC-101-1', '--probe', JSON.stringify(probe)], { cwd: root });
    assert.equal(res.code, 3, `define update refuses ${JSON.stringify(probe)} with exit 3`);
    assert.match(`${res.stdout}${res.stderr}`, new RegExp(field), `the refusal names ${field}`);
  }
  const stored = JSON.parse(await readFile(usPath, 'utf8')).acceptanceCriteria.find((a) => a.id === 'AC-101-1');
  assert.equal(stored.probe, undefined, 'refused probes are never written');

  // A tree whose ACs already carry empty assertions: the chain loader
  // refuses it (exit 3 naming each field) and verify never records "pass".
  const target = await startTarget(t, { '/': { status: 200, body: 'ok' } });
  const runRoot = await fixtureChain({
    acs: [
      ac('AC-101-1', { probe: { path: '/', expectBody: {} } }),
      ac('AC-101-2', { probe: { path: '/', selector: '' } }),
    ],
  });
  const { code, stdout, stderr, report } = await verifyRun(runRoot, target.url);
  assert.equal(code, 3, `an empty AC-level assertion is refused at load, exit 3; stderr:\n${stderr}`);
  for (const field of ['expectBody', 'selector']) {
    assert.match(`${stdout}${stderr}`, new RegExp(`probe/${field}`), `the refusal names ${field}`);
  }
  assert.equal(report?.perAc?.some((e) => e.result === 'pass') ?? false, false, 'nothing is recorded "pass"');
  assert.equal(target.hits.length, 0, 'a refused chain is never probed');
});

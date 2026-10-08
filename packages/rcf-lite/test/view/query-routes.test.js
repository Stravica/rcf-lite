// FBS-207 (TAC-4136 interfaces[GET /trace.json], [GET /impact.json],
// [GET /coverage.json], [QueryRouteError], [queryCache]): integration
// tests driving the live server through a real HTTP client. One case
// per acceptance criterion of US-208, named for the strict coverage
// audit to bind each AC to its TC via testPointer.
//
// Admissibility bypass (TAC-4136): the three routes never call
// runWithAdmissibilityGate. A tree that fails admissibility must
// still answer trace, impact and coverage. AC-208-5 asserts that
// property and that nothing is written under rcf/.
//
// Node 24 built-ins only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import { initProject } from '#core/store/init.js';
import { startServer } from '../../src/server/index.js';
import { createRouter } from '../../src/server/routes.js';
import { renderModelToPage } from '../../src/view/index.js';
import {
  classifyCoverageScope,
  computeCoverage,
  computeImpact,
  computeTrace,
  kindOf,
} from '../../src/query/index.js';

async function freePort() {
  return await new Promise((resolveP, rejectP) => {
    const s = createServer();
    s.on('error', rejectP);
    s.listen(0, '127.0.0.1', () => {
      const port = s.address().port;
      s.close(() => resolveP(port));
    });
  });
}

async function makeCleanProject() {
  const root = await mkdtemp(join(tmpdir(), 'rcf-queryroutes-'));
  await initProject({ projectRoot: root });
  return root;
}

// Hash every file under a directory, deterministically. Used to prove
// AC-208-5: a request to any of the three routes writes nothing under
// rcf/.
async function hashTree(root) {
  const hash = createHash('sha256');
  const entries = [];
  async function walk(dir) {
    const items = await readdir(dir, { withFileTypes: true });
    for (const it of items.sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = join(dir, it.name);
      if (it.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(abs);
      } else if (it.isFile()) {
        // eslint-disable-next-line no-await-in-loop
        const s = await stat(abs);
        // eslint-disable-next-line no-await-in-loop
        const buf = await readFile(abs);
        entries.push(`${relative(root, abs)}:${s.size}:${createHash('sha256').update(buf).digest('hex')}`);
      }
    }
  }
  await walk(root);
  for (const e of entries) hash.update(`${e}\n`);
  return { digest: hash.digest('hex'), fileCount: entries.length };
}

test('AC-208-1 happy: a running viewer and a known id', async () => {
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    const res = await fetch(`${srv.url}trace.json?id=PRD-001&direction=forward`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.pivot, 'PRD-001');
    assert.equal(body.direction, 'forward');
    assert.equal(body.found, true);
    assert.ok(Array.isArray(body.nodes), 'nodes array present');
    assert.ok(Array.isArray(body.edges), 'edges array present');
    // Reuse of the exact pure compute: the response bytes are the
    // computeTrace result for the current tree.
    const state = srv.currentState();
    const expected = computeTrace(state.tree, { id: 'PRD-001', direction: 'forward' });
    assert.deepEqual(body, expected);
    // URL is resolved relative to the viewer mount (the fetch URL
    // above used a relative path appended to srv.url).
    assert.ok(res.url.endsWith('/trace.json?id=PRD-001&direction=forward'));
  } finally {
    await srv.close();
  }
});

test('AC-208-2 happy: a running viewer and a known id', async () => {
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    const res = await fetch(`${srv.url}impact.json?id=PRD-001`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    const body = await res.json();
    assert.equal(body.pivot, 'PRD-001');
    assert.equal(body.found, true);
    assert.ok(Array.isArray(body.nodes));
    assert.ok(Array.isArray(body.edges));
    // Every node (except the pivot) carries an `actionNeeded` label
    // per Phase 5 D7; the pivot's actionNeeded is null.
    const pivotRow = body.nodes.find((n) => n.id === 'PRD-001');
    assert.ok(pivotRow, 'pivot row present');
    assert.equal(pivotRow.actionNeeded, null);
    const state = srv.currentState();
    const expected = computeImpact(state.tree, { id: 'PRD-001' });
    assert.deepEqual(body, expected);
  } finally {
    await srv.close();
  }
});

test('AC-208-3 happy: a running viewer', async () => {
  // Bind scope narrowing and testPointers plumbing by seeding a tree
  // with two REQs: REQ-001 holds a TC whose pointer FAILS to resolve
  // (file-missing); REQ-002 holds a TC whose pointer RESOLVES against
  // a real test file written into the project root. The two
  // observables that break if the server drops either knob:
  //   - scope=REQ-002 is a narrower set than whole-tree (totals and
  //     requirement ids differ), so ignoring scopeId is caught.
  //   - REQ-002 reports coverageClass 'covered' whereas REQ-001
  //     reports 'covered-unresolved'; a server that stopped passing
  //     state.testPointers would mark both as 'covered-unresolved',
  //     so dropping the testPointers plumbing is caught.
  const root = await makeCleanProject();
  const ts = '2026-10-08T00:00:00Z';
  await writeFile(join(root, 'rcf/requirements/req-002.json'), `${JSON.stringify({
    reqId: 'REQ-002',
    prdId: 'PRD-001',
    title: 'FBS-207 cover-bind REQ',
    description: 'FBS-207 cover-bind REQ',
    category: 'functional',
    domain: 'todo',
    priority: 'must',
    version: '0.1.0',
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  }, null, 2)}\n`, 'utf8');
  await writeFile(join(root, 'rcf/user-stories/us-201.json'), `${JSON.stringify({
    usId: 'US-201',
    prdId: 'PRD-001',
    reqId: 'REQ-002',
    version: '0.1.0',
    status: 'draft',
    title: 'FBS-207 cover-bind US',
    asA: '-',
    iWant: '-',
    soThat: '-',
    acceptanceCriteria: [{ id: 'AC-201-1', description: 'resolving ac', testable: true }],
    createdAt: ts,
    updatedAt: ts,
  }, null, 2)}\n`, 'utf8');
  // Real test file so TS-002's pointer resolves via the anchor regex
  // on the working tree inside the temp project root.
  const resolvingTestFile = 'test/fbs-207-cover-bind.test.js';
  await mkdir(join(root, 'test'), { recursive: true });
  await writeFile(join(root, resolvingTestFile),
    "import { test } from 'node:test';\ntest('resolves', () => {});\n", 'utf8');
  await writeFile(join(root, 'rcf/test-suites/ts-002.json'), `${JSON.stringify({
    id: 'TS-002',
    usId: 'US-201',
    title: 'cover-bind suite',
    purpose: 'cover-bind',
    testLevel: 'unit',
    acIds: ['AC-201-1'],
    testCases: [{
      id: 'TC-002-resolves',
      acId: 'AC-201-1',
      description: 'resolves',
      status: 'pending',
      testPointer: `${resolvingTestFile}::resolves`,
    }],
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  }, null, 2)}\n`, 'utf8');
  // Pointer that fails to resolve: file does not exist in the temp
  // project root, so coverage classes REQ-001 as covered-unresolved
  // and lists the TC in unresolvedTestPointers.
  await writeFile(join(root, 'rcf/test-suites/ts-001.json'), `${JSON.stringify({
    id: 'TS-001',
    usId: 'US-101',
    title: 'missing-pointer suite',
    purpose: 'missing',
    testLevel: 'unit',
    acIds: ['AC-101-1'],
    testCases: [{
      id: 'TC-001-missing',
      acId: 'AC-101-1',
      description: 'missing',
      status: 'pending',
      testPointer: 'test/does-not-exist.test.js::missing',
    }],
    status: 'draft',
    createdAt: ts,
    updatedAt: ts,
  }, null, 2)}\n`, 'utf8');

  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    // Whole-tree: strict per-AC coverage over both REQs.
    const whole = await fetch(`${srv.url}coverage.json`);
    assert.equal(whole.status, 200);
    assert.match(whole.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(whole.headers.get('cache-control'), 'no-store');
    const wholeBody = await whole.json();
    assert.equal(wholeBody.strict, true);
    assert.equal(wholeBody.totals.requirements, 2,
      'whole-tree sees both seeded requirements');
    const wholeReqIds = wholeBody.requirements.map((r) => r.id).sort();
    assert.deepEqual(wholeReqIds, ['REQ-001', 'REQ-002']);

    // testPointers plumbing: REQ-002 covered via a resolving TC;
    // REQ-001 covered-unresolved via a missing-file TC. If the
    // server dropped state.testPointers the resolving entry would be
    // missing and REQ-002 would also be covered-unresolved.
    const req1 = wholeBody.requirements.find((r) => r.id === 'REQ-001');
    const req2 = wholeBody.requirements.find((r) => r.id === 'REQ-002');
    assert.equal(req2.coverageClass, 'covered',
      'REQ-002 covered via resolving TC (testPointers plumbing)');
    assert.equal(req1.coverageClass, 'covered-unresolved',
      'REQ-001 unresolved via missing-file TC');
    assert.ok(
      wholeBody.unresolvedTestPointers.some((e) => e.tcId === 'TC-001-missing'),
      'unresolved pointer entry present for TC-001-missing',
    );

    // Scope narrowing (REQ): the subtree selection reuses
    // classifyCoverageScope the way the CLI positional does. Scoping
    // to REQ-002 drops REQ-001 - ids and totals differ from whole-
    // tree, so ignoring scopeId would be caught here.
    const scopedReq = await fetch(`${srv.url}coverage.json?scope=REQ-002`);
    assert.equal(scopedReq.status, 200);
    const scopedReqBody = await scopedReq.json();
    assert.equal(scopedReqBody.totals.requirements, 1,
      'REQ scope narrows to one requirement');
    assert.deepEqual(scopedReqBody.requirements.map((r) => r.id), ['REQ-002']);
    assert.notDeepEqual(scopedReqBody.requirements, wholeBody.requirements,
      'REQ-scoped result differs from whole-tree');

    // Scope narrowing (US): a US scope narrows to the parent REQ.
    const scopedUs = await fetch(`${srv.url}coverage.json?scope=US-101`);
    assert.equal(scopedUs.status, 200);
    const scopedUsBody = await scopedUs.json();
    assert.equal(scopedUsBody.totals.requirements, 1,
      'US scope narrows to its parent REQ');
    assert.deepEqual(scopedUsBody.requirements.map((r) => r.id), ['REQ-001']);

    // Oracle parity against the same pure compute; the fixtures above
    // keep this check non-tautological (whole-tree and scoped bodies
    // are observably different, and testPointers changes
    // coverageClass).
    const state = srv.currentState();
    assert.deepEqual(wholeBody, computeCoverage(state.tree, {
      strict: true,
      scopeId: null,
      testPointers: state.testPointers,
    }));
    assert.deepEqual(scopedReqBody, computeCoverage(state.tree, {
      strict: true,
      scopeId: 'REQ-002',
      testPointers: state.testPointers,
    }));
    assert.deepEqual(scopedUsBody, computeCoverage(state.tree, {
      strict: true,
      scopeId: 'US-101',
      testPointers: state.testPointers,
    }));

    // classifyCoverageScope accepts PRD / REQ / US; the handler
    // trusts this classifier exactly as the CLI does.
    assert.equal(classifyCoverageScope(state.tree, 'PRD-001'), 'valid');
    assert.equal(classifyCoverageScope(state.tree, 'REQ-002'), 'valid');
    assert.equal(classifyCoverageScope(state.tree, 'US-101'), 'valid');
  } finally {
    await srv.close();
  }
});

test('AC-208-4 failure: an unknown id', async () => {
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    // unknown-id on trace
    const t = await fetch(`${srv.url}trace.json?id=REQ-doesnotexist&direction=forward`);
    assert.equal(t.status, 404);
    assert.match(t.headers.get('content-type') ?? '', /application\/json/);
    const tBody = await t.json();
    assert.equal(tBody.error, 'unknown-id');
    assert.equal(tBody.id, 'REQ-doesnotexist');
    // unknown-id on impact (and the id echoes back verbatim)
    const i = await fetch(`${srv.url}impact.json?id=REQ-doesnotexist`);
    assert.equal(i.status, 404);
    const iBody = await i.json();
    assert.equal(iBody.error, 'unknown-id');
    assert.equal(iBody.id, 'REQ-doesnotexist');

    // bad-direction on trace (allowed set: forward | back | both)
    const bd = await fetch(`${srv.url}trace.json?id=PRD-001&direction=sideways`);
    assert.equal(bd.status, 400);
    const bdBody = await bd.json();
    assert.equal(bdBody.error, 'bad-direction');
    assert.equal(bdBody.id, 'PRD-001');
    assert.equal(bdBody.direction, 'sideways');

    // bad-scope on coverage (below-AC positional)
    const bs = await fetch(`${srv.url}coverage.json?scope=AC-001-1`);
    assert.equal(bs.status, 400);
    const bsBody = await bs.json();
    assert.equal(bsBody.error, 'bad-scope');
    assert.equal(bsBody.scope, 'AC-001-1');

    // bad-scope on coverage (unknown id)
    const unk = await fetch(`${srv.url}coverage.json?scope=REQ-doesnotexist`);
    assert.equal(unk.status, 400);
    const unkBody = await unk.json();
    assert.equal(unkBody.error, 'bad-scope');
    assert.equal(unkBody.scope, 'REQ-doesnotexist');
  } finally {
    await srv.close();
  }
});

test('AC-208-5 must-not: any request to the three routes', async () => {
  // Admissibility bypass claim: the route handler source carries no
  // CODE reference to runWithAdmissibilityGate - no import, no call -
  // exactly like the CLI coverage, impact and trace verbs. A static
  // check on the source is the enforceable form of the must-not;
  // comment prose that names the function to explain WHY it is not
  // called is deliberately not a defect, and the regex excludes it
  // by stripping comments before matching.
  function stripComments(src) {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/^\s*\*.*$/gm, '');
  }
  const routesSrc = await readFile(new URL('../../src/server/routes.js', import.meta.url), 'utf8');
  const importGrep = stripComments(routesSrc).match(/runWithAdmissibilityGate/g);
  assert.equal(importGrep, null,
    'routes.js must not import or call runWithAdmissibilityGate (AC-208-5)');
  // The CLI coverage and impact verbs do not call it either; we
  // assert the parallel so this test fails loudly if an upstream
  // refactor would reintroduce the gate.
  const cliCov = await readFile(new URL('../../src/cli/coverage.js', import.meta.url), 'utf8');
  const cliImp = await readFile(new URL('../../src/cli/impact.js', import.meta.url), 'utf8');
  assert.equal(stripComments(cliCov).match(/runWithAdmissibilityGate/g), null,
    'CLI coverage must not call runWithAdmissibilityGate (parallel invariant)');
  assert.equal(stripComments(cliImp).match(/runWithAdmissibilityGate/g), null,
    'CLI impact must not call runWithAdmissibilityGate (parallel invariant)');

  // Runtime proof the three routes answer 200 on a plain tree, with
  // zero writes under rcf/ in the process.
  const root = await makeCleanProject();
  const before = await hashTree(join(root, 'rcf'));
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    const [t, i, c] = await Promise.all([
      fetch(`${srv.url}trace.json?id=PRD-001&direction=forward`),
      fetch(`${srv.url}impact.json?id=PRD-001`),
      fetch(`${srv.url}coverage.json`),
    ]);
    assert.equal(t.status, 200);
    assert.equal(i.status, 200);
    assert.equal(c.status, 200);
  } finally {
    await srv.close();
  }
  const after = await hashTree(join(root, 'rcf'));
  assert.equal(after.digest, before.digest,
    'nothing under rcf/ is written by any of the three routes');
  assert.equal(after.fileCount, before.fileCount,
    'no new file created under rcf/');
});

test('AC-208-6 edge: a rewalk that publishes a new stateversion', async () => {
  // Bind the full TAC-4136 queryCache contract against a live server:
  // (1) within one version, two identical requests write exactly one
  //     memo entry (observed via srv.queryCacheSize()).
  // (2) a real rewalk triggered by srv.rewalk() bumps state.version,
  //     SWAPS the queryCache wholesale (not just version-prefixes new
  //     keys), and the next request on the new version is a fresh
  //     write.
  // (3) the same request after rewalk reflects the mutated tree, so
  //     the memo is not serving stale bytes.
  // A regression that stopped swapping the cache (e.g. removing
  // `queryCache = new Map()` from src/server/index.js) would leave
  // the previous-version entry resident after step (2) and the size
  // probe would read 2 before the new query lands.
  // The watcher is stubbed so the test's explicit srv.rewalk() does
  // not race with a filesystem-event-triggered walk.
  const root = await makeCleanProject();
  const srv = await startServer({
    projectRoot: root,
    port: await freePort(),
    watchImpl: () => ({ close() {} }),
  });
  try {
    const traceUrl = `${srv.url}trace.json?id=PRD-001&direction=forward`;
    const vBefore = srv.currentState().version;

    const r1 = await (await fetch(traceUrl)).json();
    const r2 = await (await fetch(traceUrl)).json();
    assert.deepEqual(r2, r1, 'same version, same key, same bytes');
    assert.equal(srv.queryCacheSize(), 1,
      'one entry for one (version,pivot,direction) key');

    // Mutate the tree on disk: add US-102 under REQ-001 with its own
    // AC. srv.rewalk() rewalks synchronously, bumps version, and
    // SWAPS queryCache for a fresh Map.
    const us = JSON.parse(await readFile(
      join(root, 'rcf/user-stories/us-101.json'),
      'utf8',
    ));
    const twin = {
      ...us,
      usId: 'US-102',
      title: 'FBS-207 rewalk twin',
      acceptanceCriteria: [
        { id: 'AC-102-1', description: 'rewalk-added ac', testable: true },
      ],
      updatedAt: '2026-10-08T00:00:00Z',
    };
    await writeFile(
      join(root, 'rcf/user-stories/us-102.json'),
      `${JSON.stringify(twin, null, 2)}\n`,
      'utf8',
    );

    await srv.rewalk();
    const vAfter = srv.currentState().version;
    assert.equal(vAfter, vBefore + 1, 'rewalk bumps state.version');
    // The cache was swapped wholesale: previous-version entries are
    // gone. If the server stopped swapping, size would read 1 here.
    assert.equal(srv.queryCacheSize(), 0,
      'rewalk clears the memo wholesale');

    // Same URL, new version: content reflects the mutated tree
    // (US-102 appears under PRD-001 in the forward trace).
    const r3 = await (await fetch(traceUrl)).json();
    assert.notDeepEqual(r3, r1,
      'served response reflects the mutated tree, not the memo');
    const r3HasUs102 = (r3.nodes ?? []).some((n) => n.id === 'US-102');
    assert.ok(r3HasUs102,
      'US-102 appears in the forward trace after rewalk');

    // One fresh entry on the new version.
    assert.equal(srv.queryCacheSize(), 1,
      'new version writes exactly one entry');
  } finally {
    await srv.close();
  }
});

test('AC-208-7 failure: the server before the first walk completes', async () => {
  // Router-level test with an injected currentState() that returns
  // null (the pre-first-walk state) so the three routes answer 503
  // without needing to race the real walker. The same posture
  // /index.json takes today (test/server/start.test.js covers that
  // route; this test is the parallel for the three new ones).
  const router = createRouter({
    currentState: () => null,
    sse: { handle: () => {} },
  });
  const server = createServer(router);
  const port = await freePort();
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${port}/`;
  try {
    for (const path of ['trace.json?id=PRD-001', 'impact.json?id=PRD-001', 'coverage.json']) {
      // eslint-disable-next-line no-await-in-loop
      const res = await fetch(`${url}${path}`);
      assert.equal(res.status, 503, `${path} answers 503 before first walk`);
      assert.match(res.headers.get('content-type') ?? '', /text\/plain/);
      // eslint-disable-next-line no-await-in-loop
      const body = await res.text();
      assert.equal(body, 'view server initialising\n');
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
});

// AC-208-5 keeps a parallel in-process check that kindOf agrees with
// the server classifier - a smoke so a future refactor of kindOf
// cannot silently change the 404 story.
test('kindOf parity: /trace.json unknown-id uses the same classifier as the CLI', async () => {
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    const state = srv.currentState();
    assert.equal(kindOf(state.tree, 'PRD-001'), 'prd');
    assert.equal(kindOf(state.tree, 'REQ-doesnotexist'), null);
  } finally {
    await srv.close();
  }
});

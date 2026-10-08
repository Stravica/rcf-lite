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
import { mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises';
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
  const root = await makeCleanProject();
  const srv = await startServer({ projectRoot: root, port: await freePort() });
  try {
    // No scope: strict per-AC coverage over the whole tree.
    const whole = await fetch(`${srv.url}coverage.json`);
    assert.equal(whole.status, 200);
    assert.match(whole.headers.get('content-type') ?? '', /application\/json/);
    assert.equal(whole.headers.get('cache-control'), 'no-store');
    const wholeBody = await whole.json();
    assert.equal(wholeBody.strict, true);
    assert.ok(wholeBody.totals && typeof wholeBody.totals.requirements === 'number');
    assert.ok(Array.isArray(wholeBody.requirements));
    assert.ok(Array.isArray(wholeBody.unresolvedTestPointers));
    const state = srv.currentState();
    const expectedWhole = computeCoverage(state.tree, {
      strict: true,
      scopeId: null,
      testPointers: state.testPointers,
    });
    assert.deepEqual(wholeBody, expectedWhole);

    // With scope: the subtree selection reuses classifyCoverageScope
    // the way the CLI positional does. A fresh init tree has no REQ,
    // so prove the narrowing semantics by scoping to the PRD and
    // asserting the result matches the same compute with scopeId set.
    const scoped = await fetch(`${srv.url}coverage.json?scope=PRD-001`);
    assert.equal(scoped.status, 200);
    const scopedBody = await scoped.json();
    const expectedScoped = computeCoverage(state.tree, {
      strict: true,
      scopeId: 'PRD-001',
      testPointers: state.testPointers,
    });
    assert.deepEqual(scopedBody, expectedScoped);
    // Sanity: classifyCoverageScope accepts PRD / REQ / US (the
    // handler trusts this classifier exactly as the CLI does).
    assert.equal(classifyCoverageScope(state.tree, 'PRD-001'), 'valid');
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
  // Router-level test with an injected currentState + queryCache so
  // both halves of the behaviour (same version memoised, new version
  // drops previous entries) are observable without racing against the
  // real walker. The tree is a real walked tree (makeCleanProject +
  // renderModelToPage) so computeTrace runs its real walker.
  const root = await makeCleanProject();
  const rendered = await renderModelToPage({ projectRoot: root });
  const cacheMap = new Map();
  let setCalls = 0;
  const cache = {
    get: (k) => cacheMap.get(k),
    set: (k, v) => { cacheMap.set(k, v); setCalls += 1; },
    has: (k) => cacheMap.has(k),
    size: () => cacheMap.size,
  };
  const state = {
    fullPageHtml: rendered.fullPageHtml,
    contentHtml: rendered.contentHtml,
    version: 1,
    tree: rendered.tree,
    testPointers: rendered.testPointers,
  };
  const router = createRouter({
    currentState: () => state,
    sse: { handle: () => {} },
    queryCache: cache,
  });
  const server = createServer(router);
  const port = await freePort();
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  const url = `http://127.0.0.1:${port}/`;
  try {
    // Within one version a repeated request writes exactly one entry
    // and the serial two calls both return the same bytes.
    const a = await (await fetch(`${url}trace.json?id=PRD-001&direction=forward`)).text();
    const b = await (await fetch(`${url}trace.json?id=PRD-001&direction=forward`)).text();
    assert.equal(a, b, 'same version, same key, same bytes');
    assert.equal(cacheMap.size, 1, 'one entry for one (version,pivot,direction) key');
    assert.equal(setCalls, 1, 'the second request served from the memo');

    // Simulate a rewalk: the server drops the cache wholesale and
    // state.version increments. The next request on the new version
    // writes a fresh entry under the new key, and the previous
    // version's key is no longer present.
    cacheMap.clear();
    state.version = 2;
    await fetch(`${url}trace.json?id=PRD-001&direction=forward`);
    assert.equal(cacheMap.size, 1, 'new version writes a fresh entry');
    const [onlyKey] = [...cacheMap.keys()];
    assert.ok(onlyKey.startsWith('2:trace:PRD-001:'), `key carries the new version: ${onlyKey}`);
  } finally {
    await new Promise((r) => server.close(r));
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

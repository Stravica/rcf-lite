// Dogfood tree integrity tests. Validates every JSON file under rcf/
// THROUGH THE CORE VALIDATOR (`#core/store`) - the
// same code path `rcf validate` and the writers use - and asserts the
// referential integrity that D7 walker + D8 validator enforce
// structurally. Routing through the core validator (w-2026-07-28-005)
// means this gate carries the published @stravica-ai/rcf-schemas bundle
// PLUS the local strictness overlay (testPointer required on every Test
// Case), so the dogfood gate and the tool can never disagree: a
// pointerless TC the CLI refuses would fail here too, instead of
// sliding through a raw-schema check.
//
// Phase 3.7 shape (D1-D6, D14):
//   Every parent-child edge is encoded on the child. PRD no longer carries
//   requirementIds; each REQ carries prdId. TAD no longer carries
//   componentIds / architecturalDecisionIds; each TAC / ADR carries tadId.
//   BS no longer carries fbs[]; each FBS carries bsId + buildOrder +
//   executionStatus + dependsOnFbsIds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { knownKinds, validateDocument } from '#core/store';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const rcfRoot = resolve(repoRoot, 'rcf');

function classify(relPath) {
  if (relPath === 'manifest.json') return 'manifest';
  if (relPath === 'prd.json') return 'prd';
  if (relPath === 'tad.json') return 'tad';
  if (relPath === 'build-sequence.json') return 'buildSequence';
  if (relPath.startsWith('requirements/')) return 'req';
  if (relPath.startsWith('user-stories/')) return 'userStory';
  if (relPath.startsWith('tacs/')) return 'tac';
  if (relPath.startsWith('adrs/')) return 'adr';
  if (relPath.startsWith('fbs/')) return 'fbs';
  if (relPath.startsWith('test-suites/')) return 'testSuite';
  // Phase 10 (X2 CodeNode bridge): 11th document kind.
  if (relPath.startsWith('code-nodes/')) return 'codeNode';
  return null;
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (entry.endsWith('.json')) acc.push(full);
  }
  return acc;
}

function loadAll() {
  const files = walk(rcfRoot).sort();
  return files.map((full) => {
    const rel = relative(rcfRoot, full).split('\\').join('/');
    const kind = classify(rel);
    const json = JSON.parse(readFileSync(full, 'utf8'));
    return { full, rel, kind, json };
  });
}

const expectedCounts = {
  manifest: 1,
  prd: 1,
  // 0.7.1 packaging consolidation added REQ-009 (verify subcommand
  // routing) with US-901, TS-025, FBS-015 and CN-055..057.
  // Phase 1 blueprint mechanism (w-2026-08-18-016) added REQ-010 with
  // US-1001..1004, TS-026..029, FBS-016..019 and CN-058..068.
  // e2e contract (w-2026-09-03-dave-020) added REQ-011 with US-1101..1104
  // (four USs binding the four ratified commits of the e2e verification
  // contract spec). The USs deliberately ship without paired TS entries in
  // this train; the ACs are runtime-scope and covered by the shipped
  // code paths' own suites. See test/store/walker.test.js's expected-count
  // comment for the full rationale.
  req: 11,
  userStory: 33,
  tad: 1,
  tac: 8,
  // fbs bumps 19 -> 23 for FBS-020..023 covering the four US-1101..1104
  // AC sets. See test/store/walker.test.js's expected-count comment.
  //
  // codeNode bumps 69 -> 73 for CN-070..073 anchoring:
  //   CN-070: src/verify/engine/launcher.js#PLAYWRIGHT_MCP_VERSION
  //   CN-071: test/blueprint/apply-spa-v1-4-0-schema.test.js (test-anchor)
  //   CN-072: src/setup/playwright-checks.js#loadBrowserFacingSources
  //   CN-073: src/cli/init.js#runPlaywrightMcpPass
  // Phase 3.5 rev-3 (w-2026-08-19-008): ADR-010 records the topic-
  // as-free-label-lookup-key decision (Baz ruling, camelCase canonical
  // on shipped blueprints).
  adr: 10,
  buildSequence: 1,
  fbs: 23,
  // Phase 10 (X2 CodeNode bridge, D20): full-tree dogfood backfill.
  // REQ-008 Tier-1 hardening added 25 guidance/drift-test CNs (29 -> 54).
  // 0.7.1 packaging added 3 CNs for the verify subcommand routing.
  // Phase 1 blueprint mechanism added 11 CNs for the mechanism modules.
  // Phase 3.5 (w-2026-08-19-008) added CN-069 for supersede.js#supersedeBlueprintTopic.
  // e2e contract added CN-070..073 for the four commits' main code paths.
  codeNode: 73,
  // w-2026-07-28-005 step 4: the test axis. One TS per US; every TC binds
  // an AC to a resolving testPointer. Pending ACs are registered in
  // rcf/test-suites/PENDING.md, never stubbed as TCs.
  testSuite: 33,
};

test('expected file counts by category', () => {
  const docs = loadAll();
  const counts = {};
  for (const d of docs) counts[d.kind] = (counts[d.kind] ?? 0) + 1;
  for (const [kind, expected] of Object.entries(expectedCounts)) {
    assert.equal(
      counts[kind] ?? 0,
      expected,
      `expected ${expected} ${kind} files, found ${counts[kind] ?? 0}`,
    );
  }
});

test('every document classifies to a known schema', () => {
  const kinds = new Set(knownKinds());
  const docs = loadAll();
  for (const d of docs) {
    assert.ok(d.kind !== null, `unclassified file: ${d.rel}`);
    assert.ok(kinds.has(d.kind), `core validator knows no kind: ${d.kind}`);
  }
});

test('every document validates through the core validator (published bundle + testPointer overlay)', () => {
  const docs = loadAll();
  const failures = [];
  for (const d of docs) {
    const err = validateDocument({ doc: d.json, kind: d.kind, filePath: d.rel });
    if (err) failures.push({ file: d.rel, message: err.message });
  }
  assert.equal(
    failures.length,
    0,
    `validation failures:\n${JSON.stringify(failures, null, 2)}`,
  );
});

test('file id matches filename and structural location', () => {
  const docs = loadAll();
  const idField = {
    prd: 'prdId',
    req: 'reqId',
    userStory: 'usId',
    tad: 'tadId',
    tac: 'tacId',
    adr: 'adrId',
    buildSequence: 'bsId',
    fbs: 'fbsId',
    testSuite: 'id',
    codeNode: 'cnId',
  };
  for (const d of docs) {
    if (d.kind === 'manifest') continue;
    const field = idField[d.kind];
    const id = d.json[field];
    assert.ok(id, `${d.rel} missing ${field}`);
    if (d.kind === 'prd' || d.kind === 'tad' || d.kind === 'buildSequence') continue;
    const stem = d.rel.split('/').pop().replace(/\.json$/, '');
    assert.equal(stem, id.toLowerCase(), `${d.rel} filename does not match id ${id}`);
  }
});

test('PRD no longer carries removed requirementIds field (D2)', () => {
  const docs = loadAll();
  const prd = docs.find((d) => d.kind === 'prd').json;
  assert.equal('requirementIds' in prd, false, 'PRD still carries removed requirementIds field');
});

test('TAD no longer carries removed componentIds / architecturalDecisionIds fields (D2)', () => {
  const docs = loadAll();
  const tad = docs.find((d) => d.kind === 'tad').json;
  assert.equal('componentIds' in tad, false);
  assert.equal('architecturalDecisionIds' in tad, false);
});

test('BS no longer carries removed fbs[] array (D6)', () => {
  const docs = loadAll();
  const bs = docs.find((d) => d.kind === 'buildSequence').json;
  assert.equal('fbs' in bs, false);
});

test('every REQ carries prdId matching the PRD (child-owned parent edge, D1)', () => {
  const docs = loadAll();
  const prdId = docs.find((d) => d.kind === 'prd').json.prdId;
  const reqs = docs.filter((d) => d.kind === 'req').map((d) => d.json);
  for (const r of reqs) {
    assert.equal(r.prdId, prdId, `REQ ${r.reqId} has wrong prdId`);
  }
});

test('every TAC and ADR carries tadId matching the TAD (D1)', () => {
  const docs = loadAll();
  const tadId = docs.find((d) => d.kind === 'tad').json.tadId;
  for (const t of docs.filter((d) => d.kind === 'tac')) {
    assert.equal(t.json.tadId, tadId, `TAC ${t.json.tacId} has wrong tadId`);
  }
  for (const a of docs.filter((d) => d.kind === 'adr')) {
    assert.equal(a.json.tadId, tadId, `ADR ${a.json.adrId} has wrong tadId`);
  }
});

test('every US has at least one covering REQ (US.reqId resolves)', () => {
  const docs = loadAll();
  const reqIds = new Set(docs.filter((d) => d.kind === 'req').map((d) => d.json.reqId));
  const usDocs = docs.filter((d) => d.kind === 'userStory').map((d) => d.json);
  const reqToUs = {};
  for (const us of usDocs) {
    assert.ok(reqIds.has(us.reqId), `US ${us.usId} references unknown REQ ${us.reqId}`);
    (reqToUs[us.reqId] ??= []).push(us.usId);
  }
  for (const reqId of reqIds) {
    assert.ok(reqToUs[reqId]?.length, `REQ ${reqId} has no user stories`);
  }
});

test('every FBS carries bsId + buildOrder + executionStatus + dependsOnFbsIds (D6)', () => {
  const docs = loadAll();
  const bsId = docs.find((d) => d.kind === 'buildSequence').json.bsId;
  const fbsDocs = docs.filter((d) => d.kind === 'fbs').map((d) => d.json);
  const fbsIds = new Set(fbsDocs.map((f) => f.fbsId));
  const orders = new Set();
  for (const f of fbsDocs) {
    assert.equal(f.bsId, bsId, `FBS ${f.fbsId} has wrong bsId`);
    assert.equal(typeof f.buildOrder, 'number', `FBS ${f.fbsId} missing buildOrder`);
    assert.ok(f.executionStatus, `FBS ${f.fbsId} missing executionStatus`);
    assert.ok(Array.isArray(f.dependsOnFbsIds), `FBS ${f.fbsId} missing dependsOnFbsIds`);
    for (const dep of f.dependsOnFbsIds) {
      assert.ok(fbsIds.has(dep), `FBS ${f.fbsId} depends on unknown FBS ${dep}`);
      assert.notEqual(dep, f.fbsId, `FBS ${f.fbsId} depends on itself`);
    }
    assert.equal(orders.has(f.buildOrder), false, `duplicate buildOrder ${f.buildOrder} inside ${bsId}`);
    orders.add(f.buildOrder);
  }
});

test('every FBS acId resolves to a real AC and every AC is covered by at least one FBS', () => {
  const docs = loadAll();
  const usDocs = docs.filter((d) => d.kind === 'userStory').map((d) => d.json);
  const acIds = new Set();
  for (const us of usDocs) {
    for (const ac of us.acceptanceCriteria) {
      assert.ok(!acIds.has(ac.id), `duplicate AC id ${ac.id} across user stories`);
      acIds.add(ac.id);
      const m = ac.id.match(/^AC-(\d{3,})-\d+$/);
      if (m) {
        const usNum = us.usId.match(/^US-(\d{3,})$/)?.[1];
        assert.equal(m[1], usNum, `AC ${ac.id} sits under US-${usNum} but its prefix is ${m[1]}`);
      }
    }
  }
  const fbsDocs = docs.filter((d) => d.kind === 'fbs').map((d) => d.json);
  const tacIds = new Set(docs.filter((d) => d.kind === 'tac').map((d) => d.json.tacId));
  const adrIds = new Set(docs.filter((d) => d.kind === 'adr').map((d) => d.json.adrId));
  const covered = new Set();
  for (const f of fbsDocs) {
    for (const acId of f.acIds) {
      assert.ok(acIds.has(acId), `FBS ${f.fbsId} references unknown AC ${acId}`);
      covered.add(acId);
    }
    const ctx = f.contextRequirements ?? {};
    for (const tacId of ctx.tacIds ?? []) {
      assert.ok(tacIds.has(tacId), `FBS ${f.fbsId} references unknown TAC ${tacId}`);
    }
    for (const adrId of ctx.adrIds ?? []) {
      assert.ok(adrIds.has(adrId), `FBS ${f.fbsId} references unknown ADR ${adrId}`);
    }
  }
  const orphans = [...acIds].filter((id) => !covered.has(id)).sort();
  assert.equal(orphans.length, 0, `acceptance criteria not covered by any FBS: ${orphans.join(', ')}`);
});

test('manifest roots resolve to existing files with matching ids', () => {
  const docs = loadAll();
  const manifest = docs.find((d) => d.kind === 'manifest').json;
  const prdDoc = docs.find((d) => d.kind === 'prd');
  const tadDoc = docs.find((d) => d.kind === 'tad');
  const bsDoc = docs.find((d) => d.kind === 'buildSequence');
  assert.equal(manifest.prd.id, prdDoc.json.prdId);
  assert.equal(manifest.tad.id, tadDoc.json.tadId);
  assert.equal(manifest.bs.id, bsDoc.json.bsId);
});

// ---------------------------------------------------------------------------
// Phase 10 (X2 CodeNode bridge, D20): full-tree dogfood backfill. The repo
// is its own demo - every AC carries a Code Node, `dependencies[]` edges
// resolve, and the REQ-007 validation chain is proven through the real
// verbs (13 hand-authored-then-reproduced-via-CRUD nodes, PoC-ported).
// ---------------------------------------------------------------------------

test('every CN implementsAcIds entry resolves to a real AC; every AC carries at least one CN', () => {
  const docs = loadAll();
  const usDocs = docs.filter((d) => d.kind === 'userStory').map((d) => d.json);
  const acIds = new Set();
  for (const us of usDocs) {
    for (const ac of us.acceptanceCriteria) acIds.add(ac.id);
  }
  const cnDocs = docs.filter((d) => d.kind === 'codeNode').map((d) => d.json);
  const covered = new Set();
  for (const cn of cnDocs) {
    for (const acId of cn.implementsAcIds ?? []) {
      assert.ok(acIds.has(acId), `CN ${cn.cnId} references unknown AC ${acId}`);
      covered.add(acId);
    }
  }
  const orphans = [...acIds].filter((id) => !covered.has(id)).sort();
  assert.equal(orphans.length, 0, `acceptance criteria with no Code Node: ${orphans.join(', ')}`);
});

test('every CN dependencies entry resolves to a real, distinct CN', () => {
  const docs = loadAll();
  const cnDocs = docs.filter((d) => d.kind === 'codeNode').map((d) => d.json);
  const cnIds = new Set(cnDocs.map((cn) => cn.cnId));
  for (const cn of cnDocs) {
    for (const depId of cn.dependencies ?? []) {
      assert.ok(cnIds.has(depId), `CN ${cn.cnId} depends on unknown CN ${depId}`);
      assert.notEqual(depId, cn.cnId, `CN ${cn.cnId} depends on itself`);
    }
  }
});

test('every CN path resolves against the working tree (no staleCode on the dogfood tree)', () => {
  const docs = loadAll();
  const cnDocs = docs.filter((d) => d.kind === 'codeNode').map((d) => d.json);
  for (const cn of cnDocs) {
    const [file] = cn.path.split('#');
    const absPath = resolve(repoRoot, file);
    assert.ok(statSync(absPath, { throwIfNoEntry: false })?.isFile(), `CN ${cn.cnId} path ${file} does not resolve on disk`);
  }
});

test('the REQ-007 validation chain (13 nodes) is present with the PoC-proven implementsAcIds/dependencies shape', () => {
  const docs = loadAll();
  const cnDocs = docs.filter((d) => d.kind === 'codeNode').map((d) => d.json);
  const byPath = new Map(cnDocs.map((cn) => [cn.path, cn]));
  // Post 0.7.1 packaging consolidation: core src lives inline under
  // src/core/, so the Code Nodes point at src/core/... (was ../core/src/...
  // pre-consolidation). map-errors.js stays under src/mcp/.
  const expectedPaths = [
    'src/core/store/validator.js#getAjv',
    'src/core/store/walker.js#netNewErrors',
    'src/core/errors/index.js#rcfError',
    'src/core/store/walker.js', // file-level
    'src/core/store/validator.js#validateDocument',
    'src/core/errors/index.js#formatErrors',
    'src/mcp/map-errors.js#issueFromRcfError',
    'src/core/store/validator.js', // file-level
    'src/core/store/walker.js#simulateWriteErrors',
    'src/core/store/loader.js#loadDocument',
    'src/core/store/writer.js#postWriteGate',
    'src/core/store/writer.js', // file-level
    'src/core/store/writer.js#createDocument',
  ];
  for (const p of expectedPaths) {
    assert.ok(byPath.has(p), `expected REQ-007-chain Code Node over ${p} is missing`);
  }
  // AC-701-3 ("registered once at start-up") is satisfied by getAjv.
  assert.ok(byPath.get('src/core/store/validator.js#getAjv').implementsAcIds.includes('AC-701-3'));
  // createDocument depends (transitively through the chain) on rcfError.
  const createDocumentCn = byPath.get('src/core/store/writer.js#createDocument');
  const rcfErrorCn = byPath.get('src/core/errors/index.js#rcfError');
  assert.ok(createDocumentCn.dependencies.includes(rcfErrorCn.cnId));
});
